// Jasmine Launcher: cards/paseo.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ELLIPSIZE_END, PASEO_AGENTS, claudeDir, runClaude, UUID_RE, paseoInstalled, withPaseoCli, paseoExec, readText, openPaseoAgent, launch, vbox, hbox, iconButton, paseoDesktop} from '../common.js';
import {_, _f} from '../i18n.js';

export class PaseoPart {
    // ---- Paseo card: reads agent sessions directly from ~/.paseo/agents/*/*.json ----
    _buildClaude() {
        const card = vbox('jw-card jw-claude');
        this._claudeHead = null;
        this._claudeList = vbox('jw-sess-list');
        this._claudeList.x_expand = true;
        const open = iconButton('view-list-bullet-symbolic', () => (paseoInstalled() ? launch(paseoDesktop()) : runClaude(['-r'])), 'jw-icon-small');
        open.y_align = Clutter.ActorAlign.START; // ☰ は一覧の右上に（専用の行を使わない）
        const row = hbox('jw-claude-row');
        row.add_child(this._claudeList);
        row.add_child(open);
        card.add_child(row);
        return card;
    }

    _paseoWatch() {
        this._paseoMons = [];
        const root = Gio.File.new_for_path(PASEO_AGENTS);
        const watch = dir => {
            try {
                const m = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
                m.set_rate_limit(500);
                m.connect('changed', (_m, f, _o, ev) => {
                    // 作業フォルダごとのサブフォルダが新しくできたら、それも見る
                    if (ev === Gio.FileMonitorEvent.CREATED && dir === root && f.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY)
                        watch(f);
                    this._schedulePaseo();
                });
                this._paseoMons.push(m);
            } catch {}
        };
        if (GLib.file_test(PASEO_AGENTS, GLib.FileTest.IS_DIR)) {
            watch(root);
            try {
                const en = root.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                let i;
                while ((i = en.next_file(null))) {
                    if (i.get_file_type() === Gio.FileType.DIRECTORY)
                        watch(root.get_child(i.get_name()));
                }
                en.close(null);
            } catch {}
        }
        // 「○分前」を進めるため 30 秒ごとにも描き直す
        this._paseoTick = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 30, () => {
            this._renderClaude();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _paseoUnwatch() {
        for (const m of this._paseoMons ?? [])
            m.cancel();
        this._paseoMons = null;
        if (this._paseoTick)
            GLib.source_remove(this._paseoTick);
        this._paseoTick = 0;
        if (this._paseoRenderId)
            GLib.source_remove(this._paseoRenderId);
        this._paseoRenderId = 0;
    }

    _schedulePaseo() {
        if (this._paseoRenderId)
            return;
        this._paseoRenderId = GLib.timeout_add(GLib.PRIORITY_LOW, 250, () => {
            this._paseoRenderId = 0;
            this._renderClaude();
            return GLib.SOURCE_REMOVE;
        });
    }

    _readPaseo() {
        const out = [];
        const root = Gio.File.new_for_path(PASEO_AGENTS);
        let dirs;
        try {
            dirs = root.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            return out;
        }
        let d;
        while ((d = dirs.next_file(null))) {
            if (d.get_file_type() !== Gio.FileType.DIRECTORY)
                continue;
            const dir = root.get_child(d.get_name());
            let files;
            try {
                files = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            } catch {
                continue;
            }
            let f;
            while ((f = files.next_file(null))) {
                if (!f.get_name().endsWith('.json'))
                    continue;
                try {
                    const j = JSON.parse(readText(dir.get_child(f.get_name()).get_path()));
                    if (!j.id || j.archivedAt || j.internal)
                        continue;
                    out.push(j);
                } catch {}
            }
            files.close(null);
        }
        dirs.close(null);
        // 確認待ち → 作業中 → 完了（未確認） → そのほか、の順。同じなら新しい順
        const rank = a => (a.requiresAttention && a.attentionReason === 'permission') ? 0
            : a.lastStatus === 'running' ? 1 : a.requiresAttention ? 2 : 3;
        const t = a => Date.parse(a.lastActivityAt ?? a.updatedAt ?? 0) || 0;
        return out.sort((a, b) => rank(a) - rank(b) || t(b) - t(a));
    }

    // Claude に頼む: Paseo があれば新しい会話を作ってその画面を開く。空なら Paseo を開くだけ。なければターミナル
    _askClaude(q) {
        if (!paseoInstalled()) {
            runClaude(q ? [q] : []);
            return;
        }
        if (!q) {
            launch(paseoDesktop());
            return;
        }
        const cwd = claudeDir.replace(/^~(?=$|\/)/, GLib.get_home_dir()) || GLib.get_home_dir();
        Main.notify('Claude', _('Starting in Paseo…'));
        const fail = () => {
            Main.notify('Claude', _('Couldn’t start in Paseo — opening a terminal'));
            runClaude([q]);
        };
        withPaseoCli(cli => {
            if (!cli) {
                fail();
                return;
            }
            paseoExec(cli, ['workspace', 'ls', '--json'], (_ok, wsOut) => {
                let ws = null;
                try {
                    const list = JSON.parse(wsOut.slice(wsOut.indexOf('[')));
                    ws = list.find(w => w.cwd === cwd && !w.background && w.isolation === 'local')?.workspaceId ?? null;
                } catch {}
                const args = ['run', '--no-wait', '--provider', 'claude', ...(ws ? ['--workspace', ws] : ['--cwd', cwd]), '-q', q];
                paseoExec(cli, args, (ok, out) => {
                    const ids = out.match(new RegExp(UUID_RE.source, 'gi')) ?? [];
                    const id = ids[ids.length - 1];
                    if (!ok || !id || !openPaseoAgent(id))
                        fail();
                });
            });
        });
    }

    _renderClaude() {
        if (!this._claudeList)
            return;
        this._claudeList.destroy_all_children();
        const agents = this._readPaseo();
        const now = Date.now() / 1000;
        const ago = t => {
            const m = Math.max(0, Math.floor((now - t) / 60));
            return m < 1 ? _('now') : m < 60 ? _f('{0}m', m) : m < 1440 ? _f('{0}h', Math.floor(m / 60)) : _f('{0}d', Math.floor(m / 1440));
        };
        for (const a of agents.slice(0, Math.max(1, this._settings.get_int('paseo-max')))) {
            const perm = a.requiresAttention && a.attentionReason === 'permission';
            const err = a.lastStatus === 'error' || (a.requiresAttention && a.attentionReason === 'error');
            const running = a.lastStatus === 'running' && !perm;
            const finished = a.requiresAttention && !perm && !err;
            const [cls, label] = perm ? ['jw-dot-waiting', _('Needs input')] : err ? ['jw-dot-error', _('Error')] : running ? ['jw-dot-working', null]
                : finished ? ['jw-dot-done', _('Done')] : ['jw-dot-idle', null];

            const line = hbox('jw-sess-line');
            line.x_expand = true;
            const dot = new St.Widget({style_class: `jw-dot ${cls}`, y_align: Clutter.ActorAlign.CENTER});
            if (running)
                dot.ease({opacity: 70, duration: 900, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE, repeatCount: -1, autoReverse: true});
            const name = (a.title || a.config?.title || _('(untitled)')).replace(/\s+/g, ' ');
            const title = new St.Label({style_class: 'jw-sess-title', text: name, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            title.clutter_text.ellipsize = ELLIPSIZE_END;
            const t = (Date.parse(a.attentionTimestamp ?? a.lastActivityAt ?? a.updatedAt ?? 0) || 0) / 1000;
            const when = new St.Label({style_class: 'jw-sess-time', text: label ?? ago(t), y_align: Clutter.ActorAlign.CENTER});
            line.add_child(dot);
            if (a.provider && a.provider !== 'claude')
                line.add_child(new St.Label({style_class: 'jw-provider', text: a.provider, y_align: Clutter.ActorAlign.CENTER}));
            line.add_child(title);
            line.add_child(when);

            const row = new St.Button({style_class: 'jw-sess', child: line, x_expand: true, can_focus: true});
            row.connect('clicked', () => {
                if (!openPaseoAgent(a.id))
                    launch(paseoDesktop());
            });
            this._claudeList.add_child(row);
        }
        if (this._claudeList.get_n_children() === 0) {
            this._claudeList.add_child(new St.Label({style_class: 'jw-sess-time',
                text: paseoInstalled() ? _('No sessions (type > in the launcher)') : _('Paseo isn’t installed')}));
        }
        this._place();
    }
}
