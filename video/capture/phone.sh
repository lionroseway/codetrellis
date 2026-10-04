#!/usr/bin/env bash
# Records a real phone screen being answered (capture/phone.cjs) and encodes it.
# Starts the phone preview (tools/phone-preview, :5190) if it is not running.
#
# Usage: capture/phone.sh <fixture>   e.g. breakpoint -> capture/phone/breakpoint.json
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/../bin/env.sh"

FIX="${1:?usage: capture/phone.sh <fixture name in capture/phone/>}"
OUT="$VIDEO_DIR/captures/phone-$FIX"
PREVIEW=""
trap '[ -n "$PREVIEW" ] && kill "$PREVIEW" 2>/dev/null || true' EXIT

if ! curl -fs -o /dev/null http://localhost:5190/; then
  cd "$REPO_DIR"
  node node_modules/vite/bin/vite.js --config tools/phone-preview/vite.config.ts --port 5190 --strictPort > /dev/null 2>&1 & PREVIEW=$!
  for i in $(seq 1 90); do curl -fs -o /dev/null http://localhost:5190/ && break; sleep 1; done
fi

node "$VIDEO_DIR/capture/phone.cjs" --fixture="phone/$FIX.json" --out="$OUT"
node "$VIDEO_DIR/capture/encode.cjs" "$OUT"
echo "Done: captures/phone-$FIX/raw.mp4 (tap position and time in tap.json)"
