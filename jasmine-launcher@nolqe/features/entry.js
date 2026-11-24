// Jasmine Launcher: features/entry.js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {takeKeyFocus, releaseKeyFocus} from '../launcher.js';

export class EntryPart {
    // ---- 入力欄（背景レイヤーにキー入力を届けるため、入力中だけウィジェット全体をモーダルにする） ----
    _makeEntry(hint, {password = false, onActivate = null} = {}) {
        const entry = new St.Entry({style_class: 'jw-entry', hint_text: hint, can_focus: true, x_expand: true});
        const text = entry.clutter_text;
        if (password)
            text.password_char = 0x25cf; // ●
        text.connect('button-press-event', () => {
            this._focusEntry(entry);
            return Clutter.EVENT_PROPAGATE;
        });
        if (onActivate)
            text.connect('activate', onActivate);
        text.connect('key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape) {
                this._ungrab();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return entry;
    }

    _focusEntry(entry) {
        if (!this._column || !entry)
            return;
        if (!this._grab) {
            this._grab = true; // 入力中の印（ドラッグを始めないため）。画面の入力は独占しない
            this._stageId = global.stage.connect('captured-event', (_s, ev) => {
                const t = ev.type();
                if (t !== Clutter.EventType.BUTTON_PRESS && t !== Clutter.EventType.TOUCH_BEGIN)
                    return Clutter.EVENT_PROPAGATE;
                const src = global.stage.get_event_actor(ev);
                if (!src || !this._column?.contains(src))
                    this._ungrab();
                return Clutter.EVENT_PROPAGATE;
            });
            this._entryFocusId = global.display.connect('notify::focus-window', () => {
                if (global.display.focus_window)
                    this._ungrab();
            });
        }
        takeKeyFocus(entry.clutter_text);
    }

    _ungrab() {
        if (this._stageId) {
            global.stage.disconnect(this._stageId);
            this._stageId = 0;
        }
        if (this._entryFocusId) {
            global.display.disconnect(this._entryFocusId);
            this._entryFocusId = 0;
        }
        if (this._grab) {
            this._grab = null;
            releaseKeyFocus(this._column);
        }
    }
}
