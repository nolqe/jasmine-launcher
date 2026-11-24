#!/usr/bin/env bash
set -euo pipefail

UUID="jasmine-launcher@nolqe"
SRC_DIR="$(cd "$(dirname "$0")/$UUID" && pwd)"
DEST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

echo "Compiling GSettings schema..."
glib-compile-schemas "$SRC_DIR/schemas"

echo "Installing $UUID to $DEST_DIR..."
mkdir -p "$DEST_DIR/cards" "$DEST_DIR/features" "$DEST_DIR/schemas"

# Copy via temporary files and atomic rename so replacing files (especially
# schemas/gschemas.compiled) never crashes a running GNOME Shell session.
while IFS= read -r -d '' file; do
  rel="${file#"$SRC_DIR/"}"
  target="$DEST_DIR/$rel"
  mkdir -p "$(dirname "$target")"
  cp "$file" "$target.new"
  mv -f "$target.new" "$target"
done < <(find "$SRC_DIR" -type f -print0)

echo "Installed successfully."
echo "Log out and log back in, then run: gnome-extensions enable $UUID"
