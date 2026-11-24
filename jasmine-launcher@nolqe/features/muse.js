// Jasmine Launcher: features/muse.js (window tracking + optional @ quick-send app)
import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {appInfo, launch} from '../common.js';
import {_} from '../i18n.js';

export class MusePart {
    _museWatch() {
        this._museWins = new Map();
        this._museCreatedId = global.display.connect('window-created', (_d, w) => this._museTrack(w));
        for (const a of global.get_window_actors())
            this._museTrack(a.meta_window);
    }

    _museUnwatch() {
        if (this._museCreatedId)
            global.display.disconnect(this._museCreatedId);
        this._museCreatedId = 0;
        for (const [w, ids] of this._museWins ?? [])
            ids.forEach(id => w.disconnect(id));
        this._museWins = null;
        if (this._musePasteId)
            GLib.source_remove(this._musePasteId);
        this._musePasteId = 0;
    }

    _museTrack(w) {
        if (!w || this._museWins.has(w))
            return;
        const ids = [
            w.connect('unmanaged', () => {
                ids.forEach(id => w.disconnect(id));
                this._museWins?.delete(w);
            }),
        ];
        this._museWins.set(w, ids);
        this._adoptPanelSoon(w);
    }

    _quickAppId() {
        return this._settings?.get_string('quick-send-app')?.trim() || '';
    }

    _quickAppWindow() {
        const id = this._quickAppId();
        if (!id)
            return null;
        const tracker = Shell.WindowTracker.get_default();
        const wins = [...(this._museWins?.keys() ?? [])].filter(w => tracker.get_window_app(w)?.get_id() === id);
        return wins.sort((a, b) => b.get_user_time() - a.get_user_time())[0] ?? null;
    }

    _openQuickApp() {
        const id = this._quickAppId();
        if (!id)
            return null;
        const w = this._quickAppWindow();
        if (w)
            Main.activateWindow(w);
        else
            launch(id);
        return w;
    }

    _sendQuickApp(text) {
        const id = this._quickAppId();
        if (!id)
            return;
        const name = appInfo(id)?.get_display_name() ?? id.replace(/\.desktop$/, '');
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        const w = this._openQuickApp();
        if (!w) {
            Main.notify(name, _('Starting — paste with Ctrl+V'));
            return;
        }
        if (this._musePasteId)
            GLib.source_remove(this._musePasteId);
        this._musePasteId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._musePasteId = 0;
            if (global.display.focus_window !== w) {
                Main.notify(name, _('Paste with Ctrl+V'));
                return GLib.SOURCE_REMOVE;
            }
            try {
                const seat = global.stage.context.get_backend().get_default_seat();
                const vk = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
                const t = GLib.get_monotonic_time();
                vk.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
                vk.notify_keyval(t + 10, Clutter.KEY_v, Clutter.KeyState.PRESSED);
                vk.notify_keyval(t + 20, Clutter.KEY_v, Clutter.KeyState.RELEASED);
                vk.notify_keyval(t + 30, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
            } catch {
                Main.notify(name, _('Paste with Ctrl+V'));
            }
            return GLib.SOURCE_REMOVE;
        });
    }
}
