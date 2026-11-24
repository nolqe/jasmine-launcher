// Jasmine Launcher: cards/memory.js
import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import System from 'system';
import {PANEL_ID, readText} from '../common.js';
import {_} from '../i18n.js';

// ---- メモリ整理（スマホの「メモリ解放」と同じ）: アイコン 1 つだけの小さな正方形のボタン。押すと
//   ① 裏のアプリ（ウィンドウを開いていないのに動き続けているもの）を閉じる。最小化しているものは「あとで使う」ことが
//      多いので閉じない。memory-keep のアプリ（Paseo・ターミナル・音楽・Parsec など）も閉じない
//   ② Web パネルのページを開き直して溜まったメモリを捨てる  ③ GNOME 本体のゴミ集め
//   3 秒後に増えた空きメモリを「○○MB 解放」と表示
// 結果はアイコンの場所に「−512M」とアクセント色で数秒だけ出して、アイコンに戻す
export const MEM_SIZE = 48; // アイコン 16px ＋ほかのカードと同じ余白 16px

export class MemoryPart {
    _buildMemory() {
        const card = new St.Widget({style_class: 'jw-card jw-mem', layout_manager: new Clutter.BinLayout(),
            width: MEM_SIZE, height: MEM_SIZE, accessible_name: _('Clean RAM')});
        const icon = new St.Icon({icon_name: 'edit-clear-all-symbolic', icon_size: 16,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        icon.set_pivot_point(0.5, 0.5);
        const text = new St.Label({style_class: 'jw-mem-text', visible: false,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        card.add_child(icon);
        card.add_child(text);
        this._mem = {icon, text};
        return card;
    }

    _memInfo() {
        const mi = Object.fromEntries(readText('/proc/meminfo').split('\n').map(l => l.split(/:\s+/)).filter(a => a.length === 2)
            .map(([k, v]) => [k, parseInt(v)]));
        return {total: mi.MemTotal ?? 0, avail: mi.MemAvailable ?? 0};
    }

    // 結果をアイコンの場所にアクセント色で 4 秒出して、アイコンに戻す
    _memShow(text) {
        const m = this._mem;
        if (!m)
            return;
        m.text.text = text;
        m.text.style = `color: ${this._accentHex()};`;
        m.icon.visible = false;
        m.text.visible = true;
        GLib.timeout_add(GLib.PRIORITY_LOW, 4000, () => {
            if (this._mem === m) {
                m.text.visible = false;
                m.icon.visible = true;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _memClean() {
        if (this._memBusy)
            return;
        this._memBusy = true;
        const before = this._memInfo().avail;
        // 整理中はアイコンがゆっくり回る
        const icon = this._mem?.icon;
        icon?.ease({rotation_angle_z: 720, duration: 2400, mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
            onStopped: () => icon && (icon.rotation_angle_z = 0)});
        const btn = this._sys?.cleanIcon;
        btn?.ease({rotation_angle_z: 360, duration: 600, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => btn && (btn.rotation_angle_z = 0)});
        // ① 裏のアプリを閉じる
        const keep = new Set(this._settings.get_strv('memory-keep'));
        keep.add(this._settings.get_string('music-app'));
        const focus = global.display.focus_window;
        const tracker = Shell.WindowTracker.get_default();
        const focusApp = focus && !focus.minimized ? tracker.get_window_app(focus) : null; // 最小化したものは使用中とみなさない
        const closed = []; // 閉じたアプリ（表示はしない。数字だけ見せる）
        for (const app of Shell.AppSystem.get_default().get_running()) {
            const id = app.get_id();
            if (keep.has(id) || app === focusApp || id === `${PANEL_ID}.desktop`)
                continue;
            const wins = app.get_windows().filter(w => !this._isPanel?.(w) && w.get_window_type() === Meta.WindowType.NORMAL);
            if (app.get_windows().some(w => this._isPanel?.(w)))
                continue;
            if (wins.length)
                continue; // ウィンドウがある（最小化を含む）ものは使っている扱い
            closed.push(app.get_name());
            try {
                app.request_quit();
            } catch {}
        }
        // ② Web パネルを開き直す ③ GNOME 本体のゴミ集め
        this._panelReloadAll?.();
        System.gc();

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            this._memBusy = false;
            const freed = (this._memInfo().avail - before) / 1024;
            // 例: −512M。空かなかったら「最適」
            this._memShow(freed >= 1 ? `−${freed >= 1024 ? `${(freed / 1024).toFixed(1)}G` : `${Math.round(freed)}M`}` : _('OK'));
            return GLib.SOURCE_REMOVE;
        });
    }
}
