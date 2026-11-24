// Jasmine Launcher Web Panel: frameless rounded WebKitGTK 6.0 panes anchored over the Web card.
// Config: ~/.config/jasmine-launcher/webpanel.json
// Cookies/data: ~/.local/share/jasmine-launcher/webpanel/
// Favicons: ~/.cache/jasmine-launcher/webpanel/favicons/
// Launch: gjs -m webpanel.js [--instances 1,2] [--theme dark|light] [--radius 24] [--schemas <dir>]
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import WebKit from 'gi://WebKit?version=6.0';
import System from 'system';
import {_, _f, setLang} from './i18n.js';

const APP_ID = 'org.nolqe.JasmineLauncherWebPanel';
const CONF_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'jasmine-launcher']);
const CONF = GLib.build_filenamev([CONF_DIR, 'webpanel.json']);
const DATA = GLib.build_filenamev([GLib.get_user_data_dir(), 'jasmine-launcher', 'webpanel']);
const CACHE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'jasmine-launcher', 'webpanel']);
const FAVICONS = GLib.build_filenamev([CACHE, 'favicons']);
const DEFAULT_SITES = [
    {name: 'DuckDuckGo', url: 'https://duckduckgo.com/'},
    {name: 'Wikipedia', url: 'https://en.wikipedia.org/'},
];
// 大きさのプリセット（押すたびに S → M → L → XL → S… と回る。ホイールでも回せる）
const PRESETS = [['S', 360, 480], ['M', 420, 600], ['L', 520, 740], ['XL', 680, 880]];
const REVEAL_ZONE = 72; // 上からこの高さにマウスが来たらバーを出す

const MEMORY_LIMIT_MB = 400; // ページの処理プロセスの目安上限

function arg(name, def) {
    const i = ARGV.indexOf(name);
    return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : def;
}

// パネルごとの設定ファイル（1 枚目は従来どおり webpanel.json、2 枚目以降は webpanel-N.json）
const confPath = n => (n === 1 ? CONF : CONF.replace(/\.json$/, `-${n}.json`));
const sizeKey = (_n, k) => `webpanel-${k}`; // 大きさは全ペイン共通
const PANEL_MAX = 3;
setLang(arg('--lang', 'en'));
const INSTANCES = arg('--instances', '1').split(',').map(Number).filter(n => n >= 1);

function readJson(path) {
    try {
        const [, b] = GLib.file_get_contents(path);
        return JSON.parse(new TextDecoder().decode(b));
    } catch {
        return null;
    }
}

// サイトの一覧は全ページで共通（webpanel.json の sites）。表示中のサイトだけページごと
// （1 枚目は webpanel.json の current、2 枚目以降は webpanel-N.json の current）。
// v45 より前のページごとの一覧は、共通の一覧に無いサイトだけ足して引き継ぐ
const SHARED = (() => {
    const c = readJson(CONF);
    const sites = Array.isArray(c?.sites) && c.sites.length ? c.sites : [...DEFAULT_SITES];
    for (const n of [2, 3]) {
        for (const site of readJson(confPath(n))?.sites ?? []) {
            if (site?.url && !sites.some(x => x.url === site.url))
                sites.push(site);
        }
    }
    return {sites};
})();

function loadConf(n = 1) {
    const c = readJson(confPath(n));
    let current = Number(c?.current ?? 0);
    // 古いページごとの一覧での番号を、共通の一覧の番号に読み替える
    const old = Array.isArray(c?.sites) ? c.sites[current] : null;
    if (n > 1 && old?.url)
        current = Math.max(0, SHARED.sites.findIndex(x => x.url === old.url));
    return {get sites() {
        return SHARED.sites;
    }, current};
}

function saveConf(conf, n = 1) {
    GLib.mkdir_with_parents(CONF_DIR, 0o700);
    if (n === 1)
        GLib.file_set_contents(CONF, JSON.stringify({sites: SHARED.sites, current: conf.current}, null, 2));
    else
        GLib.file_set_contents(confPath(n), JSON.stringify({current: conf.current}, null, 2));
}

