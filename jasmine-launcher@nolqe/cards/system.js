// Jasmine Launcher: cards/system.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {readText, vbox, hbox, hexToRgb} from '../common.js';
import {_} from '../i18n.js';

const TEMP_SENSORS = ['k10temp', 'zenpower', 'coretemp', 'cpu_thermal', 'x86_pkg_temp', 'acpitz'];

export class SystemPart {
    // ---- System (CPU, RAM, GPU, temperature rings + battery/network/disk) ----
    _sysWatch() {
        this._sysPrev = null;
        this._tempPath = null;
        try {
            const found = new Map();
            const en = Gio.File.new_for_path('/sys/class/hwmon').enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let i;
            while ((i = en.next_file(null))) {
                const dir = `/sys/class/hwmon/${i.get_name()}`;
                const name = readText(`${dir}/name`);
                if (name && GLib.file_test(`${dir}/temp1_input`, GLib.FileTest.EXISTS))
                    found.set(name, `${dir}/temp1_input`);
            }
            en.close(null);
            for (const s of TEMP_SENSORS) {
                if (found.has(s)) {
                    this._tempPath = found.get(s);
                    break;
                }
            }
        } catch {}
        this._sysTick = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, Math.max(1, this._settings.get_int('system-interval')), () => {
            this._updateSystem();
            return GLib.SOURCE_CONTINUE;
        });
        // GPU 使用率: gpu_busy_percent はこの機種（Raven/Picasso）だと 0 か 100 に張り付くので使わない。
        // 代わりにシステムモニターや nvtop と同じく、各アプリの DRM の fdinfo にある drm-engine-gfx（GPU を使った累計時間）の増え方から出す。
        // どのファイルを読むかは 20 秒ごとに find で探す（非同期）。2 秒ごとの更新ではその数ファイルだけ読む。
        this._gpuFiles = [];
        this._gpuPrev = null;
        this._gpuScan();
        this._gpuScanTick = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
            if (this._column?.visible)
                this._gpuScan();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _sysUnwatch() {
        if (this._sysTick)
            GLib.source_remove(this._sysTick);
        this._sysTick = 0;
        if (this._gpuScanTick)
            GLib.source_remove(this._gpuScanTick);
        this._gpuScanTick = 0;
        this._gpuFiles = [];
    }

