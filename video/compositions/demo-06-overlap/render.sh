#!/usr/bin/env bash
# One composition, generated from beats.mjs by talk/build.mjs.
# Usage (from bin/render.sh): render.sh <output.mp4>
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: render.sh <output.mp4>}"

node "$VIDEO_DIR/bin/stage.mjs" demo-06-overlap
node "$D/build.mjs"
hyperframes check "$D"
hyperframes render "$D" -q high -f 30 --video-frame-format=png -o "$OUT"
