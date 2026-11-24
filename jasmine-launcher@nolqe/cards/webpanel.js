// Jasmine Launcher: cards/webpanel.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PANEL_ID, PANEL_SCRIPT_PATTERN, vbox, hbox} from '../common.js';
import {_, getLang} from '../i18n.js';

// Web パネル: 1 枚のカードに、横につながったページ（ペイン）を 1〜3 個（設定 webpanel-count。パネルのバーの
// 数のボタンで 1 → 2 → 3 と回す。大きさのボタンと同じ操作）。大きさは全ペイン共通（webpanel-width / height）。
// 1 つの webpanel.js プロセスがペインごとのウィンドウ（題名の末尾が番号）を開き、ログイン情報・通信処理を共有する。
// 各ウィンドウは種類を「デスクトップ」にして常に裏へ・全ワークスペース（stick）に固定し、カードの中の領域に重ねる。
// 画面からはみ出す大きさ・数のときは、画面に収まるまでペインを縮める。
export const PANEL_MAX = 3;
const PANE_GAP = 4;
const HEAD_H = 16;

export class WebPanelPart {
    _wpState(n) {
        this._wp ??= {};
        return (this._wp[n] ??= {n, win: null, slot: null, card: null, status: null, sleeping: false, coveredSince: 0});
    }

    _panelCount() {
        return Math.max(1, Math.min(PANEL_MAX, this._settings.get_int('webpanel-count')));
    }

    // ペイン 1 枚の大きさ（画面に収まるように縮める）
    _paneSize() {
        const st = this._settings;
        const count = this._panelCount();
        const m = Main.layoutManager.primaryMonitor;
        const margin = st.get_int('margin');
        let w = st.get_int('webpanel-width'), h = st.get_int('webpanel-height');
        if (m) {
            const top = (Main.panel?.height ?? 32) + margin;
            w = Math.min(w, Math.floor((m.width - 2 * margin - (count - 1) * PANE_GAP) / count));
            h = Math.min(h, m.height - top - margin - HEAD_H - 72); // 下は Dock の分を空ける
        }
        return [Math.max(200, w), Math.max(200, h)];
    }

    // つかみバーを押すと開く・たたむ（設定 webpanel-open）。たたんでいる間はパネルのプロセスを止めてメモリを空ける
    _panelToggleOpen() {
        this._settings.set_boolean('webpanel-open', !this._settings.get_boolean('webpanel-open'));
    }

