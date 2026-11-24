// Jasmine Launcher — search popup & result list (apps, math, web, AI, system actions).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_, _f} from './i18n.js';

const MAX_APPS = 5;
const ELLIPSIZE_END = 3;

// ---- 計算（+ - * / % ^ と括弧。全角も可） ----
function calc(input) {
    const s = input.normalize('NFKC').replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/\s+/g, '').replace(/=$/, '');
    if (!/^[\d.+\-*/%^()]+$/.test(s) || !/\d/.test(s) || !/[+\-*/%^]/.test(s.replace(/^-/, '')))
        return null;
    let i = 0;
    const peek = () => s[i];
    const num = () => {
        const m = /^\d*\.?\d+/.exec(s.slice(i));
        if (!m)
            throw new Error('num');
        i += m[0].length;
        return parseFloat(m[0]);
    };
    const factor = () => {
        if (peek() === '-') {
            i++;
            return -factor();
        }
        if (peek() === '+') {
            i++;
            return factor();
        }
        let v;
        if (peek() === '(') {
            i++;
            v = expr();
            if (peek() !== ')')
                throw new Error('paren');
            i++;
        } else {
            v = num();
        }
        if (peek() === '^') {
            i++;
            v **= factor();
        }
        return v;
    };
    const term = () => {
        let v = factor();
        while (['*', '/', '%'].includes(peek())) {
            const op = s[i++];
            const r = factor();
            v = op === '*' ? v * r : op === '/' ? v / r : v % r;
        }
        return v;
    };
    const expr = () => {
        let v = term();
        while (['+', '-'].includes(peek())) {
            const op = s[i++];
            const r = term();
            v = op === '+' ? v + r : v - r;
        }
        return v;
    };
    try {
        const v = expr();
        if (i !== s.length || !Number.isFinite(v))
            return null;
        return String(Number(v.toPrecision(12)));
    } catch {
        return null;
    }
}

function spawn(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
        logError(e, 'jasmine-launcher: launcher spawn');
    }
}

const SYSTEM = [
    {keys: ['ロック', 'lock', 'ろっく'], title: 'Lock screen', icon: 'system-lock-screen-symbolic', run: () => Main.screenShield?.lock(true)},
    {keys: ['スリープ', 'サスペンド', 'sleep', 'suspend', 'すりーぷ'], title: 'Suspend', icon: 'weather-clear-night-symbolic', run: () => spawn(['systemctl', 'suspend'])},
    {keys: ['ログアウト', 'logout', 'ろぐあうと'], title: 'Log out…', icon: 'system-log-out-symbolic', run: () => spawn(['gnome-session-quit', '--logout'])},
    {keys: ['再起動', 'restart', 'reboot', 'さいきどう'], title: 'Restart…', icon: 'system-reboot-symbolic', run: () => spawn(['gnome-session-quit', '--reboot'])},
    {keys: ['シャットダウン', '電源', 'shutdown', 'poweroff', 'しゃっとだうん'], title: 'Power off…', icon: 'system-shutdown-symbolic', run: () => spawn(['gnome-session-quit', '--power-off'])},
];

// 候補を作る。actions = {web(q), claude(q), muse(q), isUrl(q), webIcon, museIcon}
export function searchItems(text, actions) {
    const q = text.trim();
    if (!q)
        return [];
    const items = [];
    const rest = q.slice(1).trim();

    if (q.startsWith('>'))
        return [{icon: 'utilities-terminal-symbolic', title: rest ? _f('Ask Claude: {0}', rest) : _('Open Claude Code'), subtitle: _('New session'), run: () => actions.claude(rest)}];
    if (q.startsWith('@') && actions.quickSendName)
        return [{icon: actions.quickSendIcon, title: rest ? _f('Send to {0}: {1}', actions.quickSendName, rest) : _f('Open {0}', actions.quickSendName), subtitle: _('Pastes only — you press send'), run: () => actions.quickSend(rest)}];
    if (q.startsWith('?'))
        return rest ? [{icon: actions.webIcon, title: _f('Search the web: {0}', rest), subtitle: actions.webName, run: () => actions.web(rest)}] : [];

    const v = calc(q);
    if (v !== null) {
        items.push({icon: 'accessories-calculator-symbolic', title: `= ${v}`, subtitle: _('Enter to copy'), run: () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, v);
            Main.notify(_('Copied'), v);
        }});
    }

    // アプリ（GNOME の概要画面と同じ検索）
    const sys = Shell.AppSystem.get_default();
    const terms = q.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0;
    for (const group of Shell.AppSystem.search(terms.join(' ')) ?? []) {
        for (const id of group) {
            if (n >= MAX_APPS)
                break;
            const app = sys.lookup_app(id);
            if (!app || !app.app_info?.should_show())
                continue;
            items.push({icon: app.get_icon(), title: app.get_name(), subtitle: app.get_description() ?? '', run: () => app.activate()});
            n++;
        }
    }

    const low = q.toLowerCase();
    for (const s of SYSTEM) {
        if (s.keys.some(k => k.startsWith(low) || low.startsWith(k)))
            items.push({icon: s.icon, title: _(s.title), subtitle: _('System'), run: s.run});
    }

    // 最後に Web 検索（URL らしければ「開く」）
    const isUrl = actions.isUrl(q);
    items.push({icon: actions.webIcon, title: isUrl ? _f('Open: {0}', q) : _f('Search the web: {0}', q), subtitle: actions.webName, run: () => actions.web(q)});
    return items;
}

