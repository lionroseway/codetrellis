#!/usr/bin/env bash
# The Remotion version of the hero (React). It has its own dependencies, so
# its licence stays contained here: Remotion is free for individuals and
# companies of up to three people, and needs a company licence above that.
#
# Usage (from bin/render.sh): render.sh <output.mp4>
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: render.sh <output.mp4>}"
cd "$D"
[ -d node_modules/remotion ] || npm ci --no-audit --no-fund
export REMOTION_DISABLE_TELEMETRY=1
npx remotion render src/index.ts Hero "$OUT" --codec=h264 --crf=16 --pixel-format=yuv420p --color-space=bt709 \
  ${HYPERFRAMES_BROWSER_PATH:+--browser-executable="$HYPERFRAMES_BROWSER_PATH"} --log=info
