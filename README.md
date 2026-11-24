# Jasmine Launcher

A minimal desktop hub and launcher extension for **GNOME Shell 51 (Wayland)**.

Combines draggable desktop cards, a `Super+F` popup launcher, a multi-pane embedded Web Panel, a `Super+W` bring-to-front overlay, a 3-finger minimize touchpad gesture, a manual tablet mode with auto-rotation, and a floating touch keyboard — built exclusively with native GNOME technologies (**GJS, St/Clutter, GTK4/libadwaita, and WebKitGTK 6.0**).

## Features

- **Popup & Card Launcher (`Super+F`)**: Search apps, calculate math expressions (Enter copies to clipboard), trigger power actions (Lock / Suspend / Log out / Restart / Power off), search the web (`? query`) in your default browser, start AI sessions (`> prompt`, Paseo / Claude Code), or quick-send text via clipboard (`@ text` to any configured `.desktop` app).
- **Desktop Cards**: Freely draggable with mouse or touch, snapping to screen corners or adjacent cards, plus Dark / Light / Follow GNOME / custom color themes.
  - **Launcher**: Inline search bar card.
  - **Music**: MPRIS media controller with square-cropped artwork cache and progress bar.
  - **System**: Live CPU, RAM, GPU (`drm-engine-gfx`), and CPU temperature rings (`k10temp` / `coretemp` / `acpitz`), plus battery, network throughput, and disk usage.
  - **Clean RAM**: Compact one-click button that quits windowless background apps (keeping minimized apps and your allowlist), reloads Web Panel panes, and displays freed memory.
  - **Web Panel**: 1–3 side-by-side frameless WebKitGTK 6.0 panes anchored to the desktop layer (or brought to front in Overlay mode), with an auto-hiding capsule toolbar (mouse hover or top-edge touch), shared site bookmarks, size presets (`S/M/L/XL`), and memory pressure limits.
  - **Parsec** *(optional, off by default)*: Lists online Parsec hosts and launches connections directly (session token stored securely in GNOME Keyring via `libsecret`).
  - **Paseo** *(optional, off by default)*: Monitors active [Paseo](https://paseo.sh/) AI agent sessions from `~/.paseo/agents/` and jumps directly into a session on click.
- **Bring-to-Front Overlay (`Super+W`)**: Temporarily lifts cards and Web Panel panes above active windows without hiding your workspace.
- **Three-Finger Swipe Down**: Minimizes the focused window from the touchpad outside the overview.
- **Tablet Mode & Floating Keyboard**: Top-bar toggle for 2-in-1 laptops without hardware tablet-mode switches — enables `iio-sensor-proxy` auto-rotation (preserving orientation and switching to GNOME OSK on the lock screen) and a draggable floating touch keyboard (bottom-edge swipe up to toggle, `S/M/L/XL`, `Esc/Tab/Ctrl/Arrows/Copy/Paste`, IME key, full IBus support).
- **Bilingual UI**: Automatic English / Japanese switching (`auto` / `en` / `ja`) in Preferences.

## Requirements

- **GNOME Shell 51** (Wayland)
- **WebKitGTK 6.0** & **libadwaita** (for the Web Panel)
- **iio-sensor-proxy** *(optional, for tablet auto-rotation)*
- **libsecret** (`secret-tool`, *optional, for signing out of the Parsec card*)

## Installation

```bash
git clone https://github.com/nolqe/jasmine-launcher.git
cd jasmine-launcher
./install.sh
```

Log out and log back in (required on Wayland for GNOME Shell to discover a newly installed extension), then enable **Jasmine Launcher** in **Extension Manager** or via:

```bash
gnome-extensions enable jasmine-launcher@nolqe
```

### Uninstall

```bash
gnome-extensions disable jasmine-launcher@nolqe
rm -rf ~/.local/share/gnome-shell/extensions/jasmine-launcher@nolqe
```

## Privacy & Network Access

Jasmine Launcher makes **no telemetry or background analytics calls**. Network requests occur only when explicitly used:
- **Music card**: Downloads remote album artwork URLs (`https://`) provided by your active MPRIS player.
- **Web Panel**: Connects only to the websites you add and currently view.
- **Parsec card** *(disabled by default)*: Communicates with the official Parsec API only when you sign in, open the card on startup, or click refresh. Credentials are never stored; only the session token is saved in GNOME Keyring.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
