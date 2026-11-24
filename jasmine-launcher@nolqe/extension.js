// Jasmine Launcher — desktop cards, Super+F launcher, multi-pane web panel, tablet mode & floating keyboard.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Soup from 'gi://Soup?version=3.0';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {TabletMode} from './tablet.js';
import {FloatingKeyboard} from './osk.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {LauncherPopup} from './launcher.js';
import {GNOME_ACCENTS, CORNERS, CARD_CLICK, WidgetsIndicator, readText, hexToRgb, Mpris, setClaudeDir} from './common.js';
import {CARDS} from './cards/index.js';
import {FEATURES} from './features/index.js';
import {_, setLang} from './i18n.js';

export default class JasmineLauncher extends Extension {
    enable() {
        this._settings = this.getSettings();
        setLang(this._settings.get_string('language'));
        this._soup = new Soup.Session({timeout: 10});
        this._cancel = new Gio.Cancellable();
        this._grab = null;
        this._artUrl = null;
        this._artPath = null;
        this._parsecBusy = false;
        this._parsecState = {hosts: [], status: _('Loading…'), needLogin: false};

        this._mpris = new Mpris(() => this._updateMusic());
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (/^webpanel-(width|height)$/.test(key)) {
                this._resizePanelCard();
                return;
            }
            if (key === 'osk-enabled') {
                this._osk?.setActive(!!this._tablet?.active && this._settings.get_boolean(key));
                return;
            }
            if (key === 'language') {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this._settings) {
                        this.disable();
                        this.enable();
                    }
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
            if (key === 'system-interval') {
                this._sysUnwatch();
                this._sysWatch();
                return;
            }
            if (key === 'show-tablet-button') {
                if (this._tabletButton)
                    this._tabletButton.visible = this._settings.get_boolean(key);
                return;
            }
            if (['swipe-minimize', 'osk-pos', 'osk-size', 'launcher-width', 'launcher-top', 'music-app', 'quick-send-app', 'tablet-on', 'tablet-saved'].includes(key))
                return;
            if (key === 'paseo-max') {
                this._renderClaude();
                return;
            }
            if (key === 'card-positions') {
                if (!this._saving && !this._dragging)
                    this._place();
                return;
            }
            if (key === 'order' && this._saving)
                return;
            this._rebuild();
            if (key === 'show-parsec' && this._settings.get_boolean('show-parsec') && !this._parsecLoaded) {
                this._parsecLoaded = true;
                this._refreshParsec();
            }
        });
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            this._raiseColumn();
            this._place();
        });
        // スリープから戻ったときなど、GNOME が壁紙を作り直すと新しい壁紙が同じ層のいちばん上に入り、ウィジェットが
        // その裏に隠れて「全部消えた」ように見える（2026-11-24 に発生）。壁紙の層に何か入ったら、ウィジェットを上に戻す
        this._bgAddedId = Main.layoutManager._backgroundGroup.connect('child-added', (_g, child) => {
            if (child !== this._column)
                this._raiseColumnSoon();
        });
        // GNOME のダーク・ライトとアクセントカラーに合わせる設定のため、GNOME 側の変更も見る
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ifaceId = this._iface.connect('changed', (_s, key) => {
            if ((key === 'color-scheme' && this._settings.get_string('theme') === 'system') ||
                (key === 'accent-color' && this._settings.get_boolean('accent-system'))) {
                this._rebuild();
                this._ensurePanel?.();
            }
        });

        this._paseoWatch();
        this._museWatch();
        this._sysWatch();
        this._indicator = new WidgetsIndicator(this);
        this._launcher = new LauncherPopup(this);
        Main.wm.addKeybinding('launcher-shortcut', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP, () => this._launcher?.toggle());
        Main.wm.addKeybinding('tablet-shortcut', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._tablet?.toggle());
        Main.wm.addKeybinding('peek-shortcut', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._togglePeek());
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        // 上のバーのボタン: タブレットモード（自動回転・画面キーボード・タッチパッド無効）をワンボタンで切り替え
        this._tabletIcon = new St.Icon({icon_name: 'computer-symbolic', style_class: 'system-status-icon'});
        this._tabletButton = new PanelMenu.Button(0.0, _('Tablet mode'), true);
        this._tabletButton.add_child(this._tabletIcon);
        this._swipeWatch();
        this._cardTouchWatch();
        this._panelWatch();
        // キーボードが失敗してもウィジェット全体は止めない
        try {
            this._osk = new FloatingKeyboard(this);
        } catch (e) {
            logError(e, 'jasmine-launcher: floating keyboard');
            this._osk = null;
        }
        this._tablet = new TabletMode(this._settings, on => {
            try {
                this._osk?.setActive(on && this._settings.get_boolean('osk-enabled'));
            } catch (e) {
                logError(e, 'jasmine-launcher: floating keyboard');
            }
            this._tabletIcon.icon_name = on ? 'tablet-symbolic' : 'computer-symbolic';
            if (on)
                this._tabletButton?.add_style_pseudo_class('checked');
            else
                this._tabletButton?.remove_style_pseudo_class('checked');
        });
        this._tabletButton.connect('event', (_b, ev) => {
            const t = ev.type();
            if (t === Clutter.EventType.BUTTON_RELEASE || t === Clutter.EventType.TOUCH_END) {
                this._tablet?.toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        Main.panel.addToStatusArea('jasmine-launcher-tablet', this._tabletButton, 0, 'right');
        this._tabletButton.visible = this._settings.get_boolean('show-tablet-button');
        this._parsecLoaded = false;
        this._rebuild();
        if (this._settings.get_boolean('show-parsec')) {
            this._parsecLoaded = true;
            this._refreshParsec();
        }
    }

    disable() {
        Main.wm.removeKeybinding('launcher-shortcut');
        Main.wm.removeKeybinding('peek-shortcut');
        Main.wm.removeKeybinding('tablet-shortcut');
        this._endPeek(false);
        this._swipeUnwatch();
        this._cardTouchUnwatch();
        this._panelUnwatch();
        // 画面ロックで止まるときは、タブレットモードの向きを保ったまま、ロック画面では GNOME の画面キーボードを使う
        this._tablet?.destroy(Main.sessionMode.isLocked);
        this._tablet = null;
        this._osk?.destroy();
        this._osk = null;
        this._tabletButton?.destroy();
        this._tabletButton = this._tabletIcon = null;
        this._launcher?.destroy();
        this._launcher = null;
        this._indicator?.quickSettingsItems.forEach(i => i.destroy());
        this._indicator?.destroy();
        this._indicator = null;
        this._museUnwatch();
        this._sysUnwatch();
        this._stopPanel('all');
        if (this._progTick)
            GLib.source_remove(this._progTick);
        this._progTick = 0;
        this._paseoUnwatch();
        this._ungrab();
        this._endDrag();
        this._cancel?.cancel();
        this._soup?.abort();
        this._mpris?.destroy();
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        if (this._monitorsId)
            Main.layoutManager.disconnect(this._monitorsId);
        if (this._bgAddedId)
            Main.layoutManager._backgroundGroup.disconnect(this._bgAddedId);
        this._bgAddedId = 0;
        if (this._raiseId)
            GLib.source_remove(this._raiseId);
        this._raiseId = 0;
        if (this._ifaceId)
            this._iface.disconnect(this._ifaceId);
        this._ifaceId = 0;
        this._iface = null;
        if (this._fgFile) {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._fgFile);
            this._fgFile = null;
        }
        this._fgKey = undefined;
        if (this._placeId)
            GLib.source_remove(this._placeId);
        this._placeId = 0;
        this._column?.destroy();
        this._cards = null;
        this._column = this._mpris = this._soup = this._cancel = this._settings = null;
        this._settingsId = this._monitorsId = 0;
        this._clearRefs();
    }

    // ウィジェットの土台を壁紙の層のいちばん上へ（オーバーレイ中は別の層にいるので何もしない）
    _raiseColumn() {
        const g = Main.layoutManager._backgroundGroup;
        if (this._column && this._column.get_parent() === g)
            g.set_child_above_sibling(this._column, null);
    }

    _raiseColumnSoon() {
        if (this._raiseId)
            return;
        this._raiseId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._raiseId = 0;
            this._raiseColumn();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearRefs() {
        this._art = this._musicTitle = this._musicArtist = this._playBtn = null;
        this._progTrack = this._progFill = null;
        this._parsecList = this._parsecScroll = this._parsecStatus = this._parsecReload = null;
        this._loginBox = this._loginEmail = this._loginPass = this._loginTfa = null;
        this._claudeList = this._claudeHead = null;
        this._sys = null;
        this._clearPanelRefs?.();
    }

    // ---- 全体の組み立て（設定変更のたびに作り直す） ----
    _rebuild() {
        setClaudeDir(this._settings.get_string('claude-dir'));
        this._endPeek(false);
        this._ungrab();
        this._endDrag();
        this._column?.destroy();
        this._clearRefs();
        const st = this._settings;

        // 土台は位置を持たない入れ物（FixedLayout）。カードを 1 枚ずつ自由に置く
        this._column = new St.Widget({
            style_class: `jw-column ${this._isLight() ? 'jw-light' : 'jw-dark'}${this._applyFg() ? ' jw-fg' : ''}`,
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
        });
        this._column.style = `font-size: ${(11 * st.get_double('font-scale')).toFixed(1)}pt;`;
        this._cards = [];

        // カードは cards/index.js の登録から作る
        const builders = Object.fromEntries(CARDS.map(c => [c.key, () => this[c.build]()]));
        const order = st.get_strv('order').filter(k => builders[k]);
        for (const k of Object.keys(builders)) {
            if (order.includes(k))
                continue;
            order.push(k);
        }
        for (const k of order) {
            if (!st.get_boolean(`show-${k}`))
                continue;
            const card = this._styleCard(builders[k]());
            if (CARD_CLICK[k]) {
                // 押せるカードは、マウスを乗せると縁取りを出す（見た目は直接指定なので、ここで足す）
                const base = card.style;
                const ring = this._isLight() ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.16)';
                card.track_hover = true;
                card.connect('notify::hover', () => {
                    card.style = card.hover ? `${base} box-shadow: inset 0 0 0 1px ${ring}${st.get_boolean('shadow') ? ', 0 4px 16px rgba(0, 0, 0, 0.35)' : ''};` : base;
                });
            }
            if (k !== 'memory') // メモリ整理は小さな正方形（大きさはカード側で固定）
                card.width = k.startsWith('webpanel') ? this._panelCardWidth(k) : st.get_int('width');
            card.reactive = true;
            // マウスでつかんで動かす・押す（指は _cardTouchWatch で）
            card.connect('button-press-event', (_a, ev) => this._startDrag(k, card, ev));
            card.connect('notify::height', () => this._placeSoon());
            this._column.add_child(card);
            this._cards.push({key: k, actor: card});
            card.opacity = 0;
            card.ease({opacity: 255, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }

        this._column.visible = st.get_boolean('visible') && this._column.get_n_children() > 0;
        Main.layoutManager._backgroundGroup.add_child(this._column);
        this._place();
        this._renderParsec();
        this._updateMusic();
        this._renderClaude();
        this._updateSystem();
        this._ensurePanel();
    }

    _styleCard(card) {
        const st = this._settings;
        const light = this._isLight();
        const a = Math.max(0, Math.min(1, st.get_double('opacity')));
        const custom = /^#[0-9a-f]{6}$/i.test(st.get_string('card-bg')) ? hexToRgb(st.get_string('card-bg')) : null;
        const bg = custom ? `rgba(${custom.join(', ')}, ${a})` : light ? `rgba(250, 250, 252, ${a})` : `rgba(36, 36, 40, ${a})`;
        const shadow = st.get_boolean('shadow') ? 'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);' : '';
        card.style = `background-color: ${bg}; border-radius: ${st.get_int('corner-radius')}px; ${shadow}`;
        return card;
    }

    // ---- 色（テーマ・アクセント・カードの文字色） ----
    // テーマ: dark / light / system（GNOME のダーク・ライト設定に合わせる）
    _isLight() {
        const t = this._settings?.get_string('theme');
        if (t === 'system' && this._iface)
            return this._iface.get_string('color-scheme') !== 'prefer-dark';
        return t === 'light';
    }

    _accentHex() {
        if (this._settings?.get_boolean('accent-system') && this._iface?.settings_schema.has_key('accent-color'))
            return GNOME_ACCENTS[this._iface.get_string('accent-color')] ?? '#3584e4';
        return this._settings?.get_string('accent') || '#3584e4';
    }

    // 文字色の指定があれば、stylesheet.css のダーク／ライトの文字色（白・黒）をその色に置き換えたスタイルを作って読み込む。
    // セレクタは .jw-column.jw-fg（.jw-dark より強い）。戻り値: 使うかどうか
    _applyFg() {
        const fg = this._settings.get_string('card-fg');
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        const want = /^#[0-9a-f]{6}$/i.test(fg) ? `${fg.toLowerCase()}-${this._isLight() ? 'l' : 'd'}` : null;
        if (this._fgKey === want)
            return !!want;
        if (this._fgFile) {
            theme.unload_stylesheet(this._fgFile);
            this._fgFile = null;
        }
        this._fgKey = want;
        if (!want)
            return false;
        const [r, g, b] = hexToRgb(fg);
        const base = this._isLight() ? 'jw-light' : 'jw-dark';
        const src = readText(GLib.build_filenamev([this.path, 'stylesheet.css'])).replace(/\/\*[\s\S]*?\*\//g, '');
        const out = [];
        for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            const sel = m[1].trim();
            if (!sel.split(',').some(x => x.trim().startsWith(`.${base}`)) || !/(^|[;\s])color:/.test(m[2]))
                continue;
            const decl = m[2].split(';').map(d => d.trim()).filter(d => /^color:/.test(d)).map(d => d
                .replace(/#ffffff|#1e1e22/i, `rgb(${r}, ${g}, ${b})`)
                .replace(/rgba\((255, 255, 255|0, 0, 0), ([\d.]+)\)/, `rgba(${r}, ${g}, ${b}, $2)`));
            const sels = sel.split(',').map(x => x.trim()).filter(x => x.startsWith(`.${base}`)).map(x => x.replace(`.${base}`, '.jw-column.jw-fg'));
            out.push(`${sels.join(', ')} { ${decl.join('; ')}; }`);
        }
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'jasmine-launcher']);
        GLib.mkdir_with_parents(dir, 0o700);
        this._fgFile = Gio.File.new_for_path(GLib.build_filenamev([dir, `fg-${want.replace('#', '')}.css`]));
        this._fgFile.replace_contents(new TextEncoder().encode(out.join('\n') + '\n'), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        theme.load_stylesheet(this._fgFile);
        return true;
    }

    _pill(label, cb, {plain = false} = {}) {
        const [r, g, b] = hexToRgb(this._accentHex());
        const btn = new St.Button({style_class: plain ? 'jw-pill jw-pill-plain' : 'jw-pill', label, y_align: Clutter.ActorAlign.CENTER});
        if (!plain)
            btn.style = `background-color: rgb(${r}, ${g}, ${b});`;
        btn.connect('clicked', cb);
        return btn;
    }

    _positions() {
        try {
            const p = JSON.parse(this._settings.get_string('card-positions'));
            return p && typeof p === 'object' ? p : {};
        } catch {
            return {};
        }
    }

    // 高さが変わったときなどに、まとめて 1 回だけ並べ直す
    _placeSoon() {
        if (this._placeId || this._dragging)
            return;
        this._placeId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._placeId = 0;
            this._place();
            return GLib.SOURCE_REMOVE;
        });
    }

    // カードの場所: card-positions の値が [x, y] なら自由、'top-left' などなら その角、無ければ基本位置（position）
    _placement(key, saved) {
        const v = saved[key];
        if (Array.isArray(v))
            return v;
        if (CORNERS.includes(v))
            return v;
        const g = this._settings.get_string('position');
        return CORNERS.includes(g) ? g : 'top-right';
    }

    _cornerGeometry(corner, w, total) {
        const m = Main.layoutManager.primaryMonitor;
        const margin = this._settings.get_int('margin');
        const top = m.y + (Main.panel?.height ?? 32) + margin;
        const x = corner.endsWith('left') ? m.x + margin : m.x + m.width - w - margin;
        const y = corner.startsWith('top') ? top : m.y + m.height - total - margin - 72; // 下は Dock の分を空ける
        return [x, y];
    }

    // 角ごとにカードを並べ、自由なカードは保存した位置に置く
    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m || !this._column || !this._cards)
            return;
        const st = this._settings;
        const spacing = st.get_int('spacing');
        const w = st.get_int('width');
        const saved = this._positions();
        for (const corner of CORNERS) {
            const group = this._cards.filter(c => this._placement(c.key, saved) === corner);
            if (!group.length)
                continue;
            const heights = group.map(c => c.actor.get_preferred_height(w)[1]);
            const total = heights.reduce((a, b) => a + b, 0) + (group.length - 1) * spacing;
            let [, y] = this._cornerGeometry(corner, w, total);
            group.forEach((c, i) => {
                // 右寄せはカードごとの幅で（Web パネルだけ幅が違うため）
                const [x] = this._cornerGeometry(corner, c.actor.width || w, total);
                if (this._dragging?.card !== c.actor)
                    c.actor.set_position(Math.round(x), Math.round(y));
                y += heights[i] + spacing;
            });
        }
        for (const c of this._cards) {
            const p = this._placement(c.key, saved);
            if (Array.isArray(p) && this._dragging?.card !== c.actor)
                c.actor.set_position(...this._clamp(c.actor, p[0], p[1]));
        }
        this._syncPanelSoon();
    }

    // 落とした場所が画面の左右の端の近くなら、その角の列に入れる（上半分なら上の角、下半分なら下の角）
    _dropCorner(card) {
        const m = Main.layoutManager.primaryMonitor;
        const margin = this._settings.get_int('margin');
        const NEAR = 48;
        const left = m.x + margin, right = m.x + m.width - card.width - margin;
        const side = Math.abs(card.x - left) <= NEAR ? 'left' : Math.abs(card.x - right) <= NEAR ? 'right' : null;
        if (!side)
            return null;
        const upper = card.y + card.height / 2 < m.y + m.height / 2;
        return `${upper ? 'top' : 'bottom'}-${side}`;
    }

    // 角の列に入れたとき、落とした高さに合わせて並び順（order）を入れ替える
    _reorderInto(key, corner, dropY, saved) {
        const order = this._cards.map(c => c.key);
        const others = this._cards.filter(c => c.key !== key && this._placement(c.key, saved) === corner);
        const before = others.find(c => c.actor.y + c.actor.height / 2 > dropY);
        const full = this._settings.get_strv('order').filter(k => k !== key);
        for (const k of order) {
            if (!full.includes(k) && k !== key)
                full.push(k);
        }
        const at = before ? full.indexOf(before.key) : (others.length ? full.indexOf(others[others.length - 1].key) + 1 : full.length);
        full.splice(at < 0 ? full.length : at, 0, key);
        this._cards.sort((a, b) => full.indexOf(a.key) - full.indexOf(b.key));
        this._saving = true;
        this._settings.set_strv('order', full);
        this._saving = false;
    }

    // ---- カードを 1 枚ずつドラッグ（余白部分をつかむ）。近くのカードの端に吸着 ----
    // grab 中のイベントは grab 先（そのカード）の配下にしか届かないので、カード側で受ける。
    _startDrag(key, card, ev) {
        if (ev.get_button() !== 1 || this._grab || this._dragGrab || this._dragging)
            return Clutter.EVENT_PROPAGATE;
        if (!this._settings.get_boolean('allow-drag')) {
            if (CARD_CLICK[key]) {
                CARD_CLICK[key](this);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        // ボタン・入力欄・一覧の上で押したときはドラッグを始めない（クリックや入力を横取りしないため）
        for (let a = global.stage.get_event_actor(ev); a && a !== card; a = a.get_parent()) {
            if (a instanceof St.Button || a instanceof St.Entry || a instanceof St.ScrollView || a instanceof Clutter.Text)
                return Clutter.EVENT_PROPAGATE;
        }
        const [sx, sy] = ev.get_coords();
        this._dragging = {key, card, sx, sy, dx: sx - card.x, dy: sy - card.y, moved: false};
        this._dragId = card.connect('captured-event', (_a, e) => {
            const type = e.type();
            const d = this._dragging;
            if (type === Clutter.EventType.MOTION && d) {
                const [x, y] = e.get_coords();
                if (!d.moved && Math.hypot(x - d.sx, y - d.sy) < 6)
                    return Clutter.EVENT_STOP; // 小さな手ぶれではまだ動かさない
                if (!d.moved) {
                    d.moved = true;
                    card.get_parent()?.set_child_above_sibling(card, null); // 動かすカードを手前に
                }
                card.set_position(...this._snap(card, ...this._clamp(card, x - d.dx, y - d.dy)));
                if (d.key === 'webpanel')
                    this._syncPanel();
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.BUTTON_RELEASE) {
                const moved = d?.moved;
                this._endDrag();
                this._dropCard(key, card, moved);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_STOP; // ドラッグ中はほかの部品に渡さない
        });
        this._dragGrab = global.stage.grab(card);
        return Clutter.EVENT_STOP;
    }

    // 離したとき: 動かしていなければカードを押した扱い、動かしていれば置いた場所を保存
    _dropCard(key, card, moved) {
        if (!moved) {
            CARD_CLICK[key]?.(this);
            return;
        }
        if (!this._cards)
            return;
        const p = this._positions();
        const corner = this._dropCorner(card);
        if (corner) {
            this._reorderInto(key, corner, card.y + card.height / 2, p);
            p[key] = corner;
        } else {
            p[key] = [Math.round(card.x), Math.round(card.y)];
        }
        this._saving = true;
        this._settings.set_string('card-positions', JSON.stringify(p));
        this._saving = false;
        this._place();
    }

    // ---- 指（タッチ）でカードをつかむ・動かす・押す ----
    // カードに届くはずのタッチが GNOME 側のジェスチャー処理に先に取られて届かないため、イベントフィルターで最初に見る。
    // ボタン・入力欄・一覧の上のタッチは今までどおりそれぞれに渡す
    _cardTouchWatch() {
        this._touch = null;
        this._touchId = Clutter.Event.add_filter(global.stage, ev => this._onCardTouch(ev));
    }

    _cardTouchUnwatch() {
        if (this._touchId)
            Clutter.Event.remove_filter(this._touchId);
        this._touchId = 0;
        this._touch = null;
    }

    _onCardTouch(ev) {
        const t = ev.type();
        if (t === Clutter.EventType.TOUCH_BEGIN) {
            if (this._touch || this._dragging || !this._cards?.length || !this._column?.visible)
                return Clutter.EVENT_PROPAGATE;
            let card = null;
            for (let a = global.stage.get_event_actor(ev); a; a = a.get_parent()) {
                if (a instanceof St.Button || a instanceof St.Entry || a instanceof St.ScrollView || a instanceof Clutter.Text)
                    return Clutter.EVENT_PROPAGATE;
                card = this._cards.find(c => c.actor === a);
                if (card)
                    break;
            }
            if (!card)
                return Clutter.EVENT_PROPAGATE;
            const [sx, sy] = ev.get_coords();
            const a = card.actor;
            this._touch = {seq: ev.get_event_sequence()?.get_slot?.() ?? 0, key: card.key, card: a, sx, sy, dx: sx - a.x, dy: sy - a.y, moved: false};
            return Clutter.EVENT_STOP;
        }
        const d = this._touch;
        if (!d || (t !== Clutter.EventType.TOUCH_UPDATE && t !== Clutter.EventType.TOUCH_END && t !== Clutter.EventType.TOUCH_CANCEL))
            return Clutter.EVENT_PROPAGATE;
        if ((ev.get_event_sequence()?.get_slot?.() ?? 0) !== d.seq) // 別の指
            return Clutter.EVENT_PROPAGATE;
        if (t === Clutter.EventType.TOUCH_UPDATE) {
            if (!this._settings.get_boolean('allow-drag'))
                return Clutter.EVENT_STOP;
            const [x, y] = ev.get_coords();
            if (!d.moved && Math.hypot(x - d.sx, y - d.sy) < 8)
                return Clutter.EVENT_STOP;
            if (!d.moved) {
                d.moved = true;
                d.card.get_parent()?.set_child_above_sibling(d.card, null);
            }
            d.card.set_position(...this._snap(d.card, ...this._clamp(d.card, x - d.dx, y - d.dy)));
            if (d.key === 'webpanel')
                this._syncPanel();
            return Clutter.EVENT_STOP;
        }
        this._touch = null;
        if (t === Clutter.EventType.TOUCH_END)
            this._dropCard(d.key, d.card, d.moved);
        else if (d.moved)
            this._place();
        return Clutter.EVENT_STOP;
    }

    _endDrag() {
        if (this._dragId) {
            this._dragging?.card?.disconnect(this._dragId);
            this._dragId = 0;
        }
        this._dragGrab?.dismiss();
        this._dragGrab = null;
        this._dragging = null;
    }

    // ほかのカードの左右の端・上下の端（間隔つき）に 12px 以内なら吸着
    _snap(card, x, y) {
        const SNAP = 12;
        const gap = this._settings.get_int('spacing');
        const w = card.width, h = card.height;
        let bx = null, by = null;
        for (const c of this._cards ?? []) {
            const o = c.actor;
            if (o === card || !o.visible)
                continue;
            for (const tx of [o.x, o.x + o.width - w, o.x + o.width + gap, o.x - w - gap]) {
                if (Math.abs(x - tx) <= SNAP && (bx === null || Math.abs(x - tx) < Math.abs(x - bx)))
                    bx = tx;
            }
            for (const ty of [o.y, o.y + o.height + gap, o.y - h - gap]) {
                if (Math.abs(y - ty) <= SNAP && (by === null || Math.abs(y - ty) < Math.abs(y - by)))
                    by = ty;
            }
        }
        return [Math.round(bx ?? x), Math.round(by ?? y)];
    }

    // 画面（上のバーの下〜画面下）からはみ出さない位置に丸める
    _clamp(actor, x, y) {
        const m = Main.layoutManager.primaryMonitor;
        if (!m || !actor)
            return [Math.round(x), Math.round(y)];
        const w = actor.width;
        const h = actor.height;
        const top = m.y + (Main.panel?.height ?? 32);
        x = Math.max(m.x, Math.min(x, m.x + m.width - w));
        y = Math.max(top, Math.min(y, m.y + m.height - Math.min(h, 80)));
        return [Math.round(x), Math.round(y)];
    }
}

// カード・機能ごとのファイル（cards/・features/）のメソッドを本体に取り込む
for (const Part of [...CARDS.map(c => c.part), ...FEATURES]) {
    for (const k of Object.getOwnPropertyNames(Part.prototype)) {
        if (k !== 'constructor')
            Object.defineProperty(JasmineLauncher.prototype, k, Object.getOwnPropertyDescriptor(Part.prototype, k));
    }
}