    _ring(name, size = 58) {
        const box = vbox('jw-ring-box');
        box.x_expand = true;
        const stack = new St.Widget({layout_manager: new Clutter.BinLayout(), width: size, height: size, x_align: Clutter.ActorAlign.CENTER});
        const area = new St.DrawingArea({width: size, height: size});
        const ring = {value: 0, area, label: null};
        area.connect('repaint', a => {
            const cr = a.get_context();
            const [w, h] = a.get_surface_size();
            const light = this._isLight();
            const r = Math.min(w, h) / 2 - Math.max(3, Math.round(size / 14));
            cr.setLineWidth(Math.max(3, Math.round(size / 12)));
            cr.setLineCap(1); // ROUND
            const track = light ? [0, 0, 0, 0.08] : [1, 1, 1, 0.10];
            cr.setSourceRGBA(...track);
            cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
            cr.stroke();
            const v = Math.max(0, Math.min(1, ring.value));
            if (v > 0.005) {
                const [cr8, cg8, cb8] = v > 0.85 ? [237, 51, 59] : v > 0.65 ? [255, 163, 72] : hexToRgb(this._accentHex());
                cr.setSourceRGBA(cr8 / 255, cg8 / 255, cb8 / 255, 1);
                cr.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + v * 2 * Math.PI);
                cr.stroke();
            }
            cr.$dispose();
        });
        ring.label = new St.Label({style_class: 'jw-ring-value', text: '–', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        stack.add_child(area);
        stack.add_child(ring.label);
        box.add_child(stack);
        box.add_child(new St.Label({style_class: 'jw-ring-name', text: name, x_align: Clutter.ActorAlign.CENTER}));
        ring.box = box;
        return ring;
    }

    _buildSystem() {
        const card = vbox('jw-card jw-claude');
        const status = null;
        const rings = {cpu: this._ring('CPU'), mem: this._ring(_('RAM')), gpu: this._ring('GPU'), temp: this._ring(_('Temp'))};
        const row = hbox('jw-ring-row');
        for (const r of Object.values(rings))
            row.add_child(r.box);
        // 下の行: 電池・通信量・ストレージ（線画のアイコン＋数字）
        const foot = hbox('jw-sys-foot');
        foot.x_align = Clutter.ActorAlign.CENTER;
        const item = icon => {
            const b = hbox('jw-sys-item');
            const i = new St.Icon({icon_name: icon, icon_size: 12, y_align: Clutter.ActorAlign.CENTER});
            const l = new St.Label({y_align: Clutter.ActorAlign.CENTER});
            b.add_child(i);
            b.add_child(l);
            foot.add_child(b);
            return {box: b, icon: i, label: l};
        };
        const footItems = {bat: item('battery-full-symbolic'), down: item('go-down-symbolic'), up: item('go-up-symbolic'),
            disk: item('drive-harddisk-symbolic')};
        card.add_child(row);
        card.add_child(foot);
        this._sys = {rings, status, foot, footItems};
        return card;
    }

    _gpuScan() {
        if (this._gpuScanning)
            return;
        this._gpuScanning = true;
        try {
            const proc = Gio.Subprocess.new(['sh', '-c', "find /proc/[0-9]*/fd -lname '/dev/dri/*' -printf '%h/%f\\n' 2>/dev/null"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (pr, res) => {
                this._gpuScanning = false;
                try {
                    const [, out] = pr.communicate_utf8_finish(res);
                    this._gpuFiles = (out || '').split('\n').filter(Boolean).map(l => l.replace(/\/fd\/(\d+)$/, '/fdinfo/$1'));
                } catch {}
            });
        } catch {
            this._gpuScanning = false;
        }
    }

    _gpuRead(now) {
        if (!this._gpuFiles?.length)
            return undefined;
        // 同じクライアントを複数の fd で開いていることがあるので drm-client-id でまとめる
        const cur = new Map();
        for (const f of this._gpuFiles) {
            const t = readText(f);
            const ns = t.match(/^drm-engine-gfx:\s+(\d+)/m);
            if (!ns)
                continue;
            const id = (t.match(/^drm-pdev:\s+(\S+)/m)?.[1] ?? '') + '/' + (t.match(/^drm-client-id:\s+(\d+)/m)?.[1] ?? f);
            cur.set(id, Number(ns[1]));
        }
        const prev = this._gpuPrev;
        this._gpuPrev = {cur, now};
        if (!prev || cur.size === 0)
            return undefined;
        const dt = Math.max(0.5, now - prev.now);
        let busy = 0;
        for (const [id, v] of cur) {
            const p = prev.cur.get(id);
            if (p !== undefined && v > p)
                busy += v - p;
        }
        return Math.min(1, busy / (dt * 1e9));
    }

    _readSys() {
        const out = {};
        // CPU: /proc/stat の差分
        const cpu = readText('/proc/stat').split('\n')[0].split(/\s+/).slice(1).map(Number);
        const idle = (cpu[3] ?? 0) + (cpu[4] ?? 0);
        const total = cpu.reduce((a, b) => a + (b || 0), 0);
        // 通信量: lo 以外の合計
        let rx = 0, tx = 0;
        for (const line of readText('/proc/net/dev').split('\n').slice(2)) {
            const [ifc, rest] = line.split(':');
            if (!rest || ifc.trim() === 'lo')
                continue;
            const f = rest.trim().split(/\s+/).map(Number);
            rx += f[0] || 0;
            tx += f[8] || 0;
        }
        const now = GLib.get_monotonic_time() / 1e6;
        const prev = this._sysPrev;
        this._sysPrev = {idle, total, rx, tx, now};
        if (prev) {
            const dt = Math.max(0.5, now - prev.now);
            out.cpu = total > prev.total ? 1 - (idle - prev.idle) / (total - prev.total) : 0;
            out.down = Math.max(0, (rx - prev.rx) / dt);
            out.up = Math.max(0, (tx - prev.tx) / dt);
        }
        // メモリ
        const mi = Object.fromEntries(readText('/proc/meminfo').split('\n').map(l => l.split(/:\s+/)).filter(a => a.length === 2)
            .map(([k, v]) => [k, parseInt(v)]));
        if (mi.MemTotal)
            out.mem = 1 - (mi.MemAvailable ?? 0) / mi.MemTotal;
        out.memText = mi.MemTotal ? `${((mi.MemTotal - (mi.MemAvailable ?? 0)) / 1048576).toFixed(1)}G` : '';
        const g = this._gpuRead(now);
        if (g !== undefined)
            out.gpu = g;
        if (this._tempPath)
            out.temp = parseInt(readText(this._tempPath)) / 1000;
        // 電池
        const bat = ['BAT0', 'BAT1'].map(b => `/sys/class/power_supply/${b}`).find(d => GLib.file_test(d, GLib.FileTest.IS_DIR));
        if (bat) {
            out.bat = parseInt(readText(`${bat}/capacity`));
            out.batStatus = readText(`${bat}/status`);
        }
        // ストレージ（30 秒ごと）
        if (!this._diskAt || now - this._diskAt > 30) {
            try {
                const fi = Gio.File.new_for_path('/').query_filesystem_info('filesystem::size,filesystem::free', null);
                const size = fi.get_attribute_uint64('filesystem::size');
                this._disk = size ? 1 - fi.get_attribute_uint64('filesystem::free') / size : null;
            } catch {}
            this._diskAt = now;
        }
        out.disk = this._disk;
        return out;
    }

    _updateSystem() {
        if (!this._sys || !this._column?.visible)
            return;
        const d = this._readSys();
        const rate = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB/s` : `${Math.round(b / 1024)}KB/s`;
        const set = (k, v, text) => {
            const r = this._sys.rings[k];
            if (v === undefined || v === null || Number.isNaN(v)) {
                r.label.text = '–';
                return;
            }
            r.value = v;
            r.label.text = text;
            r.area.queue_repaint();
        };
        set('cpu', d.cpu, d.cpu === undefined ? '–' : `${Math.round(d.cpu * 100)}%`);
        set('mem', d.mem, d.memText);
        set('gpu', d.gpu, d.gpu === undefined ? '–' : `${Math.round(d.gpu * 100)}%`);
        // 温度は 30〜95℃ をリングの 0〜100% に
        set('temp', d.temp === undefined ? undefined : (d.temp - 30) / 65, d.temp === undefined ? '–' : `${Math.round(d.temp)}°`);
        const st = {Charging: _('Charging'), Discharging: _('Battery'), Full: _('Full'), 'Not charging': _('Not charging')}[d.batStatus] ?? '';
        const fi = this._sys.footItems;
        fi.bat.box.visible = d.bat !== undefined;
        if (d.bat !== undefined) {
            const lv = Math.min(100, Math.round(d.bat / 10) * 10);
            const charging = d.batStatus === 'Charging' || d.batStatus === 'Full' || d.batStatus === 'Not charging';
            // 100% だけ名前が違う（charged）
            fi.bat.icon.icon_name = lv === 100 ? (charging ? 'battery-level-100-charged-symbolic' : 'battery-level-100-symbolic')
                : `battery-level-${lv}${charging ? '-charging' : ''}-symbolic`;
            fi.bat.label.text = `${d.bat}%`;
        }
        fi.down.box.visible = fi.up.box.visible = d.down !== undefined;
        if (d.down !== undefined) {
            fi.down.label.text = rate(d.down);
            fi.up.label.text = rate(d.up);
        }
        fi.disk.box.visible = d.disk !== null && d.disk !== undefined;
        if (fi.disk.box.visible)
            fi.disk.label.text = `${Math.round(d.disk * 100)}%`;
    }
}
