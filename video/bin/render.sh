#!/usr/bin/env bash
# Renders one composition to out/<name>.mp4, with a contact sheet beside it
# (out/<name>-contact.png, six frames) to look at before watching.
#
# Usage: bin/render.sh <composition>
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/env.sh"

NAME="${1:?usage: bin/render.sh <composition>  (one of: $(ls "$VIDEO_DIR/compositions" | tr '\n' ' '))}"
DIR="$VIDEO_DIR/compositions/$NAME"
[ -d "$DIR" ] || { echo "No composition '$NAME'" >&2; exit 1; }
need_space 2 "a render" || exit 1
mkdir -p "$VIDEO_DIR/out"
OUT="$VIDEO_DIR/out/$NAME.mp4"

if [ -f "$DIR/render.sh" ]; then
  bash "$DIR/render.sh" "$OUT"
else
  node "$VIDEO_DIR/bin/stage.mjs" "$NAME"
  hyperframes check "$DIR"
  # PNG frame extraction: the footage is UI, where JPEG smears text.
  hyperframes render "$DIR" -q high -f 30 --video-frame-format=png -o "$OUT"
fi

DUR="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$OUT")"
SEL="$(node -e "const d=$DUR*30;console.log([.04,.2,.38,.56,.74,.95].map(p=>'eq(n\\\\,'+Math.floor(d*p)+')').join('+'))")"
"$FFMPEG" -y -loglevel error -i "$OUT" -vf "select='$SEL',scale=640:-1,tile=3x2" -vsync vfr -frames:v 1 "$VIDEO_DIR/out/$NAME-contact.png"
echo "out/$NAME.mp4 and out/$NAME-contact.png"