function saveSites() {
    const c = readJson(CONF);
    GLib.mkdir_with_parents(CONF_DIR, 0o700);
    GLib.file_set_contents(CONF, JSON.stringify({sites: SHARED.sites, current: c?.current ?? 0}, null, 2));
}

// サイトを足した・消したときに全ページのアイコンを作り直す（ページごとに登録する）
const PANES = [];

function hostOf(url) {
    try {
        return GLib.Uri.parse(url, GLib.UriFlags.NONE).get_host().replace(/^www\./, '');
    } catch {
        return url;
    }
}

function faviconPath(url) {
    return GLib.build_filenamev([FAVICONS, `${hostOf(url).replace(/[^a-z0-9.-]/gi, '_')}.png`]);
}

const CSS = `
window.jwp { background: none; }
.jwp-dark { background-color: #1d1d21; color: #ffffff; }
.jwp-light { background-color: #fafafc; color: #1e1e22; }
.jwp-dock { border-radius: 999px; padding: 4px; margin-top: 8px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35); }
.jwp-dark .jwp-dock { background-color: rgba(40, 40, 46, 0.92); }
.jwp-light .jwp-dock { background-color: rgba(255, 255, 255, 0.94); }
.jwp-site { border-radius: 999px; padding: 4px; min-width: 28px; min-height: 28px; background: none; box-shadow: none; }
.jwp-dark .jwp-site:hover { background-color: rgba(255, 255, 255, 0.08); }
.jwp-light .jwp-site:hover { background-color: rgba(0, 0, 0, 0.06); }
.jwp-dark .jwp-site.active { background-color: rgba(255, 255, 255, 0.16); }
.jwp-light .jwp-site.active { background-color: rgba(0, 0, 0, 0.10); }
.jwp-letter { border-radius: 999px; min-width: 20px; min-height: 20px; font-size: 0.72em; font-weight: 800; }
.jwp-dark .jwp-letter { background-color: rgba(255, 255, 255, 0.18); color: #ffffff; }
.jwp-light .jwp-letter { background-color: rgba(0, 0, 0, 0.12); color: #1e1e22; }
.jwp-sep { min-width: 1px; margin: 6px 4px; }
.jwp-dark .jwp-sep { background-color: rgba(255, 255, 255, 0.15); }
.jwp-light .jwp-sep { background-color: rgba(0, 0, 0, 0.12); }
.jwp-icon { min-width: 28px; min-height: 28px; padding: 0; border-radius: 999px; background: none; box-shadow: none; }
.jwp-size { border-radius: 999px; min-height: 28px; min-width: 28px; padding: 0 6px; font-size: 0.72em; font-weight: 800; background: none; box-shadow: none; }
`;

const app = new Adw.Application({application_id: APP_ID, flags: Gio.ApplicationFlags.DEFAULT_FLAGS});

