#!/usr/bin/env bash
# The talk's demo videos, from nothing: record, render, export. Run it again
# after any change to the app or to a demo and the videos are the new ones.
#
#   bash talk/record.sh                 everything (about fifteen minutes)
#   bash talk/record.sh demo-03-rules   re-render and re-export one, from the footage there is
#   bash talk/record.sh --record        record again first (desktop and phone)
#
# The sample repository is built fresh by each recording
# (scripts/demo/fixtures/prefs-api.ts, into a temp folder that the demo
# removes), so there is nothing to reset by hand: a recording starts from the
# first commit every time.
#
# It records beside a running CodeTrellis: the capture's own app is on the
# ports below, with its own data directory.
set -euo pipefail
cd "$(dirname "$0")/.."
. bin/env.sh

ALL=(demo-01-plan demo-02-build demo-03-rules demo-04-review demo-05-epic demo-06-overlap demo-07-breakpoint)
RECORD=0; PICK=()
for a in "$@"; do case "$a" in --record) RECORD=1 ;; *) PICK+=("$a") ;; esac; done
[ ${#PICK[@]} -eq 0 ] && PICK=("${ALL[@]}")

export CAPTURE_API_PORT="${CAPTURE_API_PORT:-3411}" CAPTURE_WEB_PORT="${CAPTURE_WEB_PORT:-5273}" CAPTURE_MCP_PORT="${CAPTURE_MCP_PORT:-19532}"
# Part 1 (one agent: demos 01-04) and part 2 (a team: demos 05-07) are two recordings.
for cap in "talk-hd talk" "talk-team-hd talk-team"; do
  set -- $cap
  if [ "$RECORD" = 1 ] || [ ! -f "captures/$1/raw.mp4" ]; then
    # caffeinate: a Mac that sleeps mid-capture records a frozen window.
    CAPTURE_WIDTH=1440 CAPTURE_HEIGHT=810 CAPTURE_SCALE=2 caffeinate -dimsu \
      bash capture/demo.sh "$1" --group="$2" --mode=hd --pace=normal --grant=terminal
    grep -q 'Nothing looked wrong' "captures/$1/demo.log" || { echo "The demo flagged something (captures/$1/demo.log): look before rendering." >&2; exit 1; }
  fi
done
if [ "$RECORD" = 1 ] || [ ! -f captures/phone-talk-steer/raw.mp4 ]; then bash capture/phone.sh talk-steer; fi
# Demo 03's CI beat is recorded apart, because it pushes to GitHub: bash talk/ci.sh
[ -f captures/ci-pass-hd/raw.mp4 ] || echo "No CI footage yet (captures/ci-*-hd): run 'bash talk/ci.sh' before rendering demo-03-rules." >&2

for c in "${PICK[@]}"; do
  caffeinate -dimsu bash bin/render.sh "$c"
  node bin/review.mjs "$c" > /dev/null
done
node talk/export.mjs
echo "out/talk/ has the videos and stills. Look at out/<name>-review/ : each frame beside its words in beats.txt."
