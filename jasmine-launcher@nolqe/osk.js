// Jasmine Widgets: フローティングキーボード（タブレットモード用。GNOME の画面キーボードの代わり）
// ・画面の上に浮かぶ小さなキーボード。上の細いバー（つかみ）をドラッグして好きな場所へ動かせる（位置は osk-pos に保存）
// ・QWERTY ＋ 数字・記号の面。ローマ字で打てば Mozc がそのまま日本語にする（キーは本物のキー入力として送るので IBus を通る）
// ・上の段: Esc / Tab / Ctrl / 矢印 / コピー・貼り付け（Ctrl+C / Ctrl+V） / 大きさ（S・M・L・XL） / 隠す。「あA」は半角/全角キー（Mozc の日本語⇔英数）
// ・Shift は 1 回押すと次の 1 文字だけ大文字、2 回続けて押すと固定。Ctrl も次の 1 キーだけ
// ・⌫ と矢印は押しっぱなしで連続入力
// ・出し方: タブレットモード中、画面の下端から上へスワイプ（GNOME の画面キーボードやスマホと同じ）。もう一度スワイプでしまう。
//   文字入力欄にフォーカスが移ったとき（アプリが要求したとき）も自動で出る。しまうのは右上の「隠す」キー
// キーボードのボタンはフォーカスを取らないので、文字はそのとき使っているウィンドウに入る。
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getLang} from './i18n.js';

// 大きさ（幅 px、キーの高さ px）
const SIZES = [['S', 560, 40], ['M', 680, 46], ['L', 820, 54], ['XL', 1000, 64]];
const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 50;
const DOUBLE_TAP = 350;

// キーの定義: 文字はそのまま送る。{k: 特殊キー名, l: 表示, w: 幅の比}
const LETTERS = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '-'],
    [{k: 'shift', l: '⇧', w: 1.5}, 'z', 'x', 'c', 'v', 'b', 'n', 'm', {k: 'BackSpace', l: '⌫', w: 1.5, repeat: true}],
    [{k: 'sym', l: '?123', w: 1.5}, {k: 'ime', l: 'あA', w: 1.2}, ',', {k: 'space', l: '', w: 3.6}, '.', {k: 'Return', l: '↵', w: 1.7, accent: true}],
];
const SYMBOLS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['/', ':', ';', '(', ')', '&', '@', '"', '\'', '_'],
    ['#', '?', '!', '=', '+', '*', '%', '~', {k: 'BackSpace', l: '⌫', w: 2, repeat: true}],
    [{k: 'sym', l: 'ABC', w: 1.5}, {k: 'ime', l: 'あA', w: 1.2}, ',', {k: 'space', l: '', w: 3.6}, '.', {k: 'Return', l: '↵', w: 1.7, accent: true}],
];
const STRIP = [
    {k: 'Escape', l: 'Esc'}, {k: 'Tab', l: 'Tab'}, {k: 'ctrl', l: 'Ctrl'},
    {k: 'Left', l: '←', repeat: true}, {k: 'Down', l: '↓', repeat: true}, {k: 'Up', l: '↑', repeat: true}, {k: 'Right', l: '→', repeat: true},
    {k: 'copy', icon: 'edit-copy-symbolic', combo: 'c'}, {k: 'paste', icon: 'edit-paste-symbolic', combo: 'v'},
];
const KEYVAL = {
    BackSpace: Clutter.KEY_BackSpace, Return: Clutter.KEY_Return, Escape: Clutter.KEY_Escape, Tab: Clutter.KEY_Tab,
    Left: Clutter.KEY_Left, Right: Clutter.KEY_Right, Up: Clutter.KEY_Up, Down: Clutter.KEY_Down,
    space: Clutter.KEY_space, ime: Clutter.KEY_Zenkaku_Hankaku,
};

