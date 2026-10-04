#!/usr/bin/env bash
# The hero is one composition, generated from beats.mjs by build.mjs: one
# window that glides between layouts, so it renders in a single pass.
#
# Usage (from bin/render.sh): render.sh <output.mp4>
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: render.sh <output.mp4>}"

node "$VIDEO_DIR/bin/stage.mjs" hero
node "$D/build.mjs"
hyperframes check "$D"
hyperframes render "$D" -q high -f 30 --video-frame-format=png ${HERO_WORKERS:+--workers="$HERO_WORKERS"} -o "$OUT"
