// Jasmine Launcher preferences window (GTK4 / libadwaita).
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {_, _f, setLang} from './i18n.js';

const NAMES = {search: 'Launcher', music: 'Music', system: 'System', memory: 'Clean RAM', webpanel: 'Web', parsec: 'Parsec', claude: 'Paseo'};

function comboRow(settings, key, title, items, subtitle = '') {
    const ids = items.map(i => i[0]);
    const row = new Adw.ComboRow({title, subtitle, model: Gtk.StringList.new(items.map(i => i[1]))});
    const sync = () => {
        const i = ids.indexOf(settings.get_string(key));
        row.selected = i < 0 ? 0 : i;
    };
    sync();
    row.connect('notify::selected', () => {
        if (settings.get_string(key) !== ids[row.selected])
            settings.set_string(key, ids[row.selected]);
    });
    settings.connect(`changed::${key}`, sync);
    return row;
}

function spinRow(settings, key, title, lower, upper, step, {digits = 0, subtitle = ''} = {}) {
    const isDouble = digits > 0;
    const row = new Adw.SpinRow({
        title, subtitle, digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
    });
    row.value = isDouble ? settings.get_double(key) : settings.get_int(key);
    row.connect('notify::value', () => {
        if (isDouble)
            settings.set_double(key, row.value);
        else
            settings.set_int(key, Math.round(row.value));
    });
    return row;
}

// 色を選ぶ行（空文字 = テーマの色。リセットボタンで空に戻す）
function colorRow(settings, key, title, subtitle = '') {
    const row = new Adw.ActionRow({title, subtitle});
    const btn = new Gtk.ColorDialogButton({valign: Gtk.Align.CENTER, dialog: new Gtk.ColorDialog({with_alpha: false})});
    const reset = new Gtk.Button({icon_name: 'edit-undo-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Use theme color'), css_classes: ['flat']});
    let syncing = false;
    const sync = () => {
        const v = settings.get_string(key);
        const c = new Gdk.RGBA();
        syncing = true;
        btn.rgba = c.parse(v || '#808080') ? c : btn.rgba;
        syncing = false;
        reset.sensitive = !!v;
        row.subtitle = v || _('Theme color');
    };
    btn.connect('notify::rgba', () => {
        if (syncing)
            return;
        const c = btn.rgba;
        settings.set_string(key, '#' + [c.red, c.green, c.blue].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''));
    });
    reset.connect('clicked', () => settings.set_string(key, ''));
    settings.connect(`changed::${key}`, sync);
    sync();
    row.add_suffix(btn);
    row.add_suffix(reset);
    return row;
}

// ショートカットの行: 「変更」を押してキーを押すとそのまま登録（Esc で取り消し、Backspace で解除）
const MODIFIER_KEYS = new Set(['Shift_L', 'Shift_R', 'Control_L', 'Control_R', 'Alt_L', 'Alt_R', 'Super_L', 'Super_R',
    'Meta_L', 'Meta_R', 'Hyper_L', 'Hyper_R', 'ISO_Level3_Shift', 'Caps_Lock']);