export class FloatingKeyboard {
    constructor(ext) {
        this._ext = ext;
        this._settings = ext._settings;
        this._active = false; // タブレットモード中
        this._shown = false;
        this._autoShown = false;
        this._symbols = false;
        this._shift = 0; // 0 = なし / 1 = 次の 1 文字 / 2 = 固定
        this._shiftAt = 0;
        this._ctrl = false;
        this._repeatId = 0;
        this._device = null; // 仮想キーボードは最初に打ったときに作る
        this._imId = 0;
        try {
            // アプリが「文字入力のパネルを出して／隠して」と言ったとき（GNOME の画面キーボードと同じ合図）
            this._imId = Main.inputMethod.connect('input-panel-state', (_im, state) => this._onPanelState(state));
        } catch (e) {
            logError(e, 'jasmine-launcher: osk input-panel-state');
        }
    }

    destroy() {
        this._removeEdge();
        this._stopRepeat();
        if (this._imId)
            Main.inputMethod.disconnect(this._imId);
        this._imId = 0;
        this._endDrag();
        this._destroyActors();
        this._device = null;
    }

    // タブレットモードのオン・オフ
    setActive(on) {
        this._active = on;
        if (on) {
            this._addEdge();
        } else {
            this._removeEdge();
            this.hide();
            this._destroyActors();
        }
    }

