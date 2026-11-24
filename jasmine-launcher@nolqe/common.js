// Jasmine Launcher — shared constants, helpers, MPRIS monitor, and Quick Settings toggle.
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import Secret from 'gi://Secret';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {_, _f} from './i18n.js';

export const APP_NAME = 'Jasmine Launcher';
export const PARSEC_APP = 'com.parsecgaming.parsec';
export const PARSEC_DESKTOP = 'com.parsecgaming.parsec.desktop';
export const PARSEC_API = 'https://kessel-api.parsec.app/v2/hosts?mode=desktop&public=false';
export const PARSEC_AUTH = 'https://kessel-api.parsec.app/v1/auth';
export const SEARCH_ENGINES = {
    google: 'https://www.google.com/search?q=%s',
    duckduckgo: 'https://duckduckgo.com/?q=%s',
    bing: 'https://www.bing.com/search?q=%s',
    brave: 'https://search.brave.com/search?q=%s',
};
export const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
export const MUSIC_NAME_RE = /youtube|pear|spotify|rhythmbox|amberol|gapless|lollypop|clementine|strawberry|vlc/i;
export const SECRET_SCHEMA = new Secret.Schema('org.nolqe.JasmineLauncher', Secret.SchemaFlags.NONE, {
    app: Secret.SchemaAttributeType.STRING,
    service: Secret.SchemaAttributeType.STRING,
});
export const SECRET_ATTRS = {app: 'jasmine-launcher', service: 'parsec'};
export const ELLIPSIZE_END = 3;
export const ART_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'jasmine-launcher', 'art']);
export const ART_KEEP = 12;
export const GNOME_ACCENTS = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800', orange: '#ed5b00',
    red: '#e62d42', pink: '#d56199', purple: '#9141ac', slate: '#6f8396',
};
export const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
export const CARD_NAMES = {
    search: 'Launcher',
    music: 'Music',
    system: 'System',
    memory: 'Clean RAM',
    webpanel: 'Web',
    parsec: 'Parsec',
    claude: 'Paseo',
};
export const PANEL_ID = 'org.nolqe.JasmineLauncherWebPanel';
export const PANEL_SCRIPT_PATTERN = "'jasmine-launcher@nolqe/webpanel.js'";
export const PASEO_AGENTS = GLib.build_filenamev([GLib.get_home_dir(), '.paseo', 'agents']);
export const SYSMON_DESKTOP = 'org.gnome.SystemMonitor.desktop';
export const TERMINAL_CANDIDATES = [
    ['org.gnome.Ptyxis.desktop', 'ptyxis', ['--new-window', '-d']],
    ['org.gnome.Console.desktop', 'kgx', ['--working-directory']],
    ['org.gnome.Terminal.desktop', 'gnome-terminal', ['--working-directory']],
];

export function defaultBrowser() {
    try {
        return Gio.AppInfo.get_default_for_uri_scheme('https');
    } catch {
        return null;
    }
}

export function openUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        logError(e, 'jasmine-launcher: openUri');
        Main.notify(APP_NAME, _f('Couldn’t open {0}', uri));
    }
}

export const CARD_CLICK = {
    system: () => launch(SYSMON_DESKTOP),
    memory: ext => ext?._memClean?.(),
    webpanel: ext => ext?._panelToggleOpen?.(),
    music: ext => {
        const id = ext?._settings?.get_string('music-app')?.trim() || '';
        const target = id || ext?._mprisDesktop?.() || '';
        if (!target)
            return;
        const app = Shell.AppSystem.get_default().lookup_app(target);
        if (app)
            app.activate();
        else if (id)
            Main.notify(APP_NAME, _f('{0} not found', id));
    },
};

// Paseo desktop launcher (RPM: Paseo.desktop, AppImage/Gear Lever: paseo.desktop)
export const PASEO_DESKTOP = 'Paseo.desktop';
export function paseoDesktop() {
    return appInfo('Paseo.desktop') ? 'Paseo.desktop' : 'paseo.desktop';
}

export function claudePath() {
    const local = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'claude']);
    return GLib.file_test(local, GLib.FileTest.IS_EXECUTABLE) ? local : (GLib.find_program_in_path('claude') ?? 'claude');
}

export let claudeDir = '';
export function runClaude(args = [], cwd = null) {
    cwd ||= claudeDir.replace(/^~(?=$|\/)/, GLib.get_home_dir()) || GLib.get_home_dir();
    if (!GLib.file_test(cwd, GLib.FileTest.IS_DIR))
        cwd = GLib.get_home_dir();
    const cmd = ['bash', '-lc', '"$@"; exec bash -l', 'jasmine', claudePath(), ...args];
    const bins = [
        ['ptyxis', '--new-window', '-d', cwd, '--', ...cmd],
        ['kgx', `--working-directory=${cwd}`, '--', ...cmd],
        ['gnome-terminal', `--working-directory=${cwd}`, '--', ...cmd],
    ];
    for (const argv of bins) {
        if (!GLib.find_program_in_path(argv[0]))
            continue;
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            return;
        } catch (e) {
            logError(e, 'jasmine-launcher: claude');
        }
    }
    Main.notify(APP_NAME, _('Couldn’t open a terminal'));
}