function shortcutRow(settings, key, title) {
    const row = new Adw.ActionRow({title});
    const label = new Gtk.ShortcutLabel({accelerator: settings.get_strv(key)[0] ?? '', disabled_text: _('Not set'), valign: Gtk.Align.CENTER});
    const btn = new Gtk.Button({label: _('Change'), valign: Gtk.Align.CENTER});
    settings.connect(`changed::${key}`, () => (label.accelerator = settings.get_strv(key)[0] ?? ''));
    btn.connect('clicked', () => {
        const dlg = new Adw.AlertDialog({heading: title, body: _('Press the new key combination\nEsc to cancel, Backspace to clear')});
        dlg.add_response('cancel', _('Cancel'));
        const ctl = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        ctl.connect('key-pressed', (_c, keyval, keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;
            const name = Gdk.keyval_name(keyval) ?? '';
            if (!mask && keyval === Gdk.KEY_Escape) {
                dlg.close();
                return true;
            }
            if (!mask && keyval === Gdk.KEY_BackSpace) {
                settings.set_strv(key, []);
                dlg.close();
                return true;
            }
            if (MODIFIER_KEYS.has(name) || !mask)
                return true; // 修飾キー（Super・Ctrl・Alt など）と一緒に押したときだけ登録
            settings.set_strv(key, [Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask)]);
            dlg.close();
            return true;
        });
        dlg.add_controller(ctl);
        dlg.present(row.get_root());
    });
    row.add_suffix(label);
    row.add_suffix(btn);
    return row;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export default class JasmineLauncherPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const st = this.getSettings();
        setLang(st.get_string('language'));
        window.set_default_size(560, 720);

        // ---------- 配置 ----------
        const pageLayout = new Adw.PreferencesPage({title: _('Layout'), icon_name: 'view-grid-symbolic'});
        const gPos = new Adw.PreferencesGroup({title: _('Position & size')});
        gPos.add(comboRow(st, 'position', _('Default'), [
            ['top-right', _('Top right')], ['top-left', _('Top left')], ['bottom-right', _('Bottom right')], ['bottom-left', _('Bottom left')],
        ], _('Cards set to “Default” stack from this corner')));
        gPos.add(switchRow(st, 'allow-drag', _('Drag to move'),
            _('Drop near a screen edge to snap into that corner; anywhere else stays free')));
        const reset = new Adw.ActionRow({title: _('Reset card positions'), subtitle: _('Move every card back to Default')});
        const resetBtn = new Gtk.Button({label: _('Reset'), valign: Gtk.Align.CENTER});
        resetBtn.connect('clicked', () => st.set_string('card-positions', '{}'));
        reset.add_suffix(resetBtn);
        gPos.add(reset);
        gPos.add(spinRow(st, 'width', _('Width'), 240, 640, 10, {subtitle: 'px'}));
        gPos.add(spinRow(st, 'margin', _('Screen margin'), 0, 200, 4, {subtitle: 'px'}));
        gPos.add(spinRow(st, 'spacing', _('Card spacing'), 0, 64, 2, {subtitle: 'px'}));
        pageLayout.add(gPos);

        const gOrder = new Adw.PreferencesGroup({title: _('Cards'), description: _('Reorder with the arrows; toggle visibility (also in Quick Settings → Jasmine)')});
        gPos.add(switchRow(st, 'visible', _('Show cards'), _('Hide everything when off')));
        // カードごとの場所（card-positions の値: 角の名前 / [x, y]＝自由 / 無し＝基本位置）
        const PLACES = [['', _('Default')], ['top-right', _('Top right')], ['top-left', _('Top left')], ['bottom-right', _('Bottom right')], ['bottom-left', _('Bottom left')], ['free', _('Free')]];
        const readPos = () => {
            try {
                return JSON.parse(st.get_string('card-positions')) ?? {};
            } catch {
                return {};
            }
        };
        const placeDropDown = key => {
            const dd = Gtk.DropDown.new_from_strings(PLACES.map(p => p[1]));
            dd.valign = Gtk.Align.CENTER;
            const sync = () => {
                const v = readPos()[key];
                const id = Array.isArray(v) ? 'free' : (v ?? '');
                const i = PLACES.findIndex(p => p[0] === id);
                dd.selected = i < 0 ? 0 : i;
                dd.sensitive = true;
            };
            sync();
            dd.connect('notify::selected', () => {
                const id = PLACES[dd.selected][0];
                const p = readPos();
                const cur = Array.isArray(p[key]) ? 'free' : (p[key] ?? '');
                if (id === cur)
                    return;
                if (id === 'free') {
                    // 自由の位置はドラッグで決める。まだ無ければ元に戻す
                    dd.set_tooltip_text(_('Drag the card to set its free position'));
                    sync();
                    return;
                }
                if (id)
                    p[key] = id;
                else
                    delete p[key];
                st.set_string('card-positions', JSON.stringify(p));
            });
            st.connect('changed::card-positions', sync);
            return dd;
        };
        const rows = [];
        const rebuildOrder = () => {
            for (const r of rows)
                gOrder.remove(r);
            rows.length = 0;
            let order = st.get_strv('order').filter(k => NAMES[k]);
            for (const k of Object.keys(NAMES)) {
                if (!order.includes(k))
                    order.push(k);
            }
            order.forEach((k, i) => {
                const row = new Adw.SwitchRow({title: _(NAMES[k])});
                st.bind(`show-${k}`, row, 'active', Gio.SettingsBindFlags.DEFAULT);
                row.add_suffix(placeDropDown(k));
                const up = new Gtk.Button({icon_name: 'go-up-symbolic', valign: Gtk.Align.CENTER, sensitive: i > 0, css_classes: ['flat']});
                const down = new Gtk.Button({icon_name: 'go-down-symbolic', valign: Gtk.Align.CENTER, sensitive: i < order.length - 1, css_classes: ['flat']});
                const move = d => {
                    const o = [...order];
                    [o[i], o[i + d]] = [o[i + d], o[i]];
                    st.set_strv('order', o);
                };
                up.connect('clicked', () => move(-1));
                down.connect('clicked', () => move(1));
                row.add_prefix(down);
                row.add_prefix(up);
                gOrder.add(row);
                rows.push(row);
            });
        };
        rebuildOrder();
        st.connect('changed::order', rebuildOrder);
        pageLayout.add(gOrder);
        window.add(pageLayout);

        // ---------- 見た目 ----------
        const pageLook = new Adw.PreferencesPage({title: _('Appearance'), icon_name: 'applications-graphics-symbolic'});
        const gLook = new Adw.PreferencesGroup({title: _('Card')});
        // プリセット: まとめて切り替え（あとから細かく変えられる）
        const presets = {
            'Dark': {theme: 'dark', opacity: 0.85, 'card-bg': '', 'card-fg': '', 'accent-system': false},
            'Light': {theme: 'light', opacity: 0.85, 'card-bg': '', 'card-fg': '', 'accent-system': false},
            'Frosted': {theme: 'dark', opacity: 0.45, 'card-bg': '', 'card-fg': '', 'accent-system': false},
            'Mono': {theme: 'dark', opacity: 0.9, 'card-bg': '#111111', 'card-fg': '#e6e6e6', 'accent-system': false, accent: '#8a8a8a'},
            'GNOME': {theme: 'system', opacity: 0.85, 'card-bg': '', 'card-fg': '', 'accent-system': true},
        };
        const presetRow = new Adw.ActionRow({title: _('Presets'), subtitle: _('Apply a set of colors (fine-tune below)')});
        const presetBox = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});
        for (const [label, conf] of Object.entries(presets).map(([l, c]) => [_(l), c])) {
            const b = new Gtk.Button({label, css_classes: ['pill']});
            b.connect('clicked', () => {
                for (const [k, v] of Object.entries(conf)) {
                    if (typeof v === 'boolean')
                        st.set_boolean(k, v);
                    else if (typeof v === 'number')
                        st.set_double(k, v);
                    else
                        st.set_string(k, v);
                }
            });
            presetBox.append(b);
        }
        const gPreset = new Adw.PreferencesGroup({title: _('Color')});
        const presetScroll = new Gtk.ScrolledWindow({child: presetBox, vscrollbar_policy: Gtk.PolicyType.NEVER, hexpand: true});
        presetRow.add_suffix(presetScroll);
        gPreset.add(presetRow);
        gPreset.add(comboRow(st, 'theme', _('Theme'), [['dark', _('Dark')], ['light', _('Light')], ['system', _('Follow GNOME')]]));
        gPreset.add(colorRow(st, 'card-bg', _('Background'), ''));
        gPreset.add(colorRow(st, 'card-fg', _('Text'), ''));
        gPreset.add(switchRow(st, 'accent-system', _('Follow GNOME accent'), _('Use the accent color from GNOME Settings')));
        pageLook.add(gPreset);
        gLook.add(spinRow(st, 'opacity', _('Opacity'), 0.0, 1.0, 0.05, {digits: 2, subtitle: _('0 = transparent, 1 = solid')}));
        gLook.add(comboRow(st, 'language', _('Language'), [['auto', _('Automatic')], ['en', 'English'], ['ja', '日本語']], _('Reopen settings to apply here')));
        gLook.add(spinRow(st, 'corner-radius', _('Corner radius'), 0, 48, 2, {subtitle: 'px'}));
        gLook.add(spinRow(st, 'font-scale', _('Text size'), 0.7, 1.6, 0.05, {digits: 2, subtitle: _('×')}));
        gLook.add(switchRow(st, 'shadow', _('Shadow')));

        const accentRow = new Adw.ActionRow({title: _('Accent')});
        const colorBtn = new Gtk.ColorDialogButton({valign: Gtk.Align.CENTER, dialog: new Gtk.ColorDialog({with_alpha: false})});
        const rgba = new Gdk.RGBA();
        rgba.parse(st.get_string('accent'));
        colorBtn.rgba = rgba;
        colorBtn.connect('notify::rgba', () => {
            const c = colorBtn.rgba;
            const hex = '#' + [c.red, c.green, c.blue].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
            st.set_string('accent', hex);
        });
        accentRow.add_suffix(colorBtn);
        st.bind('accent-system', accentRow, 'sensitive', Gio.SettingsBindFlags.INVERT_BOOLEAN);
        st.connect('changed::accent', () => {
            const c = new Gdk.RGBA();
            if (c.parse(st.get_string('accent')) && !c.equal(colorBtn.rgba))
                colorBtn.rgba = c;
        });
        gPreset.add(accentRow);
        pageLook.add(gLook);
        window.add(pageLook);

        // ---------- 中身 ----------
        const pageContent = new Adw.PreferencesPage({title: _('Content'), icon_name: 'preferences-other-symbolic'});

        const gSearch = new Adw.PreferencesGroup({title: _('Launcher'),
            description: _('? web search · > AI (Paseo / Claude Code) · @ quick-send · math')});
        gSearch.add(shortcutRow(st, 'launcher-shortcut', _('Shortcut')));
        gSearch.add(spinRow(st, 'launcher-width', _('Popup width'), 400, 1000, 20, {subtitle: 'px'}));
        gSearch.add(spinRow(st, 'launcher-top', _('Popup position'), 0, 80, 2, {subtitle: _('% from top')}));
        const gPanel = new Adw.PreferencesGroup({title: _('Web'), description: _('Small browser panes. Add sites with +, right-click a site to remove')});
        gPanel.add(spinRow(st, 'webpanel-count', _('Panes'), 1, 3, 1, {subtitle: _('Side by side (also the pane button on the panel)')}));
        gPanel.add(spinRow(st, 'webpanel-width', _('Width'), 320, 900, 10, {subtitle: 'px'}));
        gPanel.add(spinRow(st, 'webpanel-height', _('Height'), 240, 1000, 10, {subtitle: 'px'}));
        pageContent.add(gPanel);
        gSearch.add(comboRow(st, 'search-engine', _('Search engine'), [
            ['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['bing', 'Bing'], ['brave', 'Brave Search'], ['custom', _('Custom')],
        ]));
        const customUrl = new Adw.EntryRow({title: _('Custom search URL (%s = query)'), show_apply_button: true});
        customUrl.text = st.get_string('search-custom-url');
        customUrl.connect('apply', () => st.set_string('search-custom-url', customUrl.text.trim()));
        gSearch.add(customUrl);
        const quickSend = new Adw.EntryRow({title: _('Quick-send app (@ prefix, .desktop ID)'), show_apply_button: true, use_markup: false});
        quickSend.text = st.get_string('quick-send-app');
        quickSend.connect('apply', () => st.set_string('quick-send-app', quickSend.text.trim()));
        gSearch.add(quickSend);
        pageContent.add(gSearch);

        const gParsec = new Adw.PreferencesGroup({title: 'Parsec'});
        const hidden = new Adw.EntryRow({title: _('Hidden PCs (comma-separated)'), show_apply_button: true});
        hidden.text = st.get_strv('parsec-hidden').join(', ');
        hidden.connect('apply', () => st.set_strv('parsec-hidden',
            hidden.text.split(',').map(s => s.trim()).filter(Boolean)));
        gParsec.add(hidden);
        gParsec.add(spinRow(st, 'parsec-max-rows', _('Rows before scrolling'), 1, 20, 1));
        const logout = new Adw.ActionRow({title: _('Sign out of Parsec'), subtitle: _('Remove the saved session from the keyring')});
        const logoutBtn = new Gtk.Button({label: _('Remove'), valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        logoutBtn.connect('clicked', () => {
            try {
                Gio.Subprocess.new(['secret-tool', 'clear', 'app', 'jasmine-launcher', 'service', 'parsec'], Gio.SubprocessFlags.NONE);
                logout.subtitle = _('Removed (press ⟳ on the card)');
            } catch (e) {
                logout.subtitle = _f('Couldn’t remove: {0}', e.message);
            }
        });
        logout.add_suffix(logoutBtn);
        gParsec.add(logout);
        pageContent.add(gParsec);

        const gMusic = new Adw.PreferencesGroup({title: _('Music')});
        gMusic.add(switchRow(st, 'music-any-player', _('Show all MPRIS players'), _('When off, only dedicated music players are shown')));
        gMusic.add(spinRow(st, 'music-art-size', _('Artwork size'), 32, 160, 4, {subtitle: 'px'}));
        const musicApp = new Adw.EntryRow({title: _('App to open on click (.desktop ID, empty = auto)'), show_apply_button: true, use_markup: false});
        musicApp.text = st.get_string('music-app');
        musicApp.connect('apply', () => st.set_string('music-app', musicApp.text.trim()));
        gMusic.add(musicApp);
        pageContent.add(gMusic);
        const gClaude = new Adw.PreferencesGroup({title: 'Paseo / Claude Code'});
        gClaude.add(spinRow(st, 'paseo-max', _('Sessions shown'), 1, 12, 1));
        const claudeDirRow = new Adw.EntryRow({title: _('Working directory (for > AI)'), show_apply_button: true, use_markup: false});
        claudeDirRow.text = st.get_string('claude-dir');
        claudeDirRow.connect('apply', () => st.set_string('claude-dir', claudeDirRow.text.trim()));
        gClaude.add(claudeDirRow);
        pageContent.add(gClaude);

        const gMem = new Adw.PreferencesGroup({title: _('Clean RAM'), description: _('The button quits background apps with no windows and reloads the web panes. Minimized apps are kept')});
        const keepRow = new Adw.EntryRow({title: _('Apps to keep (.desktop IDs, comma-separated)'), show_apply_button: true, use_markup: false});
        keepRow.text = st.get_strv('memory-keep').join(', ');
        keepRow.connect('apply', () => st.set_strv('memory-keep', keepRow.text.split(',').map(x => x.trim()).filter(Boolean)));
        gMem.add(keepRow);
        pageContent.add(gMem);

        const gSys = new Adw.PreferencesGroup({title: _('System')});
        gSys.add(spinRow(st, 'system-interval', _('Update interval'), 1, 10, 1, {subtitle: _('Seconds')}));
        pageContent.add(gSys);

        const gOsk = new Adw.PreferencesGroup({title: _('Keyboard')});
        gOsk.add(switchRow(st, 'osk-enabled', _('Floating keyboard in tablet mode'), _('Replaces the GNOME on-screen keyboard. Drag the top bar to move it')));
        pageContent.add(gOsk);
        const gOp = new Adw.PreferencesGroup({title: _('Controls')});
        gOp.add(switchRow(st, 'swipe-minimize', _('Three-finger swipe down to minimize'), _('Touchpad, outside the overview')));
        gOp.add(switchRow(st, 'show-tablet-button', _('Tablet mode button in the top bar'), _('Auto-rotate + on-screen keyboard')));
        gOp.add(shortcutRow(st, 'peek-shortcut', _('Bring-to-front shortcut')));
        gOp.add(shortcutRow(st, 'tablet-shortcut', _('Tablet mode shortcut')));
        pageContent.add(gOp);
        window.add(pageContent);
    }
}