app.connect('activate', () => {
    if (app.active_window) {
        app.active_window.present();
        return;
    }
    const light = arg('--theme', 'dark') === 'light';
    Adw.StyleManager.get_default().color_scheme = light ? Adw.ColorScheme.FORCE_LIGHT : Adw.ColorScheme.FORCE_DARK;

    // 上はカードのつかみバーに続くので小さく、下はカードの角の丸みに揃える
    const radius = parseInt(arg('--radius', '24'));
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS + `.jwp-root { border-radius: 8px 8px ${radius}px ${radius}px; }`);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    GLib.mkdir_with_parents(DATA, 0o700);
    GLib.mkdir_with_parents(FAVICONS, 0o700);
    const session = WebKit.NetworkSession.new(DATA, CACHE);
    session.get_cookie_manager().set_persistent_storage(GLib.build_filenamev([DATA, 'cookies.sqlite']),
        WebKit.CookiePersistentStorage.SQLITE);
    try {
        session.get_website_data_manager().set_favicons_enabled(true);
    } catch (e) {
        logError(e, 'webpanel: favicons');
    }
    // 省メモリ: ページの処理プロセスにメモリの上限を設ける。上限に近づくと WebKit がキャッシュの破棄・ゴミ集めを強める
    // （conservative = 上限の 50% から控えめに、strict = 70% から強く。kill は使わない＝落とさない）
    const ctx = (() => {
        try {
            const mp = new WebKit.MemoryPressureSettings();
            mp.set_memory_limit(MEMORY_LIMIT_MB);
            // 先に strict を決めてから conservative（conservative は strict より小さくないと受け付けない）
            mp.set_strict_threshold(0.7);
            mp.set_conservative_threshold(0.5);
            mp.set_poll_interval(10);
            return new WebKit.WebContext({memory_pressure_settings: mp});
        } catch (e) {
            logError(e, 'webpanel: memory pressure');
            return WebKit.WebContext.get_default();
        }
    })();
    // 戻る・進むのページ保持やメモリ上のキャッシュも最小に
    try {
        ctx.set_cache_model(WebKit.CacheModel.DOCUMENT_VIEWER);
    } catch (e) {
        logError(e, 'webpanel: cache model');
    }

    // 拡張の設定（大きさ）
    let settings = null;
    try {
        const dir = arg('--schemas', '');
        if (dir) {
            const src = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
            const schema = src.lookup('org.gnome.shell.extensions.jasmine-launcher', false);
            if (schema)
                settings = new Gio.Settings({settings_schema: schema});
        }
    } catch (e) {
        logError(e, 'webpanel: settings');
    }

    // パネルごとにウィンドウを作る（題名の末尾の番号で拡張がどのカードに重ねるか決める）
    const buildPanel = n => {
        const conf = loadConf(n);
        const win = new Gtk.ApplicationWindow({
            application: app,
            title: `Jasmine Web Panel ${n}`,
            decorated: false,
            default_width: settings?.get_int(sizeKey(n, 'width')) ?? 420,
            default_height: settings?.get_int(sizeKey(n, 'height')) ?? 560,
            css_classes: ['jwp'],
        });
        const stack = new Gtk.Stack({vexpand: true, hexpand: true, transition_type: Gtk.StackTransitionType.CROSSFADE});
        const root = new Gtk.Overlay({child: stack, css_classes: ['jwp-root', light ? 'jwp-light' : 'jwp-dark']});
        root.set_overflow(Gtk.Overflow.HIDDEN);
        const views = new Map(); // サイトの番号 -> WebView（メモリ節約のため、表示中のサイトだけ持つ）

        const openExternal = uri => {
            if (!uri)
                return;
            try {
                Gio.AppInfo.launch_default_for_uri(uri, null);
            } catch (e) {
                logError(e, 'webpanel: openExternal');
            }
        };

        // ---- カプセル形のバー（普段は隠す） ----
        const dock = new Gtk.Box({spacing: 2, css_classes: ['jwp-dock']});
        const sites = new Gtk.Box({spacing: 2});
        const revealer = new Gtk.Revealer({
            child: dock,
            transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN,
            transition_duration: 160,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.START,
            reveal_child: true,
        });
        root.add_overlay(revealer);

        let hideId = 0;
        let popoverOpen = false;
        const show = () => {
            if (hideId) {
                GLib.source_remove(hideId);
                hideId = 0;
            }
            revealer.reveal_child = true;
        };
        const hideSoon = (ms = 700) => {
            if (hideId || popoverOpen)
                return;
            hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                hideId = 0;
                if (!popoverOpen)
                    revealer.reveal_child = false;
                return GLib.SOURCE_REMOVE;
            });
        };
        // マウスが上のほうに来たら出す。離れたら少し待って隠す
        // 指（タッチ）で上のほうに触れたときも出す。指にはマウスのような「近づける」が無いので、触ってから
        // TOUCH_KEEP ミリ秒は出したままにして、バーのボタンを押せるようにする（ページへのタッチは横取りしない）
        const TOUCH_KEEP = 5000;
        let touchUntil = 0;
        const touching = () => GLib.get_monotonic_time() / 1000 < touchUntil;
        const motion = new Gtk.EventControllerMotion();
        motion.connect('motion', (_c, _x, y) => {
            if (touching())
                return;
            if (y < REVEAL_ZONE)
                show();
            else
                hideSoon();
        });
        motion.connect('leave', () => !touching() && hideSoon(300));
        const touch = new Gtk.GestureClick({touch_only: true});
        touch.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        const TOUCH_ZONE = 40; // 指で触ってバーを出す範囲（上から）
        touch.connect('pressed', (g, _n, _x, y) => {
            if (y >= TOUCH_ZONE && !(revealer.reveal_child && y < REVEAL_ZONE)) {
                // ページのほうを触ったら、出ていたバーはしまう
                touchUntil = 0;
                if (revealer.reveal_child)
                    hideSoon(300);
                return;
            }
            // 隠れているバーを出すタッチはページに渡さない（下にあるページのボタンが押されてしまうため）
            if (!revealer.reveal_child)
                g.set_state(Gtk.EventSequenceState.CLAIMED);
            touchUntil = GLib.get_monotonic_time() / 1000 + TOUCH_KEEP;
            show();
            hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOUCH_KEEP, () => {
                hideId = 0;
                if (!popoverOpen && !touching())
                    revealer.reveal_child = false;
                else if (!popoverOpen)
                    hideSoon(TOUCH_KEEP);
                return GLib.SOURCE_REMOVE;
            });
        });
        root.add_controller(touch);
        motion.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        root.add_controller(motion);
        hideSoon(1800); // 起動直後は少し見せてから隠す

        const siteIcon = site => {
            const path = faviconPath(site.url);
            if (GLib.file_test(path, GLib.FileTest.EXISTS))
                return new Gtk.Image({file: path, pixel_size: 20});
            const l = new Gtk.Label({label: (site.name || hostOf(site.url)).slice(0, 1).toUpperCase(), css_classes: ['jwp-letter']});
            return l;
        };

        let buttons = [];
        const viewFor = i => {
            if (views.has(i))
                return views.get(i);
            const v = new WebKit.WebView({web_context: ctx, network_session: session, hexpand: true, vexpand: true});
            const s = v.get_settings();
            // 普通のサイトでは使わない重い機能を切る: 3D 描画（WebGL）、動画・音声の自動再生
            s.enable_webgl = false;
            s.media_playback_requires_user_gesture = true;
            s.enable_developer_extras = false;
            s.enable_back_forward_navigation_gestures = true;
            s.enable_page_cache = false; // 戻る用にページを丸ごと残さない（省メモリ）
            // 通知の許可だけ認める（カメラ・マイク・位置などは断る）
            v.connect('permission-request', (_v, req) => {
                if (req instanceof WebKit.NotificationPermissionRequest)
                    req.allow();
                else
                    req.deny();
                return true;
            });
            // Open new-window links in the default browser
            v.connect('decide-policy', (_v, decision, type) => {
                if (type === WebKit.PolicyDecisionType.NEW_WINDOW_ACTION) {
                    const uri = decision.get_navigation_action().get_request().get_uri();
                    if (uri)
                        openExternal(uri);
                    decision.ignore();
                    return true;
                }
                return false;
            });
            // ファビコンが取れたら保存してバーのアイコンに使う
            v.connect('notify::favicon', () => {
                const tex = v.get_favicon();
                const site = conf.sites[i];
                if (!tex || !site)
                    return;
                try {
                    tex.save_to_png(faviconPath(site.url));
                    buttons[i]?.set_child(new Gtk.Image({paintable: tex, pixel_size: 20}));
                } catch (e) {
                    logError(e, 'webpanel: favicon save');
                }
            });
            v.load_uri(conf.sites[i].url);
            stack.add_named(v, String(i));
            views.set(i, v);
            return v;
        };

        const select = i => {
            if (!conf.sites.length)
                return;
            i = Math.max(0, Math.min(i, conf.sites.length - 1));
            conf.current = i;
            saveConf(conf, n);
            viewFor(i);
            stack.visible_child_name = String(i);
            // メモリ節約: 見ていないサイトは閉じる（切り替えたときにもう一度読み込む。ログインは残る）
            for (const [j, v] of [...views]) {
                if (j !== i) {
                    views.delete(j);
                    // 画面から外すだけでは裏のプロセスが残るので、明示的に終了させる
                    try {
                        v.terminate_web_process();
                    } catch {}
                    stack.remove(v);
                    v.run_dispose();
                }
            }
            buttons.forEach((b, j) => {
                if (j === i)
                    b.add_css_class('active');
                else
                    b.remove_css_class('active');
            });
        };

        const rebuildSites = () => {
            let c;
            while ((c = sites.get_first_child()))
                sites.remove(c);
            buttons = conf.sites.map((site, i) => {
                const b = new Gtk.Button({child: siteIcon(site), css_classes: ['jwp-site'], tooltip_text: site.name});
                b.connect('clicked', () => select(i));
                // 右クリックで削除
                const gesture = new Gtk.GestureClick({button: 3});
                gesture.connect('pressed', () => {
                    const pop = new Gtk.Popover();
                    const del = new Gtk.Button({label: _f('Remove “{0}”', site.name), css_classes: ['flat', 'destructive-action']});
                    del.connect('clicked', () => {
                        pop.popdown();
                        SHARED.sites.splice(i, 1);
                        saveSites();
                        for (const p of PANES)
                            p.removed(i);
                    });
                    pop.set_child(del);
                    pop.set_parent(b);
                    pop.connect('show', () => {
                        popoverOpen = true;
                    });
                    pop.connect('closed', () => {
                        popoverOpen = false;
                        hideSoon();
                    });
                    pop.popup();
                });
                b.add_controller(gesture);
                sites.append(b);
                return b;
            });
        };

        // ＋: サイトを追加
        const addBtn = new Gtk.MenuButton({icon_name: 'list-add-symbolic', css_classes: ['jwp-icon'], tooltip_text: _('Add site')});
        const addPop = new Gtk.Popover();
        const addBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
        const nameEntry = new Gtk.Entry({placeholder_text: _('Name (e.g. Wikipedia)')});
        const urlEntry = new Gtk.Entry({placeholder_text: _('URL (e.g. wikipedia.org)')});
        const ok = new Gtk.Button({label: _('Add'), css_classes: ['suggested-action']});
        const doAdd = () => {
            let url = urlEntry.text.trim();
            if (!url)
                return;
            if (!/^[a-z]+:\/\//i.test(url))
                url = `https://${url}`;
            SHARED.sites.push({name: nameEntry.text.trim() || hostOf(url), url});
            saveSites();
            nameEntry.text = urlEntry.text = '';
            addPop.popdown();
            for (const p of PANES)
                p.rebuild();
            select(SHARED.sites.length - 1);
        };
        ok.connect('clicked', doAdd);
        urlEntry.connect('activate', doAdd);
        addBox.append(nameEntry);
        addBox.append(urlEntry);
        addBox.append(ok);
        addPop.set_child(addBox);
        addPop.connect('show', () => {
            popoverOpen = true;
        });
        addPop.connect('closed', () => {
            popoverOpen = false;
            hideSoon();
        });
        addBtn.popover = addPop;

        // 大きさ
        let sizeBtn = null;
        if (settings) {
            const nearest = () => {
                const w = settings.get_int(sizeKey(n, 'width'));
                let best = 0;
                PRESETS.forEach((p, i) => {
                    if (Math.abs(p[1] - w) < Math.abs(PRESETS[best][1] - w))
                        best = i;
                });
                return best;
            };
            sizeBtn = new Gtk.Button({label: PRESETS[nearest()][0], css_classes: ['jwp-size'], tooltip_text: _('Size (click or scroll)')});
            const apply = d => {
                const i = (nearest() + d + PRESETS.length) % PRESETS.length;
                settings.set_int(sizeKey(n, 'width'), PRESETS[i][1]);
                settings.set_int(sizeKey(n, 'height'), PRESETS[i][2]);
                sizeBtn.label = PRESETS[i][0];
            };
            sizeBtn.connect('clicked', () => apply(1));
            const wheel = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE});
            wheel.connect('scroll', (_c, _dx, dy) => {
                apply(dy > 0 ? 1 : -1);
                return true;
            });
            sizeBtn.add_controller(wheel);
        }

        // ペインの数（1 → 2 → 3 → 1 と回る。ホイールでも）。数が変わると拡張がカードとウィンドウを作り直す
        let countBtn = null;
        if (settings) {
            const countLabel = new Gtk.Label({label: String(settings.get_int('webpanel-count') || 1)});
            const countBox = new Gtk.Box({spacing: 3});
            countBox.append(new Gtk.Image({icon_name: 'view-dual-symbolic', pixel_size: 14}));
            countBox.append(countLabel);
            countBtn = new Gtk.Button({child: countBox, css_classes: ['jwp-size'], tooltip_text: _('Panes (click or scroll)')});
            const cycle = d => {
                const c = ((settings.get_int('webpanel-count') || 1) - 1 + d + PANEL_MAX) % PANEL_MAX + 1;
                settings.set_int('webpanel-count', c);
                countLabel.label = String(c);
            };
            countBtn.connect('clicked', () => cycle(1));
            const wheel2 = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE});
            wheel2.connect('scroll', (_c, _dx, dy) => {
                cycle(dy > 0 ? 1 : -1);
                return true;
            });
            countBtn.add_controller(wheel2);
        }

        const reload = new Gtk.Button({icon_name: 'view-refresh-symbolic', css_classes: ['jwp-icon'], tooltip_text: _('Reload')});
        reload.connect('clicked', () => views.get(conf.current)?.reload());
        const ext = new Gtk.Button({icon_name: 'adw-external-link-symbolic', css_classes: ['jwp-icon'], tooltip_text: _('Open in browser')});
        ext.connect('clicked', () => openExternal(views.get(conf.current)?.get_uri() ?? conf.sites[conf.current]?.url));

        dock.append(sites);
        dock.append(addBtn);
        dock.append(new Gtk.Box({css_classes: ['jwp-sep']}));
        if (countBtn)
            dock.append(countBtn);
        if (sizeBtn)
            dock.append(sizeBtn);
        dock.append(reload);
        dock.append(ext);

        win.set_child(root);
        rebuildSites();
        select(conf.current);
        // ほかのページでサイトが足された・消されたとき
        PANES.push({
            rebuild: () => {
                rebuildSites();
                buttons.forEach((b, j) => (j === conf.current ? b.add_css_class('active') : b.remove_css_class('active')));
            },
            removed: i => {
                // 消したサイトより後ろの番号は 1 つずれるので、開いているページを閉じて選び直す
                for (const v of views.values()) {
                    try {
                        v.terminate_web_process();
                    } catch {}
                    stack.remove(v);
                }
                views.clear();
                rebuildSites();
                if (!SHARED.sites.length)
                    return;
                select(conf.current > i ? conf.current - 1 : Math.min(conf.current, SHARED.sites.length - 1));
            },
        });

        // 休止・再開（拡張から D-Bus の org.gtk.Actions で呼ばれる）。ウィンドウに隠れている間はページを閉じてメモリを空ける
        let sleeping = false;
        let sleepUri = null;
        const sleepAction = new Gio.SimpleAction({name: `sleep-${n}`});
        sleepAction.connect('activate', () => {
            if (sleeping)
                return;
            sleepUri = views.get(conf.current)?.get_uri() ?? null;
            for (const [j, v] of [...views]) {
                views.delete(j);
                try {
                    v.terminate_web_process();
                } catch {}
                stack.remove(v);
                v.run_dispose();
            }
            sleeping = true;
        });
        const wakeAction = new Gio.SimpleAction({name: `wake-${n}`});
        wakeAction.connect('activate', () => {
            if (!sleeping)
                return;
            sleeping = false;
            select(conf.current);
            if (sleepUri && sleepUri.startsWith('http'))
                views.get(conf.current)?.load_uri(sleepUri);
        });
        app.add_action(sleepAction);
        app.add_action(wakeAction);
        win.present();
    };
    for (const n of INSTANCES)
        buildPanel(n);
});

// --width などの引数は自前で読むので、GApplication には渡さない
app.run([System.programInvocationName]);