// ---- Paseo integration ----
export const PASEO_HOME = GLib.build_filenamev([GLib.get_home_dir(), '.paseo']);
export const PASEO_APPIMAGE = GLib.build_filenamev([GLib.get_home_dir(), 'AppImages', 'paseo.appimage']);
export const PASEO_RPM_CLI = '/opt/Paseo/resources/bin/paseo';
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function paseoCli() {
    if (GLib.file_test(PASEO_RPM_CLI, GLib.FileTest.IS_EXECUTABLE))
        return PASEO_RPM_CLI;
    const inPath = GLib.find_program_in_path('paseo');
    let en;
    try {
        en = Gio.File.new_for_path(GLib.get_tmp_dir()).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return inPath;
    }
    let found = null;
    let info;
    while ((info = en.next_file(null))) {
        if (!info.get_name().startsWith('.mount_paseo'))
            continue;
        const cli = GLib.build_filenamev([GLib.get_tmp_dir(), info.get_name(), 'resources', 'bin', 'paseo']);
        if (GLib.file_test(cli, GLib.FileTest.IS_EXECUTABLE)) {
            found = cli;
            break;
        }
    }
    en.close(null);
    return found ?? inPath;
}

export function paseoInstalled() {
    return (GLib.file_test(PASEO_RPM_CLI, GLib.FileTest.EXISTS) ||
        GLib.file_test(PASEO_APPIMAGE, GLib.FileTest.EXISTS) ||
        !!appInfo(paseoDesktop())) &&
        GLib.file_test(GLib.build_filenamev([PASEO_HOME, 'server-id']), GLib.FileTest.EXISTS);
}

