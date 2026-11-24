// Jasmine Launcher: features/swipe.js
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class SwipePart {
    // ---- タッチパッドの 3 本指で下へスワイプ → 前面のウィンドウを最小化 ----
    // GNOME 標準の 3 本指（上: 概要、下: 概要を閉じる）はそのまま。概要が出ていないときの「下」は GNOME では何も起きないので、そこだけ使う。
    // イベントは横取りせず見るだけ（GNOME のジェスチャーにもそのまま届く）。
    // GNOME のジェスチャー処理より先に見るため、stage の captured-event ではなくイベントフィルターを使う
    _swipeWatch() {
        this._swipe = null;
        this._swipeId = Clutter.Event.add_filter(global.stage, ev => {
            if (ev.type() !== Clutter.EventType.TOUCHPAD_SWIPE)
                return Clutter.EVENT_PROPAGATE;
            const phase = ev.get_gesture_phase();
            if (phase === Clutter.TouchpadGesturePhase.BEGIN) {
                // 始めた時点で概要・ほかの画面（ロックなど）が出ていなければ対象
                this._swipe = this._settings?.get_boolean('swipe-minimize') && ev.get_touchpad_gesture_finger_count() === 3 && !Main.overview.visible &&
                    Main.actionMode === Shell.ActionMode.NORMAL ? {dx: 0, dy: 0} : null;
            } else if (phase === Clutter.TouchpadGesturePhase.UPDATE && this._swipe) {
                const [dx, dy] = ev.get_gesture_motion_delta_unaccelerated();
                this._swipe.dx += dx;
                this._swipe.dy += dy;
            } else if (phase === Clutter.TouchpadGesturePhase.END || phase === Clutter.TouchpadGesturePhase.CANCEL) {
                const sw = this._swipe;
                this._swipe = null;
                if (phase === Clutter.TouchpadGesturePhase.END && sw && sw.dy > 60 && sw.dy > Math.abs(sw.dx) * 1.5 && !Main.overview.visible) {
                    const w = global.display.focus_window;
                    if (w?.can_minimize() && w.get_window_type() === Meta.WindowType.NORMAL)
                        w.minimize();
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _swipeUnwatch() {
        if (this._swipeId)
            Clutter.Event.remove_filter(this._swipeId);
        this._swipeId = 0;
        this._swipe = null;
    }
}
