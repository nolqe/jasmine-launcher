// Jasmine Launcher: cards/parsec.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import Secret from 'gi://Secret';
import {PARSEC_APP, PARSEC_API, PARSEC_AUTH, SECRET_SCHEMA, SECRET_ATTRS, ELLIPSIZE_END, vbox, hbox, iconButton} from '../common.js';
import {_, _f} from '../i18n.js';

export class ParsecPart {
    // ---- Parsec（オンラインの PC 一覧。起動時・更新ボタン・ログイン時のみ取得） ----
    _buildParsec() {
        const card = vbox('jw-card jw-claude');
        const head = hbox('jw-row jw-claude-head');
        head.add_child(new St.Label({style_class: 'jw-title', text: 'Parsec', y_align: Clutter.ActorAlign.CENTER}));
        this._parsecStatus = new St.Label({style_class: 'jw-head-status', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._parsecStatus.clutter_text.ellipsize = ELLIPSIZE_END;
        this._parsecReload = iconButton('view-refresh-symbolic', () => this._refreshParsec(), 'jw-icon-small');
        this._parsecReload.y_align = Clutter.ActorAlign.CENTER;
        // 未ログインのときは見出しに小さな「ログイン」だけ出し、押したらフォームを開く
        this._loginOpen = false;
        this._loginToggle = this._pill(_('Sign in'), () => {
            this._loginOpen = !this._loginOpen;
            this._renderParsec();
            if (this._loginOpen)
                this._focusEntry(this._loginEmail);
        }, {plain: true});
        this._loginToggle.add_style_class_name('jw-chip');
        this._loginToggle.y_align = Clutter.ActorAlign.CENTER;
        head.add_child(this._parsecStatus);
        head.add_child(this._loginToggle);
        head.add_child(this._parsecReload);

        this._parsecList = vbox('jw-host-list');
        this._parsecScroll = new St.ScrollView({
            style_class: 'jw-host-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._parsecList,
        });

        // ログインフォーム（未ログイン・期限切れのときだけ表示）
        this._loginBox = vbox('jw-login');
        this._loginEmail = this._makeEntry(_('Email'), {onActivate: () => this._focusEntry(this._loginPass)});
        this._loginPass = this._makeEntry(_('Password'), {password: true, onActivate: () => this._parsecLogin()});
        this._loginTfa = this._makeEntry(_('2FA code (if needed)'), {onActivate: () => this._parsecLogin()});
        const loginBtn = this._pill(_('Sign in'), () => this._parsecLogin());
        loginBtn.x_align = Clutter.ActorAlign.END;
        for (const a of [this._loginEmail, this._loginPass, this._loginTfa, loginBtn])
            this._loginBox.add_child(a);

        card.add_child(head);
        card.add_child(this._parsecScroll);
        card.add_child(this._loginBox);
        return card;
    }

    _setParsec(hosts, status, needLogin = false) {
        this._parsecBusy = false;
        this._parsecState = {hosts, status, needLogin};
        this._renderParsec();
    }

    _setBusy(text) {
        this._parsecBusy = true;
        this._busyText = text;
        this._renderParsec();
    }

    _renderParsec() {
        if (!this._parsecList)
            return;
        const {hosts, status, needLogin} = this._parsecState;
        const hidden = new Set(this._settings.get_strv('parsec-hidden').map(n => n.trim()).filter(Boolean));
        const shown = hosts.filter(h => !hidden.has(String(h.name)));
        if (this._parsecBusy)
            this._parsecStatus.text = this._busyText ?? _('Updating…');
        else if (status === null)
            this._parsecStatus.text = shown.length ? _f('{0} online', shown.length) : _('None online');
        else
            this._parsecStatus.text = status;
        this._parsecReload.reactive = !this._parsecBusy;
        this._loginBox.visible = needLogin && this._loginOpen;
        this._loginToggle.visible = needLogin;
        this._loginToggle.label = this._loginOpen ? _('Close') : _('Sign in');
        this._parsecReload.visible = !needLogin;
        if (!needLogin)
            this._loginOpen = false;
        this._parsecList.destroy_all_children();
        for (const h of shown) {
            const row = hbox('jw-host-row jw-host-compact');
            const name = new St.Label({
                style_class: 'jw-host-name',
                text: String(h.name ?? h.peer_id),
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            name.clutter_text.ellipsize = ELLIPSIZE_END;
            const btn = this._pill(_('Connect'), () => {
                try {
                    const native = GLib.find_program_in_path('parsecd');
                    const argv = native ? [native, `peer_id=${h.peer_id}`] : ['flatpak', 'run', PARSEC_APP, `peer_id=${h.peer_id}`];
                    Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                } catch (e) {
                    logError(e, 'jasmine-launcher: parsec');
                }
            });
            btn.add_style_class_name('jw-chip');
            row.add_child(name);
            row.add_child(btn);
            this._parsecList.add_child(row);
        }
        this._parsecScroll.visible = shown.length > 0;
        const maxRows = Math.max(1, this._settings.get_int('parsec-max-rows'));
        this._parsecScroll.style = shown.length > maxRows ? `max-height: ${maxRows * 40}px;` : '';
        this._place();
    }

    // キーリングの裏側（gnome-keyring）が再起動すると、libsecret が覚えている古い接続（session s0 など）が
    // 「does not exist」で失敗し続ける。失敗したら接続を捨てて（Secret.Service.disconnect）1 回だけやり直す
    _secretLookup(cb, retry = true) {
        Secret.password_lookup(SECRET_SCHEMA, SECRET_ATTRS, this._cancel, (_o, res) => {
            let token;
            try {
                token = Secret.password_lookup_finish(res);
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                if (retry) {
                    Secret.Service.disconnect();
                    this._secretLookup(cb, false);
                    return;
                }
                logError(e, 'jasmine-launcher: secret');
                token = null;
            }
            cb(token);
        });
    }

    _secretStore(token, cb, retry = true) {
        Secret.password_store(SECRET_SCHEMA, SECRET_ATTRS, Secret.COLLECTION_DEFAULT,
            'Parsec session (Jasmine Launcher)', token, this._cancel, (_o, res) => {
                try {
                    Secret.password_store_finish(res);
                    cb(true);
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                    if (retry) {
                        Secret.Service.disconnect();
                        this._secretStore(token, cb, false);
                        return;
                    }
                    logError(e, 'jasmine-launcher: secret store');
                    cb(false);
                }
            });
    }

    _refreshParsec() {
        if (!this._soup || this._parsecBusy)
            return;
        this._setBusy(_('Updating…'));
        this._secretLookup(token => {
            if (!this._soup)
                return;
            if (!token) {
                this._setParsec([], _('Please sign in'), true);
                return;
            }
            const msg = Soup.Message.new('GET', PARSEC_API);
            msg.request_headers.append('Authorization', `Bearer ${token}`);
            msg.request_headers.append('User-Agent', 'jasmine-launcher');
            this._soup.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancel, (sess, r) => {
                try {
                    const bytes = sess.send_and_read_finish(r);
                    const code = msg.get_status();
                    if (code === 401 || code === 403) {
                        this._setParsec([], _('Please sign in again'), true);
                        return;
                    }
                    if (code !== 200) {
                        this._setParsec([], _f('Couldn’t load ({0})', code));
                        return;
                    }
                    const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    const hosts = (json.data ?? []).filter(h => !h.self && h.peer_id);
                    hosts.sort((a, b) => String(a.name).localeCompare(String(b.name)));
                    this._setParsec(hosts, null);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._setParsec([], _('Couldn’t load'));
                }
            });
        });
    }

    // メール・パスワードは Parsec 公式 API にだけ送り、保存しない。保存するのはセッション ID のみ（キーリング）。
    _parsecLogin() {
        if (!this._soup || this._parsecBusy || !this._loginBox)
            return;
        const email = this._loginEmail.text.trim();
        const password = this._loginPass.text;
        const tfa = this._loginTfa.text.trim();
        if (!email || !password) {
            this._parsecStatus.text = _('Enter your email and password');
            return;
        }
        this._ungrab();
        // パスワードは成功するまで残す（2 段階認証を求められたとき、コードだけ足してもう一度押せるように）
        this._loginTfa.text = '';
        this._setBusy(_('Signing in…'));
        const msg = Soup.Message.new('POST', PARSEC_AUTH);
        msg.request_headers.append('User-Agent', 'jasmine-launcher');
        const body = JSON.stringify({email, password, tfa});
        msg.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));
        this._soup.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancel, (sess, r) => {
            let json = {};
            try {
                const bytes = sess.send_and_read_finish(r);
                try {
                    json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                } catch {}
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    this._setParsec([], _('Couldn’t sign in (network error)'), true);
                return;
            }
            const token = json.session_id ?? json.data?.id;
            if (!token) {
                const err = String(json.error ?? '');
                this._setParsec([], /tfa|two.?factor|2fa/i.test(err)
                    ? _('Enter your 2FA code and sign in again')
                    : _f('Couldn’t sign in ({0})', msg.get_status()), true);
                return;
            }
            if (this._loginPass)
                this._loginPass.text = '';
            this._secretStore(token, ok => {
                if (!ok) {
                    this._setParsec([], _('Couldn’t save to the keyring'), true);
                    return;
                }
                this._parsecBusy = false;
                this._loginOpen = false;
                this._refreshParsec();
            });
        });
    }
}
