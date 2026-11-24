// Jasmine Launcher: cards/music.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import {ART_DIR, ART_KEEP, launch, vbox, hbox, iconButton, textBlock} from '../common.js';

export class MusicPart {
    // ---- Music (MPRIS) ----
    _buildMusic() {
        const card = vbox('jw-card jw-music');
        const top = hbox('jw-row jw-music-row');
        const size = this._settings.get_int('music-art-size');
        this._art = new St.Bin({
            style_class: 'jw-art',
            width: size,
            height: size,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: Math.round(size * 0.5)}),
        });
        const {box, t, s} = textBlock('Music', '');
        this._musicTitle = t;
        this._musicArtist = s;
        const controls = hbox('jw-controls');
        controls.y_align = Clutter.ActorAlign.CENTER;
        this._playBtn = iconButton('media-playback-start-symbolic', () => {
            if (this._player()) {
                this._call('PlayPause');
            } else {
                const app = this._settings.get_string('music-app').trim();
                if (app)
                    launch(app);
            }
        }, 'jw-main');
        controls.add_child(iconButton('media-skip-backward-symbolic', () => this._call('Previous'), 'jw-icon-small'));
        controls.add_child(this._playBtn);
        controls.add_child(iconButton('media-skip-forward-symbolic', () => this._call('Next'), 'jw-icon-small'));
        top.add_child(this._art);
        top.add_child(box);
        top.add_child(controls);

        // 再生位置（取れないプレーヤーでは隠す）
        this._progTrack = new St.Widget({style_class: 'jw-progress', x_expand: true, layout_manager: new Clutter.FixedLayout()});
        this._progFill = new St.Widget({style_class: 'jw-progress-fill', width: 0});
        this._progTrack.add_child(this._progFill);
        this._progTrack.visible = false;

        card.add_child(top);
        card.add_child(this._progTrack);
        if (!this._progTick) {
            this._progTick = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => {
                this._updateProgress();
                return GLib.SOURCE_CONTINUE;
            });
        }
        return card;
    }

    _updateProgress() {
        const p = this._player();
        if (!this._progTrack)
            return;
        const playing = p?.get_cached_property('PlaybackStatus')?.unpack() === 'Playing';
        let md = {};
        try {
            md = p?.get_cached_property('Metadata')?.recursiveUnpack() ?? {};
        } catch {}
        const len = Number(md['mpris:length'] ?? 0);
        if (!p || !len || !this._column?.visible) {
            this._progTrack.visible = !!(p && len);
            return;
        }
        if (!playing && this._progTrack.visible)
            return; // 一時停止中は止めたまま
        p.get_connection().call(p.get_name(), '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, 500, null,
            (c, res) => {
                try {
                    const pos = Number(c.call_finish(res).deepUnpack()[0].deepUnpack());
                    if (!this._progTrack)
                        return;
                    this._progTrack.visible = true;
                    const w = this._progTrack.width;
                    this._progFill.width = Math.max(0, Math.min(w, Math.round(w * pos / len)));
                } catch {
                    if (this._progTrack)
                        this._progTrack.visible = false;
                }
            });
    }

    _player() {
        return this._mpris?.current(this._settings?.get_boolean('music-any-player'));
    }

    _mprisDesktop() {
        return this._mpris?.desktop(this._settings?.get_boolean('music-any-player')) ?? '';
    }

    _call(method) {
        this._player()?.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    _updateMusic() {
        if (!this._musicTitle)
            return;
        const p = this._player();
        if (!p) {
            this._musicTitle.text = 'Music';
            this._musicArtist.text = '';
            this._musicArtist.visible = false;
            this._playBtn.child.icon_name = 'media-playback-start-symbolic';
            this._setArt(null);
            return;
        }
        let md = {};
        try {
            md = p.get_cached_property('Metadata')?.recursiveUnpack() ?? {};
        } catch {}
        const status = p.get_cached_property('PlaybackStatus')?.unpack();
        this._musicTitle.text = md['xesam:title'] || 'Music';
        const artist = md['xesam:artist'];
        this._musicArtist.text = (Array.isArray(artist) ? artist.join(', ') : artist) || '';
        this._musicArtist.visible = !!this._musicArtist.text;
        this._playBtn.child.icon_name = status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._setArt(md['mpris:artUrl'] || null);
    }

    // ジャケットは正方形に切り抜いて表示（動画の 16:9 サムネイルも潰さない）。
    // Cache remote https artwork in ~/.cache/jasmine-launcher/art/ and render square-cropped.
    _showArt(path) {
        if (!this._art)
            return;
        this._art.child.visible = !path;
        this._art.style = path
            ? `background-image: url("${GLib.filename_to_uri(path, null)}"); background-size: cover;`
            : '';
    }

    _setArt(url) {
        if (!this._art)
            return;
        if (url === this._artUrl) {
            this._showArt(this._artPath);
            return;
        }
        this._artUrl = url;
        this._artPath = null;
        this._showArt(null);
        if (!url)
            return;
        if (url.startsWith('file://')) {
            this._artPath = Gio.File.new_for_uri(url).get_path();
            this._showArt(this._artPath);
            return;
        }
        if (!url.startsWith('https://') || !this._soup)
            return;
        const path = GLib.build_filenamev([ART_DIR, GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)]);
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            this._artPath = path;
            this._showArt(path);
            return;
        }
        const msg = Soup.Message.new('GET', url);
        if (!msg)
            return;
        this._soup.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancel, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                if (msg.get_status() !== 200 || url !== this._artUrl)
                    return;
                GLib.mkdir_with_parents(ART_DIR, 0o700);
                GLib.file_set_contents(path, bytes.get_data());
                this._pruneArt();
                this._artPath = path;
                this._showArt(path);
            } catch {
                // 取得失敗・キャンセル時は既定アイコンのまま
            }
        });
    }

    // 古いジャケット画像を消して ART_KEEP 枚だけ残す
    _pruneArt() {
        try {
            const en = Gio.File.new_for_path(ART_DIR).enumerate_children('standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
            const files = [];
            let info;
            while ((info = en.next_file(null)))
                files.push([info.get_name(), info.get_attribute_uint64('time::modified')]);
            en.close(null);
            files.sort((a, b) => b[1] - a[1]);
            for (const [name] of files.slice(ART_KEEP))
                GLib.unlink(GLib.build_filenamev([ART_DIR, name]));
        } catch {}
    }
}
