#!/usr/bin/env bash
# HyperFrames' own check (lint, runtime, layout, motion, contrast) on every
# HTML composition. Run it after any change, before a render.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/env.sh"
for c in ${@:-collision real-footage real-ui-hero}; do
  echo "── $c"
  hyperframes check "$VIDEO_DIR/compositions/$c"
done
