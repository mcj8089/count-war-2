#!/usr/bin/env bash
# One-click local play (macOS / Linux). Same behaviour as start-game.bat.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "[Count War] Node.js 18+ required"; exit 1; }

if [ ! -f vendor/three/three.module.js ]; then
  if [ -f node_modules/three/build/three.module.js ]; then
    mkdir -p vendor/three && cp node_modules/three/build/three.module.js vendor/three/
  else
    echo "[Count War] installing dependencies (one time)..."
    npm install --no-audit --no-fund
  fi
fi
[ -f assets/sfx/ui_click.wav ] || node tools/gen-audio.js

PORT="${PORT:-5173}"
echo "[Count War] english  http://localhost:${PORT}/?lang=en"
echo "[Count War] 中文      http://localhost:${PORT}/?lang=zh"
exec node tools/serve.js --port "${PORT}"
