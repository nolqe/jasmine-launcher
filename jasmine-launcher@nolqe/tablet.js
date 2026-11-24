// タブレットモード（上のバーのボタンで手動オン・オフ）
// この機種（IdeaPad C340-14API）はタブレットモードのスイッチが Linux に出てこないため、GNOME が自分では
// 自動回転・画面キーボードを使わない。そこでボタン 1 つで次をまとめて切り替える:
//   オン:  傾きセンサー（iio-sensor-proxy）に合わせて内蔵ディスプレイを自動回転、画面キーボードを有効
//   オフ:  回転を元（通常の向き）に戻し、画面キーボードの設定を元の値に戻す
// キーボードとタッチパッドは、折り返すと本体側で自動的に止まるので触らない
// 元の値は設定キー tablet-saved に保存しておき、途中でシェルが落ちても次の起動時に戻す。
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_} from './i18n.js';

const TRANSFORM = {'normal': 0, 'left-up': 1, 'bottom-up': 2, 'right-up': 3};
const A11Y = 'org.gnome.desktop.a11y.applications';
const TOUCHPAD = 'org.gnome.desktop.peripherals.touchpad';

export class TabletMode {
    constructor(settings, onChange) {
        this._settings = settings;
        this._onChange = onChange;
        this._a11y = new Gio.Settings({schema_id: A11Y});
        this._touchpad = new Gio.Settings({schema_id: TOUCHPAD});
        this._active = false;
        this._sensor = null;
        this._cancel = new Gio.Cancellable();
        // 前回オンのまま終わっていたら（シェルの再起動・クラッシュ）、設定を元に戻しておく
        this._restoreSaved();
        // 画面ロックで拡張が止まって戻ってきたときなどは、オンの状態を引き継ぐ（キー tablet-on）
        if (this._settings.get_boolean('tablet-on'))
            this.enable();
    }

    get active() {
        return this._active;
    }

    toggle() {
        if (this._active)
            this.disable();
        else
            this.enable();
        this._settings.set_boolean('tablet-on', this._active);
    }

    enable() {
        if (this._active)
            return;
        this._active = true;
        if (!this._settings.get_string('tablet-saved')) {
            this._settings.set_string('tablet-saved', JSON.stringify({
                osk: this._a11y.get_boolean('screen-keyboard-enabled'),
            }));
        }
        // Jasmine のフローティングキーボードを使うときは GNOME の画面キーボードは止めておく（二重に出ないように）
        this._a11y.set_boolean('screen-keyboard-enabled', !this._settings.get_boolean('osk-enabled'));
        this._claimSensor();
        this._onChange?.(true);
    }

    disable() {
        if (!this._active)
            return;
        this._active = false;
        this._releaseSensor();
        this._rotate(0);
        this._restoreSaved();
        this._onChange?.(false);
    }

    // forLock: 画面ロックで拡張が止まるとき。向きは今のまま（回転を戻さない）、ロック画面で指でパスワードを打てるよう
    // GNOME の画面キーボードをオンにする。元の設定（tablet-saved）は残しておき、ロック解除後の起動で
    // いったん元に戻してから、タブレットモードを入れ直す（constructor の _restoreSaved → enable）
    destroy(forLock = false) {
        if (forLock && this._active) {
            this._active = false;
            this._releaseSensor();
            this._a11y.set_boolean('screen-keyboard-enabled', true);
        } else {
            this.disable();
        }
        this._cancel.cancel();
        this._onChange = null;
    }

    _restoreSaved() {
        const raw = this._settings.get_string('tablet-saved');
        if (!raw)
            return;
        try {
            const s = JSON.parse(raw);
            if (typeof s.osk === 'boolean')
                this._a11y.set_boolean('screen-keyboard-enabled', s.osk);
            if (typeof s.touchpad === 'string' && s.touchpad)
                this._touchpad.set_string('send-events', s.touchpad);
        } catch (e) {
            logError(e, 'jasmine-launcher: tablet restore');
        }
        this._settings.set_string('tablet-saved', '');
    }

    // ---- 傾きセンサー ----
    _claimSensor() {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            'net.hadess.SensorProxy', '/net/hadess/SensorProxy', 'net.hadess.SensorProxy', this._cancel, (_o, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    logError(e, 'jasmine-launcher: sensor proxy');
                    return;
                }
                if (!this._active)
                    return;
                if (!proxy.get_cached_property('HasAccelerometer')?.unpack()) {
                    Main.notify(_('Tablet mode'), _('No accelerometer found — auto-rotate is unavailable'));
                    return;
                }
                this._sensor = proxy;
                this._sensorId = proxy.connect('g-properties-changed', () => this._follow());
                proxy.call('ClaimAccelerometer', null, Gio.DBusCallFlags.NONE, -1, this._cancel, (p, r) => {
                    try {
                        p.call_finish(r);
                    } catch (e) {
                        logError(e, 'jasmine-launcher: claim accelerometer');
                    }
                    this._follow();
                });
            });
    }

    _releaseSensor() {
        const p = this._sensor;
        this._sensor = null;
        if (!p)
            return;
        if (this._sensorId)
            p.disconnect(this._sensorId);
        this._sensorId = 0;
        p.call('ReleaseAccelerometer', null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    _follow() {
        if (!this._active || !this._sensor)
            return;
        const o = this._sensor.get_cached_property('AccelerometerOrientation')?.unpack();
        if (o in TRANSFORM)
            this._rotate(TRANSFORM[o]);
    }

    // ---- 内蔵ディスプレイの回転（GNOME の画面設定 org.gnome.Mutter.DisplayConfig を使う。一時的な設定として適用） ----
    _rotate(transform) {
        const call = (method, params, type, cb) => Gio.DBus.session.call('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig', method, params, type ? new GLib.VariantType(type) : null, Gio.DBusCallFlags.NONE, -1, null,
            (c, r) => {
                try {
                    cb?.(c.call_finish(r));
                } catch (e) {
                    logError(e, `jasmine-launcher: ${method}`);
                }
            });
        call('GetCurrentState', null, '(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})', res => {
            const [serial, monitors, logical] = res.deep_unpack();
            const current = {};
            let builtin = null;
            for (const [[connector], modes, props] of monitors) {
                const mode = modes.find(m => m[6]['is-current']?.unpack());
                if (mode)
                    current[connector] = mode[0];
                if (props['is-builtin']?.unpack())
                    builtin = connector;
            }
            if (!builtin)
                return;
            let changed = false;
            const config = logical.map(([x, y, scale, tr, primary, mons]) => {
                const mine = mons.some(m => m[0] === builtin);
                if (mine && tr !== transform)
                    changed = true;
                return [x, y, scale, mine ? transform : tr, primary, mons.filter(m => current[m[0]]).map(m => [m[0], current[m[0]], {}])];
            });
            if (!changed)
                return;
            // method 1 = 一時的（保存しない）。再ログインで元に戻る
            call('ApplyMonitorsConfig', new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [serial, 1, config, {}]), null, null);
        });
    }
}