    _buildWebPanel() {
        const open = this._settings.get_boolean('webpanel-open');
        const count = open ? this._panelCount() : 0;
        const [w, h] = this._paneSize();
        const card = vbox(`jw-card jw-claude jw-panel-card${open ? '' : ' jw-panel-closed'}`);
        // 上の細いバーをつかんで動かす（文字は出さない）
        const head = hbox('jw-panel-head');
        const status = new St.Label({style_class: 'jw-head-status', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        head.add_child(status);
        head.add_child(new St.Widget({style_class: 'jw-grip', y_align: Clutter.ActorAlign.CENTER}));
        head.add_child(new St.Widget({x_expand: true}));
        const body = new St.BoxLayout({style: `spacing: ${PANE_GAP}px;`});
        card.add_child(head);
        card.add_child(body);
        for (let n = 1; n <= count; n++) {
            const s = this._wpState(n);
            // ペインのウィンドウが重なる場所
            s.slot = new St.Widget({style_class: 'jw-panel-slot', width: w, height: h});
            s.card = card;
            s.status = status;
            body.add_child(s.slot);
        }
        this._panelHead = head;
        this._panelBody = body;
        card.width = this._panelCardWidth();
        status.text = this._wpState(1).win ? '' : _('Starting…');
        return card;
    }

    _panelCardWidth() {
        const count = this._panelCount();
        return count * this._paneSize()[0] + (count - 1) * PANE_GAP;
    }

    _panelStates() {
        return Object.values(this._wp ?? {});
    }

    _clearPanelRefs() {
        for (const s of this._panelStates())
            s.slot = s.card = s.status = null;
        this._panelHead = this._panelBody = null;
    }

    // パネル側（大きさのボタン）で大きさが変わったら、カードと領域をその場で合わせる
    _resizePanelCard() {
        const [w, h] = this._paneSize();
        for (const s of this._panelStates()) {
            if (!s.slot)
                continue;
            s.slot.set_size(w, h);
            s.card.width = this._panelCardWidth();
        }
        this._place();
        this._syncPanel();
    }

    _ensurePanel(force = false) {
        const st = this._settings;
        const instances = this._panelStates().filter(s => s.slot).map(s => s.n).sort();
        if (!instances.length || !st.get_boolean('visible')) {
            // カードを隠した・ウィジェット全体を隠した → パネルも閉じる（最小化はできないため終了する）
            this._stopPanel('all');
            return;
        }
        if (this._panelRestarting)
            return; // 古いパネルの終了待ち（終わったら起動し直す）
        const look = `${this._isLight() ? 'light' : 'dark'}/${st.get_int('corner-radius')}/${instances.join(',')}/${getLang()}`;
        if (this._panelLook && this._panelLook !== look)
            force = true; // 見た目・パネルの数が変わったら起動し直す
        if (force) {
            // 古いパネルが完全に終わるのを待ってから起動する（同じアプリ ID は 1 つしか動けないので、
            // 終わる前に起動すると新しい方がすぐ終了して何も残らない）
            this._stopPanel(true);
            this._panelLook = null;
            this._panelRestarting = true;
            let tries = 0;
            this._panelRestartId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                const busy = this._findPanelWindow() || GLib.spawn_command_line_sync(`pgrep -f ${PANEL_SCRIPT_PATTERN}`)[1]?.length > 0;
                if (busy && ++tries < 40)
                    return GLib.SOURCE_CONTINUE;
                this._panelRestartId = 0;
                this._panelRestarting = false;
                this._ensurePanel();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        if (this._panelProc) {
            this._syncPanelSoon();
            return;
        }
        const existing = this._panelWindows();
        if (existing.length && !this._panelLook) {
            // 以前の起動（シェルの再起動前など）のパネルが残っていれば、起動し直して数と見た目を揃える
            this._panelLook = 'old';
            this._ensurePanel(true);
            return;
        }
        this._panelLook = look;
        for (const s of this._panelStates())
            s.sleeping = false; // 新しく起動したパネルは起きている
        try {
            this._panelProc = Gio.Subprocess.new(['gjs', '-m', GLib.build_filenamev([this.path, 'webpanel.js']),
                '--instances', instances.join(','),
                '--lang', getLang(), '--theme', this._isLight() ? 'light' : 'dark', '--radius', String(st.get_int('corner-radius')),
                '--schemas', GLib.build_filenamev([this.path, 'schemas'])], Gio.SubprocessFlags.NONE);
            this._panelProc.wait_async(null, () => {
                this._panelProc = null;
            });
        } catch (e) {
            logError(e, 'jasmine-launcher: webpanel');
            for (const s of this._panelStates()) {
                if (s.status)
                    s.status.text = _('Couldn’t start');
            }
        }
    }

    _stopPanel(closeWindow = false) {
        this._panelProc?.force_exit();
        this._panelProc = null;
        if (this._panelRestartId && closeWindow === 'all') {
            GLib.source_remove(this._panelRestartId);
            this._panelRestartId = 0;
            this._panelRestarting = false;
        }
        if (closeWindow) {
            for (const w of this._panelWindows()) {
                try {
                    w.delete(global.get_current_time());
                } catch {}
            }
        }
        if (this._panelSyncId)
            GLib.source_remove(this._panelSyncId);
        this._panelSyncId = 0;
        for (const s of this._panelStates())
            s.win = null;
        if (closeWindow === 'all')
            this._panelLook = null;
    }

    _isPanel(w) {
        return w?.get_gtk_application_id?.() === PANEL_ID || (w?.get_wm_class() ?? '').includes('JasmineLauncherWebPanel');
    }

    // パネルのウィンドウの番号（題名の末尾の数字。無ければ 1）
    _panelIndex(w) {
        return parseInt((w?.get_title() ?? '').match(/(\d+)\s*$/)?.[1] ?? '1');
    }

    _panelWindows() {
        return global.get_window_actors().map(a => a.meta_window).filter(w => this._isPanel(w));
    }

    _findPanelWindow() {
        return this._panelWindows()[0] ?? null;
    }

    // 窓ができた直後は app id や題名がまだ無いことがあるので、少し待ってから確かめる
    _adoptPanelSoon(w) {
        let n = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            if (!this._settings)
                return GLib.SOURCE_REMOVE;
            if (this._isPanel(w) && w.get_title()) {
                this._adoptPanel(w);
                return GLib.SOURCE_REMOVE;
            }
            return ++n < 40 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
    }

    _adoptPanel(w) {
        const s = this._wpState(this._panelIndex(w));
        if (s.win === w)
            return;
        s.win = w;
        w.connect('unmanaged', () => {
            if (s.win === w)
                s.win = null;
        });
        // できた直後はアプリ側の最初の大きさで上書きされることがあるので、枠からずれたら合わせ直す
        for (const sig of ['size-changed', 'position-changed', 'shown'])
            w.connect(sig, () => this._panelDrifted(s) && this._syncPanelSoon());
        try {
            // 種類を「デスクトップ」にすると、常にほかのウィンドウの裏・Alt+Tab や概要画面に出ない（Desktop Icons NG と同じ方法）
            w.set_type(Meta.WindowType.DESKTOP);
            w.stick();
        } catch (e) {
            logError(e, 'jasmine-launcher: webpanel below');
        }
        if (s.status && s.n === 1)
            s.status.text = '';
        this._syncPanelSoon();
    }

    _panelDrifted(s) {
        if (!s.win || !s.slot?.get_stage() || !this._column?.visible)
            return false;
        const r = s.win.get_frame_rect();
        const [x, y] = s.slot.get_transformed_position();
        return Math.abs(r.x - x) > 1 || Math.abs(r.y - y) > 1 || Math.abs(r.width - s.slot.width) > 1 || Math.abs(r.height - s.slot.height) > 1;
    }

    _syncPanelSoon() {
        if (this._panelSyncId)
            return;
        this._panelSyncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            this._panelSyncId = 0;
            this._syncPanel();
            return GLib.SOURCE_REMOVE;
        });
    }

    // まだ取り込んでいないパネルのウィンドウを取り込む（できた直後は題名・アプリ ID が遅れて付くことがある）
    _panelAdoptAll() {
        for (const w of this._panelWindows()) {
            if (w.get_title() && this._wpState(this._panelIndex(w)).win !== w)
                this._adoptPanel(w);
        }
    }

    // パネルのウィンドウを、それぞれのカードの中の領域に合わせる
    _syncPanel() {
        this._panelAdoptAll();
        for (const s of this._panelStates()) {
            if (!s.win)
                continue;
            const slot = s.slot;
            if (!slot || !this._column?.visible || !slot.get_stage())
                continue;
            try {
                // 余白なし: カードの中の領域いっぱいに重ねる
                const [x, y] = slot.get_transformed_position();
                s.win.move_resize_frame(false, Math.round(x), Math.round(y), Math.round(slot.width), Math.round(slot.height));
            } catch (e) {
                logError(e, 'jasmine-launcher: webpanel sync');
            }
        }
    }

    // ---- 見回り: まだ取り込んでいないパネルのウィンドウを 5 秒ごとに取り込む（自動休止は v45 でやめた）
    _panelWatch() {
        this._panelWatchId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 5, () => {
            this._panelAdoptAll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _panelUnwatch() {
        if (this._panelWatchId)
            GLib.source_remove(this._panelWatchId);
        this._panelWatchId = 0;
    }

    // パネル側のアクション（sleep-N / wake-N）を D-Bus の org.gtk.Actions で呼ぶ
    _panelAction(name) {
        Gio.DBus.session.call(PANEL_ID, '/' + PANEL_ID.replaceAll('.', '/'), 'org.gtk.Actions', 'Activate',
            new GLib.Variant('(sava{sv})', [name, [], {}]), null, Gio.DBusCallFlags.NO_AUTO_START, 2000, null, (c, r) => {
                try {
                    c.call_finish(r);
                } catch {}
            });
    }

    // 全パネルのページを開き直して、溜まったメモリを捨てる（メモリ整理から）
    _panelReloadAll() {
        for (const s of this._panelStates()) {
            if (!s.win || s.sleeping)
                continue;
            this._panelAction(`sleep-${s.n}`);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                if (!s.sleeping)
                    this._panelAction(`wake-${s.n}`);
                return GLib.SOURCE_REMOVE;
            });
        }
    }
}
