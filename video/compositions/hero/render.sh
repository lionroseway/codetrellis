#!/usr/bin/env bash
# The hero is several acts (acts/act-0.html …), generated from beats.mjs. This
# builds them, renders each, and joins them with a short dissolve, so one act
# can be re-cut without rendering the others again (ACTS="act-2" render.sh).
#
# Usage (from bin/render.sh): render.sh <output.mp4>
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: render.sh <output.mp4>}"
PARTS="$(dirname "$OUT")/hero-acts"
mkdir -p "$PARTS"

node "$VIDEO_DIR/bin/stage.mjs" hero
node "$D/build.mjs"
ALL="$(cd "$D/acts" && ls act-*.html | sed 's/\.html$//' | sort -V)"
for act in ${ACTS:-$ALL}; do
  # A project has one root composition, index.html: each act takes it in turn.
  cp "$D/acts/$act.html" "$D/index.html"
  hyperframes check "$D"
  hyperframes render "$D" -q high -f 30 --video-frame-format=png \
    ${HERO_WORKERS:+--workers="$HERO_WORKERS"} -o "$PARTS/$act.mp4"
done

# Join every act that has been rendered, each dipping briefly through the
# page colour into the next (the npm ffmpeg build has no xfade).
D_FADE=0.25
set -- $(for a in $ALL; do [ -f "$PARTS/$a.mp4" ] && echo "$PARTS/$a.mp4"; done)
if [ $# -eq 1 ]; then cp "$1" "$OUT"; exit 0; fi
INPUTS=(); FILTER=""; LABELS=""; i=0
for f in "$@"; do
  INPUTS+=(-i "$f")
  DUR="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$f")"
  OUTST="$(node -e "console.log(($DUR - $D_FADE).toFixed(3))")"
  FX="null"
  [ $i -gt 0 ] && FX="fade=t=in:st=0:d=$D_FADE:color=0xf6f8fc"
  [ $i -lt $(($# - 1)) ] && FX="$FX,fade=t=out:st=$OUTST:d=$D_FADE:color=0xf6f8fc"
  FILTER+="[$i:v]$FX,setsar=1[a$i];"; LABELS+="[a$i]"; i=$((i + 1))
done
FILTER+="${LABELS}concat=n=$#:v=1:a=0[v]"
"$FFMPEG" -y -loglevel error "${INPUTS[@]}" -filter_complex "$FILTER" -map "[v]" \
  -c:v libx264 -crf 16 -preset medium -pix_fmt yuv420p -movflags +faststart "$OUT"