// 候補リストの表示（ポップアップとカードで共用）
export class ResultView {
    constructor(onActivate) {
        this.actor = new St.BoxLayout({style_class: 'jw-results', orientation: Clutter.Orientation.VERTICAL, visible: false});
        this._items = [];
        this._rows = [];
        this._sel = 0;
        this._onActivate = onActivate;
    }

    set(items) {
        this._items = items;
        this._sel = 0;
        this.actor.destroy_all_children();
        this._rows = items.map((it, idx) => {
            const row = new St.Button({style_class: 'jw-result', x_expand: true, can_focus: false});
            const box = new St.BoxLayout({style_class: 'jw-result-box', x_expand: true});
            const icon = new St.Icon({style_class: 'jw-result-icon', icon_size: 28, y_align: Clutter.ActorAlign.CENTER});
            if (it.icon instanceof Gio.Icon)
                icon.gicon = it.icon;
            else
                icon.icon_name = it.icon || 'application-x-executable-symbolic';
            const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            const t = new St.Label({style_class: 'jw-result-title', text: it.title});
            t.clutter_text.ellipsize = ELLIPSIZE_END;
            text.add_child(t);
            if (it.subtitle) {
                const s = new St.Label({style_class: 'jw-result-sub', text: it.subtitle});
                s.clutter_text.ellipsize = ELLIPSIZE_END;
                text.add_child(s);
            }
            box.add_child(icon);
            box.add_child(text);
            row.set_child(box);
            row.connect('clicked', () => this.activate(idx));
            row.connect('notify::hover', () => {
                if (row.hover)
                    this._select(idx);
            });
            this.actor.add_child(row);
            return row;
        });
        this.actor.visible = items.length > 0;
        this._select(0);
    }

    _select(idx) {
        if (!this._rows.length)
            return;
        this._sel = (idx + this._rows.length) % this._rows.length;
        this._rows.forEach((r, i) => {
            if (i === this._sel)
                r.add_style_pseudo_class('selected');
            else
                r.remove_style_pseudo_class('selected');
        });
    }

    move(d) {
        this._select(this._sel + d);
    }

    activate(idx = this._sel) {
        const it = this._items[idx];
        if (!it)
            return;
        this._onActivate();
        try {
            it.run();
        } catch (e) {
            logError(e, 'jasmine-launcher: launcher run');
        }
    }

    // 入力欄のキー処理（↑↓で選択、Enter で実行）。処理したら true
    handleKey(sym) {
        if (sym === Clutter.KEY_Down || sym === Clutter.KEY_Tab) {
            this.move(1);
            return true;
        }
        if (sym === Clutter.KEY_Up || sym === Clutter.KEY_ISO_Left_Tab) {
            this.move(-1);
            return true;
        }
        if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
            this.activate();
            return true;
        }
        return false;
    }
}

// 画面全体の入力を独占（モーダル）せずに、キーボードの入力だけを actor に向ける。
// ウィンドウからフォーカスを外して GNOME 側（ステージ）に移すと、キー入力が actor に届く。マウスはほかの場所にも普通に届く。
export function takeKeyFocus(actor) {
    try {
        global.display.unset_input_focus(global.get_current_time());
    } catch (e) {
        logError(e, 'jasmine-launcher: unset_input_focus');
    }
    global.stage.set_key_focus(actor);
}

export function releaseKeyFocus(owner) {
    const f = global.stage.get_key_focus();
    if (f && owner?.contains(f))
        global.stage.set_key_focus(null);
}

