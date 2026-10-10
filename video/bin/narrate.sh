#!/usr/bin/env bash
# The narrated cut of a composition, from its beats' `vo` lines:
#
#   1. stage its footage, and write the lines to speak (build.mjs --lines);
#   2. speak them with the voices in audio/voices.json (cached per line);
#   3. build with beats stretched to hold their speech, and the mix spec
#      (build.mjs --audio -> audio.json), and render the picture, silent;
#   4. mix the audio, check it (timing, overlaps, loudness), and put it on
#      the picture: out/<name>-narrated.mp4.
#
# --remix skips the render: it re-speaks, re-mixes and puts the audio on the
# picture from the last narrate (out/<name>-narrated.picture.mp4), or on the
# silent cut (out/<name>.mp4) when no beat stretched. It refuses when the
# timing has changed since that picture was made. Rewording a line that still
# fits its beat takes seconds this way, not a render.
#
# The silent cut (npm run render <name>) is untouched by any of this.
# Usage: bin/narrate.sh <composition> [--remix]     (npm run narrate hero)
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/env.sh"

NAME="${1:?usage: bin/narrate.sh <composition> [--remix]}"
REMIX=""; [ "${2:-}" = "--remix" ] && REMIX=1
DIR="$VIDEO_DIR/compositions/$NAME"
[ -f "$DIR/build.mjs" ] || { echo "$NAME has no build.mjs to place its voiceover" >&2; exit 1; }
OUT="$VIDEO_DIR/out"
PICTURE="$OUT/$NAME-narrated.picture.mp4"
mkdir -p "$OUT"
[ -n "$REMIX" ] || need_space 2 "a narrated render" || exit 1

node "$VIDEO_DIR/bin/stage.mjs" "$NAME"
node "$DIR/build.mjs" --lines "$DIR/assets/vo/lines.json"
node "$VIDEO_DIR/audio/speak.mjs" "$DIR/assets/vo/lines.json" "$DIR/assets/vo"
node "$DIR/build.mjs" --audio
# Timing and overlaps before spending minutes on a render.
node "$VIDEO_DIR/audio/check.mjs" "$DIR/audio.json"
LENGTH="$(node -p "require('$DIR/audio.json').duration")"
STRETCHED="$(node -p "require('$DIR/audio.json').stretched.length")"

if [ -n "$REMIX" ]; then
  # The silent cut has the same picture when nothing stretched.
  [ -f "$PICTURE" ] || { [ "$STRETCHED" = 0 ] && [ -f "$OUT/$NAME.mp4" ] && PICTURE="$OUT/$NAME.mp4"; } || true
  if [ ! -f "$PICTURE" ]; then
    if [ "$STRETCHED" != 0 ]; then echo "$STRETCHED beat(s) now stretch to hold their speech, so the silent cut's picture no longer fits: run npm run narrate $NAME (no --remix), or shorten the line." >&2
    else echo "Nothing to remix onto: run npm run narrate $NAME first." >&2; fi
    exit 1
  fi
  HAVE="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$PICTURE")"
  node -e "process.exit(Math.abs($HAVE - $LENGTH) < 0.05 ? 0 : 1)" || {
    echo "$(basename "$PICTURE") is $HAVE s; the narrated cut is now $LENGTH s. The timing changed: run npm run narrate $NAME (no --remix)." >&2; exit 1; }
  echo "Remixing onto $(basename "$PICTURE") ($LENGTH s)"
else
  hyperframes check "$DIR"
  hyperframes render "$DIR" -q high -f 30 --video-frame-format=png ${HERO_WORKERS:+--workers="$HERO_WORKERS"} -o "$PICTURE"
fi
node "$VIDEO_DIR/audio/mix.mjs" "$DIR/audio.json" "$OUT/$NAME-narrated.wav"
node "$VIDEO_DIR/audio/check.mjs" "$DIR/audio.json" --rendered "$OUT/$NAME-narrated.wav"
node "$VIDEO_DIR/audio/mix.mjs" --mux "$PICTURE" "$OUT/$NAME-narrated.wav" "$OUT/$NAME-narrated.mp4"
# Credits for any library track whose licence asks for one (CC-BY): publish them with the video.
CREDITS="$(node "$VIDEO_DIR/audio/library.mjs" credits "$DIR/audio.json")"
if [ -n "$CREDITS" ]; then printf '%s\n' "$CREDITS" > "$OUT/$NAME-credits.txt"; echo "Credits to publish with it: out/$NAME-credits.txt"; else rm -f "$OUT/$NAME-credits.txt"; fi
# Leave index.html as the silent cut, which every other command expects.
node "$DIR/build.mjs" > /dev/null
[ "$STRETCHED" = 0 ] || echo "Note: $STRETCHED beat(s) stretched to hold their speech. A stretched beat shows its footage past the moment it was cut on: check them in npm run review $NAME -- --audio, or shorten the line."
echo "out/$NAME-narrated.mp4 (and $NAME-narrated.wav). Listen to it, and review it: npm run review $NAME -- --audio"
