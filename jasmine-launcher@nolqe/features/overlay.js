// Jasmine Launcher: features/overlay.js
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class OverlayPart {
    // ---- オーバーレイ: ウィンドウはそのままで、ウィジェットをウィンドウの上に重ねて出す ----
    // 土台（_column）を壁紙の層から画面の一番上の層（バーと Dock の下）へ一時的に移し、後ろを少し暗くする。
    // Web パネルは本物のウィンドウなので、オーバーレイ中だけ種類を「ドック」（ほかのウィンドウより上・Alt+Tab に出ない）に
    // 変えて前に出し、そのまま触れるようにする（カードのほうは隠す）。戻すときに「デスクトップ」（常に裏）へ戻す。
    // （種類は「普通」＋常に手前。ドックだとクリックしても文字が打てなかった）
    // 戻る: もう一度ボタン・Esc・暗いところをクリック・ほかのウィンドウへ切り替え／新しいウィンドウ・概要・ワークスペース切り替え
    _togglePeek() {
        if (this._peeking)
            this._endPeek(true);
        else
            this._startPeek();
    }

    // fromLauncher: ランチャーと一緒に出す（ランチャーを閉じたら一緒に戻る。カードを押したらそのまま残る）
    _startPeek(fromLauncher = false) {
        if (this._peeking || !this._column?.visible)
            return; // ウィジェットを非表示にしているときは何もしない
        if (Main.overview.visible)
            Main.overview.hide();
        if (!fromLauncher)
            this._launcher?.close?.();
        this._peeking = true;
        this._peekByLauncher = fromLauncher;
        this._peekFocus = global.display.focus_window;
        const ease = {duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD};
        const ui = Main.layoutManager.uiGroup;

        // 背景はぼかさず・暗くせず、そのまま触れるようにする（2026-11-23 すりガラスはやめた）
        const col = this._column;
        col.get_parent()?.remove_child(col);
        ui.insert_child_below(col, Main.layoutManager.panelBox);

        // Web パネル（本物のウィンドウ）は前に出して触れるようにする
        this._peekClones = [];
        this._peekPanels = [];
        for (const w of this._panelWindows?.() ?? []) {
            try {
                // ドックの種類だとキーボードの入力先にならないので、普通のウィンドウ＋常に手前にする
                w.set_type(Meta.WindowType.NORMAL);
                w.make_above();
                w.raise();
                this._peekPanels.push(w);
            } catch (e) {
                logError(e, 'jasmine-launcher: peek panel');
            }
        }
        this._peekPanelCard = this._peekPanels.length ? this._cards?.find(c => c.key === 'webpanel')?.actor ?? null : null;
        if (this._peekPanelCard) {
            this._peekPanelCard.opacity = 0;
            this._peekPanelCard.reactive = false;
        }

        this._peekShade?.ease({...ease, opacity: 255});
        for (const a of [col, ...this._peekPanels.map(w => w.get_compositor_private()).filter(Boolean)]) {
            a.opacity = 0;
            a.translation_y = 10;
            a.ease({...ease, opacity: 255, translation_y: 0});
        }

        global.display.unset_input_focus(global.get_current_time());
        const end = () => this._endPeek(false);
        this._peekSigs = [
            [global.display, global.display.connect('window-created', end)],
            [global.display, global.display.connect('notify::focus-window', () => {
                const w = global.display.focus_window;
                if (w && w.get_window_type() !== Meta.WindowType.DESKTOP && !this._isPanel(w))
                    end();
            })],
            [global.workspace_manager, global.workspace_manager.connect('active-workspace-changed', end)],
            [Main.overview, Main.overview.connect('showing', end)],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', end)],
            [global.stage, global.stage.connect('captured-event', (_a, ev) => {
                const t = ev.type();
                if (t === Clutter.EventType.KEY_PRESS && ev.get_key_symbol() === Clutter.KEY_Escape) {
                    this._endPeek(true);
                    return Clutter.EVENT_STOP;
                }
                // ウィジェットの外（ウィンドウ・壁紙）を押したら戻す。押した操作はそのまま届ける。
                // ランチャー・上のバー・Dock などの画面上部の部品は対象外
                if (t === Clutter.EventType.BUTTON_PRESS || t === Clutter.EventType.TOUCH_BEGIN) {
                    const src = global.stage.get_event_actor(ev);
                    const ui = Main.layoutManager.uiGroup;
                    const chrome = src && ui.contains(src) && !global.window_group.contains(src);
                    const panel = src && (this._peekPanels ?? []).some(w => w.get_compositor_private?.()?.contains(src));
                    if (!(src && this._column?.contains(src)) && !(this._launcher?.visible && this._launcher.actor.contains(src)) && !chrome && !panel)
                        this._endPeek(false);
                }
                return Clutter.EVENT_PROPAGATE;
            })],
        ];
    }

    _endPeek(restoreFocus) {
        if (!this._peeking)
            return;
        this._peeking = false;
        this._peekByLauncher = false;
        if (this._launcher?.visible)
            this._launcher.close(true);
        for (const [obj, id] of this._peekSigs ?? [])
            obj.disconnect(id);
        this._peekSigs = null;
        const col = this._column;
        if (col) {
            col.remove_all_transitions();
            col.opacity = 255;
            col.translation_y = 0;
            col.get_parent()?.remove_child(col);
            Main.layoutManager._backgroundGroup.add_child(col);
        }
        for (const w of this._peekPanels ?? []) {
            try {
                const a = w.get_compositor_private?.();
                if (a) {
                    a.remove_all_transitions();
                    a.opacity = 255;
                    a.translation_y = 0;
                }
                w.unmake_above();
                w.set_type(Meta.WindowType.DESKTOP);
            } catch {}
        }
        this._peekPanels = [];
        this._peekClones = [];
        if (this._peekPanelCard) {
            this._peekPanelCard.opacity = 255;
            this._peekPanelCard.reactive = true;
        }
        this._peekPanelCard = null;
        const shade = this._peekShade;
        this._peekShade = null;
        if (shade) {
            shade.reactive = false;
            shade.ease({opacity: 0, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => shade.destroy()});
        }
        const w = this._peekFocus;
        this._peekFocus = null;
        if (restoreFocus && w && !global.display.focus_window) {
            try {
                w.activate(global.get_current_time());
            } catch {}
        }
    }

    // ランチャーが閉じたとき（launcher.js から）。keep: カードを押して閉じた → オーバーレイはそのまま残す
    _onLauncherClosed(keep) {
        if (!this._peeking || !this._peekByLauncher)
            return;
        if (keep)
            this._peekByLauncher = false;
        else
            this._endPeek(true);
    }
}