// Super+F のポップアップ
export class LauncherPopup {
    constructor(ext) {
        this._ext = ext;
        this._grab = null;
        this.actor = new St.BoxLayout({
            style_class: 'jw-launcher',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            visible: false,
        });
        this._entry = new St.Entry({style_class: 'jw-entry jw-launcher-entry', hint_text: _('Search'), can_focus: true, x_expand: true});
        this._entry.set_primary_icon(new St.Icon({icon_name: 'system-search-symbolic', style_class: 'jw-entry-icon'}));
        this._footer = new St.Label({style_class: 'jw-launcher-footer',
            text: _('↑↓ select    Enter open    Esc close    ? web    > AI')});
        this._results = new ResultView(() => this.close());
        this._entry.clutter_text.connect('text-changed', () => this._update());
        this._entry.clutter_text.connect('key-press-event', (_a, ev) => {
            const sym = ev.get_key_symbol();
            if (sym === Clutter.KEY_Escape || (sym === Clutter.KEY_BackSpace && this._entry.text === '')) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return this._results.handleKey(sym) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
        this.actor.add_child(this._entry);
        this.actor.add_child(this._results.actor);
        this.actor.add_child(this._footer);
        Main.layoutManager.addTopChrome(this.actor);
    }

    get visible() {
        return this.actor.visible;
    }

    toggle() {
        if (this.visible)
            this.close();
        else
            this.open();
    }

    open() {
        if (this.visible)
            return;
        const a = this._ext._launcherActions();
        this._footer.text = a.quickSendName
            ? _f('↑↓ select    Enter open    Esc close    ? web    > AI    @ {0}', a.quickSendName)
            : _('↑↓ select    Enter open    Esc close    ? web    > AI');
        this._ext._styleLauncher(this.actor);
        this._entry.text = '';
        this._results.set([]);
        this.actor.visible = true;
        this._position();
        // ふわっと出す
        this.actor.set_pivot_point(0.5, 0);
        this.actor.opacity = 0;
        this.actor.scale_x = this.actor.scale_y = 0.97;
        this.actor.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        // ほかの場所を押したら閉じる。押した操作はそのまま届ける（入力を独占しない）
        this._stageId = global.stage.connect('captured-event', (_s, ev) => {
            const t = ev.type();
            if (t !== Clutter.EventType.BUTTON_PRESS && t !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;
            const src = global.stage.get_event_actor(ev);
            if (!src || !this.actor.contains(src))
                this.close(!!(src && this._ext._column?.contains(src))); // カードを押したならウィジェットは出したまま
            return Clutter.EVENT_PROPAGATE;
        });
        takeKeyFocus(this._entry.clutter_text);
        // ほかのウィンドウが選ばれたら閉じる（開いた直後の切り替えは無視）
        this._focusId = global.display.connect('notify::focus-window', () => {
            if (global.display.focus_window)
                this.close();
        });
        // 入力欄からキーボードが離れたら閉じる
        this._keyOutId = this._entry.clutter_text.connect('key-focus-out', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                const f = global.stage.get_key_focus();
                if (this.visible && !(f && this.actor.contains(f)))
                    this.close();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    // keepOverlay: 一緒に出したウィジェットを残す（true）か、一緒に戻す（false）
    close(keepOverlay = false) {
        if (!this.visible)
            return;
        if (this._stageId) {
            global.stage.disconnect(this._stageId);
            this._stageId = 0;
        }
        if (this._focusId) {
            global.display.disconnect(this._focusId);
            this._focusId = 0;
        }
        if (this._keyOutId) {
            this._entry.clutter_text.disconnect(this._keyOutId);
            this._keyOutId = 0;
        }
        this.actor.visible = false;
        releaseKeyFocus(this.actor);
        this._ext._onLauncherClosed?.(keepOverlay);
        // キーボードを元のウィンドウに戻す
        if (!global.display.focus_window)
            global.display.focus_default_window(global.get_current_time());
    }

    _update() {
        this._results.set(searchItems(this._entry.text, this._ext._launcherActions()));
        this._position();
    }

    _position() {
        const m = Main.layoutManager.focusMonitor ?? Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const st = this._ext._settings;
        const w = Math.min(st?.get_int('launcher-width') || 600, m.width - 32);
        const top = Math.min(80, Math.max(0, st?.get_int('launcher-top') ?? 22)) / 100;
        this.actor.width = w;
        this.actor.set_position(Math.round(m.x + (m.width - w) / 2), Math.round(m.y + m.height * top));
    }

    destroy() {
        this.close();
        this.actor.destroy();
    }
}
