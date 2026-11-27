#!/usr/bin/env bash
# One-click web build (macOS / Linux). Same behaviour as build-web.bat.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "[Count War] Node.js 18+ required"; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund
node tools/posterize-assets.js || true
[ -f assets/sfx/ui_click.wav ] || node tools/gen-audio.js
node tools/build-web.js
echo
echo "Output:"
echo "  dist/count-war-web/         upload this folder to your host (pipygames.com)"
echo "  dist/count-war-single.html  one portable file"
