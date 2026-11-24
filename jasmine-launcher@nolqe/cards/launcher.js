// Jasmine Launcher: cards/launcher.js
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {ResultView, searchItems} from '../launcher.js';
import {SEARCH_ENGINES, defaultBrowser, openUri, appInfo, vbox, hbox} from '../common.js';
import {_} from '../i18n.js';

export class LauncherCardPart {
    _buildSearch() {
        const card = vbox('jw-card jw-launch-card');
        const row = hbox('jw-row');
        const results = new ResultView(() => {
            entry.text = '';
            this._ungrab();
        });
        const entry = this._makeEntry(_('Search'));
        entry.y_align = Clutter.ActorAlign.CENTER;
        entry.set_primary_icon(new St.Icon({icon_name: 'system-search-symbolic', style_class: 'jw-entry-icon'}));
        entry.clutter_text.connect('key-focus-out', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this._grab && entry.get_stage()) {
                    entry.text = '';
                    results.set([]);
                    this._place();
                }
                return GLib.SOURCE_REMOVE;
            });
        });
        entry.clutter_text.connect('text-changed', () => {
            results.set(searchItems(entry.text, this._launcherActions()).slice(0, 5));
            this._place();
        });
        entry.clutter_text.connect('key-press-event', (_a, ev) => {
            const sym = ev.get_key_symbol();
            if (sym === Clutter.KEY_Escape) {
                entry.text = '';
                return Clutter.EVENT_PROPAGATE;
            }
            return results.handleKey(sym) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
        row.add_child(entry);
        card.add_child(row);
        card.add_child(results.actor);
        return card;
    }

    _launcherActions() {
        const browser = defaultBrowser();
        const qsId = this._settings?.get_string('quick-send-app')?.trim() ?? '';
        const qsApp = qsId ? appInfo(qsId) : null;
        return {
            web: q => openUri(this._searchUrl(q)),
            isUrl: q => /^[a-z]+:\/\/\S+$/i.test(q) || /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(q),
            claude: q => this._askClaude(q),
            quickSend: q => (q ? this._sendQuickApp(q) : this._openQuickApp()),
            webIcon: browser?.get_icon() ?? 'web-browser-symbolic',
            webName: browser?.get_display_name() ?? _('Browser'),
            quickSendIcon: qsApp?.get_icon() ?? 'mail-send-symbolic',
            quickSendName: qsApp?.get_display_name() ?? (qsId ? qsId.replace(/\.desktop$/, '') : ''),
        };
    }

    _styleLauncher(actor) {
        const st = this._settings;
        const light = this._isLight();
        actor.style_class = `jw-launcher ${light ? 'jw-light' : 'jw-dark'}`;
        const a = 0.98;
        const bg = light ? `rgba(250, 250, 252, ${a})` : `rgba(36, 36, 40, ${a})`;
        actor.style = `background-color: ${bg}; border-radius: ${st.get_int('corner-radius')}px; ` +
            `font-size: ${(11 * st.get_double('font-scale')).toFixed(1)}pt; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);`;
    }

    _searchUrl(q) {
        if (/^[a-z]+:\/\/\S+$/i.test(q))
            return q;
        if (/^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(q))
            return `https://${q}`;
        const st = this._settings;
        const engine = st.get_string('search-engine');
        let tpl = engine === 'custom' ? st.get_string('search-custom-url') : SEARCH_ENGINES[engine];
        if (!tpl || !tpl.includes('%s'))
            tpl = SEARCH_ENGINES.google;
        return tpl.replace('%s', encodeURIComponent(q));
    }
}