export function withPaseoCli(cb) {
    const cli = paseoCli();
    if (cli) {
        cb(cli);
        return;
    }
    launch(paseoDesktop());
    let tries = 0;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        const c = paseoCli();
        if (!c && ++tries < 15)
            return GLib.SOURCE_CONTINUE;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, c ? 2500 : 0, () => {
            cb(c);
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
}

export function paseoExec(cli, args, cb) {
    let proc;
    try {
        proc = Gio.Subprocess.new([cli, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch (e) {
        logError(e, 'jasmine-launcher: paseo');
        cb(false, '');
        return;
    }
    proc.communicate_utf8_async(null, null, (p, res) => {
        let out = '';
        try {
            [, out] = p.communicate_utf8_finish(res);
        } catch {}
        cb(p.get_successful(), out ?? '');
    });
}

export function readText(path) {
    try {
        const [, bytes] = GLib.file_get_contents(path);
        return new TextDecoder().decode(bytes).trim();
    } catch {
        return '';
    }
}

export function openPaseoAgent(agentId) {
    const server = readText(GLib.build_filenamev([PASEO_HOME, 'server-id']));
    if (!server || !agentId)
        return false;
    try {
        Gio.AppInfo.launch_default_for_uri(`paseo://h/${encodeURIComponent(server)}/agent/${encodeURIComponent(agentId)}`,
            global.create_app_launch_context(0, -1));
        return true;
    } catch (e) {
        logError(e, 'jasmine-launcher: paseo open');
        return false;
    }
}

// Quick Settings toggle for Jasmine Launcher cards
export const WidgetsToggle = GObject.registerClass(
class WidgetsToggle extends QuickMenuToggle {
    _init(ext) {
        super._init({title: _('Jasmine'), iconName: 'view-grid-symbolic', toggleMode: true});
        const st = ext._settings;
        this._st = st;
        this._ids = [];
        st.bind('visible', this, 'checked', Gio.SettingsBindFlags.DEFAULT);
        this.menu.setHeader('view-grid-symbolic', APP_NAME, _('Cards'));
        for (const [k, name] of Object.entries(CARD_NAMES)) {
            const key = `show-${k}`;
            const item = new PopupMenu.PopupSwitchMenuItem(_(name), st.get_boolean(key));
            item.connect('toggled', (_i, on) => {
                if (st.get_boolean(key) !== on)
                    st.set_boolean(key, on);
                if (on && !st.get_boolean('visible'))
                    st.set_boolean('visible', true);
            });
            this._ids.push(st.connect(`changed::${key}`, () => item.setToggleState(st.get_boolean(key))));
            this.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Bring to front'), () => {
            Main.panel.closeQuickSettings?.();
            Main.panel.statusArea.quickSettings.menu.close();
            ext._startPeek();
        });
        this.menu.addAction(_('Settings'), () => ext.openPreferences());
        this.connect('destroy', () => this._ids.forEach(id => this._st.disconnect(id)));
    }
});

export const WidgetsIndicator = GObject.registerClass(
class WidgetsIndicator extends SystemIndicator {
    _init(ext) {
        super._init();
        this.quickSettingsItems.push(new WidgetsToggle(ext));
    }
});

export function appInfo(id) {
    if (!id)
        return null;
    try {
        return GioUnix.DesktopAppInfo.new(id);
    } catch {
        return null;
    }
}

export function launch(id, uris = []) {
    const app = appInfo(id);
    if (!app) {
        Main.notify(APP_NAME, _f('{0} not found', id));
        return;
    }
    try {
        app.launch_uris(uris, global.create_app_launch_context(0, -1));
    } catch (e) {
        logError(e, 'jasmine-launcher: launch');
    }
}

export function vbox(styleClass = '') {
    return new St.BoxLayout({style_class: styleClass, orientation: Clutter.Orientation.VERTICAL});
}

export function hbox(styleClass = '') {
    return new St.BoxLayout({style_class: styleClass, orientation: Clutter.Orientation.HORIZONTAL});
}

export function iconButton(iconName, cb, extra = '') {
    const b = new St.Button({
        style_class: `jw-icon-button ${extra}`,
        can_focus: true,
        child: new St.Icon({icon_name: iconName, icon_size: 18}),
    });
    b.connect('clicked', cb);
    return b;
}

export function textBlock(title, subtitle) {
    const box = vbox('jw-text');
    box.y_align = Clutter.ActorAlign.CENTER;
    box.x_expand = true;
    const t = new St.Label({style_class: 'jw-title', text: title});
    const s = new St.Label({style_class: 'jw-subtitle', text: subtitle});
    t.clutter_text.ellipsize = ELLIPSIZE_END;
    s.clutter_text.ellipsize = ELLIPSIZE_END;
    box.add_child(t);
    box.add_child(s);
    return {box, t, s};
}

export function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex ?? '');
    return m ? m.slice(1, 4).map(x => parseInt(x, 16)) : [53, 132, 228];
}

// ---- MPRIS (active media player) ----
export class Mpris {
    constructor(onChange) {
        this._onChange = onChange;
        this._players = new Map(); // name -> {proxy, root, id} | null
        this._bus = Gio.DBus.session;
        this._sub = this._bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [name, , newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (newOwner)
                    this._add(name);
                else
                    this._remove(name);
            });
        this._bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null, (c, res) => {
                try {
                    const [names] = c.call_finish(res).deepUnpack();
                    names.filter(n => n.startsWith(MPRIS_PREFIX)).forEach(n => this._add(n));
                } catch (e) {
                    logError(e, 'jasmine-launcher: ListNames');
                }
            });
    }

    _add(name) {
        if (this._players.has(name))
            return;
        this._players.set(name, null);
        Gio.DBusProxy.new(this._bus, Gio.DBusProxyFlags.NONE, null, name,
            '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', null, (_o, res) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(res);
                    if (!this._players.has(name))
                        return;
                    const id = proxy.connect('g-properties-changed', () => this._onChange());
                    const entry = {proxy, id, desktop: ''};
                    this._players.set(name, entry);
                    this._bus.call(name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
                        new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2', 'DesktopEntry']),
                        null, Gio.DBusCallFlags.NONE, 500, null, (c, r) => {
                            try {
                                const d = c.call_finish(r).deepUnpack()[0].deepUnpack();
                                if (d)
                                    entry.desktop = d.endsWith('.desktop') ? d : `${d}.desktop`;
                            } catch {}
                        });
                    this._onChange();
                } catch {
                    this._players.delete(name);
                }
            });
    }

    _remove(name) {
        const p = this._players.get(name);
        if (p)
            p.proxy.disconnect(p.id);
        this._players.delete(name);
        this._onChange();
    }

    _pick(anyPlayer) {
        const ready = [...this._players.entries()].filter(([, v]) => v);
        if (!ready.length)
            return null;
        if (anyPlayer) {
            const playing = ready.find(([, v]) =>
                v.proxy.get_cached_property('PlaybackStatus')?.unpack() === 'Playing');
            return (playing ?? ready[0])[1];
        }
        const music = ready.find(([n]) => MUSIC_NAME_RE.test(n));
        return music ? music[1] : null;
    }

    current(anyPlayer) {
        return this._pick(anyPlayer)?.proxy ?? null;
    }

    desktop(anyPlayer) {
        return this._pick(anyPlayer)?.desktop ?? '';
    }

    destroy() {
        this._bus.signal_unsubscribe(this._sub);
        for (const p of this._players.values()) {
            if (p)
                p.proxy.disconnect(p.id);
        }
        this._players.clear();
    }
}

export function setClaudeDir(v) {
    claudeDir = v;
}