    // 画面の下端から上へのスワイプ（タッチ）。下端 EDGE px 以内で触れて、上へ SWIPE px 動いたら出す。
    // イベントは見るだけで横取りしない（アプリ・GNOME にもそのまま届く）
    _addEdge() {
        if (this._edgeId)
            return;
        const EDGE = 16, SWIPE = 60;
        this._edgeTouch = null;
        this._edgeId = Clutter.Event.add_filter(global.stage, ev => {
            const t = ev.type();
            if (t === Clutter.EventType.TOUCH_BEGIN) {
                const m = Main.layoutManager.primaryMonitor;
                const [x, y] = ev.get_coords();
                this._edgeTouch = m && y >= m.y + m.height - EDGE && x >= m.x && x < m.x + m.width
                    ? {seq: ev.get_event_sequence(), y} : null;
            } else if (t === Clutter.EventType.TOUCH_UPDATE && this._edgeTouch) {
                const [, y] = ev.get_coords();
                if (this._edgeTouch.y - y >= SWIPE) {
                    this._edgeTouch = null;
                    // 出ていなければ出す、出ていればしまう
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this.toggle();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } else if (t === Clutter.EventType.TOUCH_END || t === Clutter.EventType.TOUCH_CANCEL) {
                this._edgeTouch = null;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _removeEdge() {
        if (this._edgeId)
            Clutter.Event.remove_filter(this._edgeId);
        this._edgeId = 0;
        this._edgeTouch = null;
    }

    toggle() {
        if (this._shown)
            this.hide();
        else
            this.show();
    }

    show(auto = false) {
        if (!this._active)
            return;
        this._autoShown = auto;
        if (!this._actor)
            this._build();
        if (this._shown)
            return;
        this._shown = true;
        this._actor.show();
        this._place();
        this._actor.opacity = 0;
        this._actor.translation_y = 16;
        this._actor.ease({opacity: 255, translation_y: 0, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    hide() {
        this._stopRepeat();
        if (!this._shown)
            return;
        this._shown = false;
        this._autoShown = false;
        const a = this._actor;
        a?.ease({opacity: 0, translation_y: 16, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => a.hide()});
    }

    _onPanelState(state) {
        if (!this._active)
            return;
        if (state === Clutter.InputPanelState.ON)
            this.show(true);
        else if (state === Clutter.InputPanelState.TOGGLE)
            this.toggle();
        else if (state === Clutter.InputPanelState.OFF && this._autoShown)
            this.hide();
    }

    // ---- 見た目 ----
    _size() {
        const i = Math.max(0, Math.min(SIZES.length - 1, this._settings.get_int('osk-size')));
        const [name, w, h] = SIZES[i];
        // 縦向きなどで画面より広いときは、画面の幅に収める
        const m = Main.layoutManager.primaryMonitor;
        return [name, m ? Math.min(w, m.width - 16) : w, h];
    }

    _theme() {
        return this._ext._isLight() ? 'jw-light' : 'jw-dark';
    }

    _build() {
        const [, width, keyH] = this._size();
        const actor = new St.BoxLayout({style_class: `jw-osk ${this._theme()}`, orientation: Clutter.Orientation.VERTICAL, reactive: true, width});
        this._ext._styleCard(actor);
        actor.style += ' padding: 8px 8px 10px 8px;';

        // 上の段: つかみバー＋特殊キー
        const strip = new St.BoxLayout({style_class: 'jw-osk-row jw-osk-strip'});
        for (const d of STRIP)
            strip.add_child(this._key(d, Math.round(keyH * 0.72), 1));
        const handle = new St.Widget({style_class: 'jw-osk-handle', reactive: true, x_expand: true, layout_manager: new Clutter.BinLayout()});
        handle.add_child(new St.Widget({style_class: 'jw-grip', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        handle.connect('event', (_a, ev) => this._handleEvent(ev));
        strip.add_child(handle);
        this._sizeKey = this._key({k: 'size', l: this._size()[0]}, Math.round(keyH * 0.72), 1);
        strip.add_child(this._sizeKey);
        strip.add_child(this._key({k: 'hide', icon: 'go-down-symbolic'}, Math.round(keyH * 0.72), 1));
        actor.add_child(strip);

        this._rows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'jw-osk-rows'});
        actor.add_child(this._rows);
        this._actor = actor;
        this._fillRows();

        // どこで離しても連続入力を止める（指がキーの外へずれたとき）
        actor.connect('captured-event', (_a, ev) => {
            const t = ev.type();
            if (t === Clutter.EventType.BUTTON_RELEASE || t === Clutter.EventType.TOUCH_END || t === Clutter.EventType.TOUCH_CANCEL)
                this._stopRepeat();
            return Clutter.EVENT_PROPAGATE;
        });
        actor.hide();
        Main.layoutManager.addTopChrome(actor);
    }

    _fillRows() {
        const [, width, keyH] = this._size();
        this._rows.destroy_all_children();
        this._letterLabels = [];
        this._shiftKey = null; // 記号の面には Shift が無い
        const rows = this._symbols ? SYMBOLS : LETTERS;
        // キー 1 個ぶんの幅: 一番キーの多い段（10 個）が幅いっぱいになるように
        const inner = width - 16;
        const gap = 6;
        const unit = (inner - 9 * gap) / 10;
        for (const row of rows) {
            const box = new St.BoxLayout({style_class: 'jw-osk-row', x_align: Clutter.ActorAlign.CENTER});
            for (const d of row) {
                const def = typeof d === 'string' ? {ch: d, l: d} : d;
                const w = def.w ?? 1;
                const k = this._key(def, keyH, Math.round(unit * w + gap * (w - 1)));
                box.add_child(k);
            }
            this._rows.add_child(box);
        }
        this._syncMods();
    }

    // def: {ch: 文字} か {k: 特殊キー名}。width が 1 のときは中身に合わせる（上の段）
    _key(def, height, width) {
        const cls = ['jw-osk-key'];
        if (def.k && def.k !== 'space')
            cls.push('jw-osk-mod');
        const key = new St.Bin({style_class: cls.join(' '), reactive: true, height, x_align: Clutter.ActorAlign.START});
        if (width > 1)
            key.width = width;
        if (def.icon) {
            key.set_child(new St.Icon({icon_name: def.icon, icon_size: 16}));
        } else {
            const text = def.k === 'ime' ? (getLang() === 'ja' ? 'あA' : 'IME') : (def.l ?? '');
            const label = new St.Label({text, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER});
            key.set_child(label);
            if (def.ch && /^[a-z]$/.test(def.ch))
                this._letterLabels.push([label, def.ch]);
        }
        if (def.accent)
            key.style = `background-color: ${this._ext._accentHex()}; color: #ffffff;`;
        if (def.k === 'shift')
            this._shiftKey = key;
        if (def.k === 'ctrl')
            this._ctrlKey = key;
        key.connect('event', (_a, ev) => {
            const t = ev.type();
            if (t === Clutter.EventType.BUTTON_PRESS || t === Clutter.EventType.TOUCH_BEGIN) {
                key.add_style_pseudo_class('active');
                this._press(def);
                return Clutter.EVENT_STOP;
            }
            if (t === Clutter.EventType.BUTTON_RELEASE || t === Clutter.EventType.TOUCH_END || t === Clutter.EventType.TOUCH_CANCEL ||
                t === Clutter.EventType.LEAVE) {
                key.remove_style_pseudo_class('active');
                if (t !== Clutter.EventType.LEAVE)
                    this._stopRepeat();
                return t === Clutter.EventType.LEAVE ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return key;
    }

    // Shift・Ctrl の状態を見た目に出す（大文字表示・押されている色）
    _syncMods() {
        for (const [label, ch] of this._letterLabels ?? [])
            label.text = this._shift ? ch.toUpperCase() : ch;
        const on = `background-color: ${this._ext._accentHex()}; color: #ffffff;`;
        if (this._shiftKey)
            this._shiftKey.style = this._shift ? on + (this._shift === 2 ? ' box-shadow: inset 0 -3px 0 rgba(255, 255, 255, 0.7);' : '') : '';
        if (this._ctrlKey)
            this._ctrlKey.style = this._ctrl ? on : '';
    }

    // ---- 入力 ----
    _press(def) {
        switch (def.k) {
        case 'shift': {
            const now = GLib.get_monotonic_time() / 1000;
            if (this._shift === 1 && now - this._shiftAt < DOUBLE_TAP)
                this._shift = 2;
            else
                this._shift = this._shift ? 0 : 1;
            this._shiftAt = now;
            this._syncMods();
            return;
        }
        case 'ctrl':
            this._ctrl = !this._ctrl;
            this._syncMods();
            return;
        case 'sym':
            this._symbols = !this._symbols;
            this._fillRows();
            return;
        case 'hide':
            this.hide();
            return;
        case 'size': {
            const i = (Math.max(0, this._settings.get_int('osk-size')) + 1) % SIZES.length;
            this._settings.set_int('osk-size', i);
            this._rebuildKeepShown();
            return;
        }
        }
        if (def.combo) {
            // コピー・貼り付け（Ctrl+C / Ctrl+V）
            this._send(Clutter.unicode_to_keysym(def.combo.codePointAt(0)), true);
            if (this._ctrl) {
                this._ctrl = false;
                this._syncMods();
            }
            return;
        }
        let keyval;
        if (def.ch) {
            const ch = this._shift && /^[a-z]$/.test(def.ch) ? def.ch.toUpperCase() : def.ch;
            keyval = Clutter.unicode_to_keysym(ch.codePointAt(0));
        } else {
            keyval = KEYVAL[def.k];
        }
        if (!keyval)
            return;
        this._send(keyval);
        if (def.repeat)
            this._startRepeat(keyval);
        if (def.ch && this._shift === 1) {
            this._shift = 0;
            this._syncMods();
        }
        if (this._ctrl) {
            this._ctrl = false;
            this._syncMods();
        }
    }

    _seat() {
        // GNOME 51: Clutter.get_default_backend() は無いので stage の context から
        const backend = global.stage.context?.get_backend?.() ?? Clutter.get_default_backend?.();
        return backend?.get_default_seat();
    }

    _send(keyval, forceCtrl = false) {
        if (!this._device) {
            try {
                this._device = this._seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            } catch (e) {
                logError(e, 'jasmine-launcher: osk virtual keyboard');
                return;
            }
        }
        const dev = this._device;
        if (!dev)
            return;
        const t = () => GLib.get_monotonic_time();
        const ctrl = this._ctrl || forceCtrl;
        if (ctrl)
            dev.notify_keyval(t(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        dev.notify_keyval(t(), keyval, Clutter.KeyState.PRESSED);
        dev.notify_keyval(t(), keyval, Clutter.KeyState.RELEASED);
        if (ctrl)
            dev.notify_keyval(t(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    }

    _startRepeat(keyval) {
        this._stopRepeat();
        this._repeatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REPEAT_DELAY, () => {
            this._repeatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REPEAT_INTERVAL, () => {
                this._send(keyval);
                return GLib.SOURCE_CONTINUE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopRepeat() {
        if (this._repeatId)
            GLib.source_remove(this._repeatId);
        this._repeatId = 0;
    }

    _rebuildKeepShown() {
        const pos = this._actor ? [this._actor.x, this._actor.y] : null;
        this._actor?.destroy();
        this._actor = null;
        this._build();
        this._shown = true;
        this._actor.show();
        if (pos)
            this._actor.set_position(...this._clamp(...pos));
        else
            this._place();
    }

    // ---- 位置（下の中央が既定。動かしたら保存） ----
    _place() {
        const a = this._actor;
        const m = Main.layoutManager.primaryMonitor;
        if (!a || !m)
            return;
        let pos = null;
        try {
            pos = JSON.parse(this._settings.get_string('osk-pos') || 'null');
        } catch {}
        const [, h] = a.get_preferred_height(a.width);
        if (Array.isArray(pos))
            a.set_position(...this._clamp(pos[0], pos[1]));
        else
            a.set_position(...this._clamp(m.x + (m.width - a.width) / 2, m.y + m.height - h - 24));
    }

    _clamp(x, y) {
        const a = this._actor;
        const m = Main.layoutManager.primaryMonitor;
        const [, h] = a.get_preferred_height(a.width);
        const top = m.y + (Main.panel?.height ?? 32);
        return [Math.round(Math.max(m.x, Math.min(x, m.x + m.width - a.width))), Math.round(Math.max(top, Math.min(y, m.y + m.height - h)))];
    }

    // つかみバーのドラッグ
    _handleEvent(ev) {
        const t = ev.type();
        if (t !== Clutter.EventType.BUTTON_PRESS && t !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;
        const [sx, sy] = ev.get_coords();
        this._drag = {dx: sx - this._actor.x, dy: sy - this._actor.y, seq: ev.get_event_sequence?.() ?? null};
        this._dragGrab = global.stage.grab(this._actor);
        this._dragId = this._actor.connect('captured-event', (_a, e) => {
            const et = e.type();
            if (et === Clutter.EventType.MOTION || et === Clutter.EventType.TOUCH_UPDATE) {
                const [x, y] = e.get_coords();
                this._actor.set_position(...this._clamp(x - this._drag.dx, y - this._drag.dy));
                return Clutter.EVENT_STOP;
            }
            if (et === Clutter.EventType.BUTTON_RELEASE || et === Clutter.EventType.TOUCH_END || et === Clutter.EventType.TOUCH_CANCEL) {
                this._settings.set_string('osk-pos', JSON.stringify([Math.round(this._actor.x), Math.round(this._actor.y)]));
                this._endDrag();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return Clutter.EVENT_STOP;
    }

    _endDrag() {
        if (this._dragId && this._actor)
            this._actor.disconnect(this._dragId);
        this._dragId = 0;
        this._dragGrab?.dismiss();
        this._dragGrab = null;
        this._drag = null;
    }

    _destroyActors() {
        this._endDrag();
        this._stopRepeat();
        for (const a of [this._actor]) {
            if (a) {
                Main.layoutManager.removeChrome(a);
                a.destroy();
            }
        }
        this._actor = null;
        this._shiftKey = this._ctrlKey = this._sizeKey = null;
        this._shown = false;
    }
}
