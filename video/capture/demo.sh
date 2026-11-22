#!/usr/bin/env bash
# Records the real app while a demo group drives it, start to finish:
#
#   1. starts a throwaway backend and the web build (:3001, :5173, MCP :19432)
#      with their own data directory, so nothing touches your real data;
#   2. starts the recorder (capture/desktop.cjs);
#   3. runs `scripts/demo.ts --group=<group> --decide`, timestamping each line;
#   4. stops everything and encodes captures/<name>/raw.mp4 and scenes.json.
#
# Usage: capture/demo.sh <name> [--group=parallel] [--mode=hd|smooth] [--pace=slow|normal|fast] [--grant=terminal,…]
# CAPTURE_API_PORT, CAPTURE_WEB_PORT and CAPTURE_MCP_PORT move the capture's
# own app off :3001, :5173 and :19432, so it can record beside a running
# CodeTrellis instead of asking for it to be quit. CAPTURE_WIDTH, CAPTURE_HEIGHT
# and CAPTURE_SCALE size the window (capture/desktop.cjs).
# --grant: MCP capabilities the demo holds for the run (scripts/demo/grant.ts).
# The demo groups are listed by `npm run demo -- --list` in the repository root.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/../bin/env.sh"

need_space 3 "a capture" || exit 1
NAME="${1:?usage: capture/demo.sh <name> [--group=…] [--mode=hd|smooth] [--pace=…]}"; shift
GROUP=parallel MODE=hd PACE=slow GRANT="" SCENE=""
for a in "$@"; do
  case "$a" in
    --group=*) GROUP="${a#*=}" ;;
    --mode=*) MODE="${a#*=}" ;;
    --pace=*) PACE="${a#*=}" ;;
    --grant=*) GRANT="${a#*=}" ;;
    --scene=*) SCENE="${a#*=}" ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

OUT="$VIDEO_DIR/captures/$NAME"
API_PORT="${CAPTURE_API_PORT:-3001}" WEB_PORT="${CAPTURE_WEB_PORT:-5173}" MCP_PORT="${CAPTURE_MCP_PORT:-19432}"
WORK="$(mktemp -d)"
PIDS=()
REC=""
cleanup() {
  [ -n "$REC" ] && { touch "$OUT/stop" 2>/dev/null || true; wait "$REC" 2>/dev/null || true; }
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  # The backend writes its data directory as it shuts down: wait for it, or
  # rm races those writes and fails ("Directory not empty") after a good run.
  for p in "${PIDS[@]}"; do wait "$p" 2>/dev/null || true; done
  rm -rf "$WORK" || true
}
trap cleanup EXIT

# Vite on macOS listens on ::1 only, so check both families (and poll it as localhost below).
busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null; }
for port in "$API_PORT" "$WEB_PORT" "$MCP_PORT"; do
  if busy "$port"; then
    echo "Port $port is in use. Quit CodeTrellis (and any dev server) first, or set CAPTURE_API_PORT, CAPTURE_WEB_PORT and CAPTURE_MCP_PORT: the capture runs its own." >&2
    exit 1
  fi
done

# The same throwaway backend the browser suite uses (playwright.config.ts).
export CODETRELLIS_DATA_DIR="$WORK/data" CODETRELLIS_CLAUDE_DIR="$WORK/claude-home"
export CODETRELLIS_CAPABILITY_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
export NODE_ENV=test CODETRELLIS_ALLOW_HTTP_GRANTS=1
export CODETRELLIS_BACKEND_PORT="$API_PORT" CODETRELLIS_MCP_PORT="$MCP_PORT" CODETRELLIS_DEV_ORIGIN_PORT="$WEB_PORT"
export CAPTURE_API_PORT="$API_PORT" CAPTURE_WEB_PORT="$WEB_PORT"
export CODETRELLIS_OTA_URL=http://127.0.0.1:9 CODETRELLIS_GITHUB_API=http://127.0.0.1:9
export CODETRELLIS_RENDITION_ENGINE="$WORK/no-rendition-engine"
mkdir -p "$CODETRELLIS_DATA_DIR" "$CODETRELLIS_CLAUDE_DIR"
# Whoever approves on screen is "you", and the app takes your identity from
# git config: give the throwaway app a demo one, or the recording shows the
# real name and email of whoever ran the capture.
printf '[user]\n\tname = Alex Kim\n\temail = alex@acme.test\n' > "$WORK/gitconfig"
export GIT_CONFIG_GLOBAL="$WORK/gitconfig" GIT_CONFIG_NOSYSTEM=1

# The in-app terminal runs your shell: give it a plain prompt and no rc file,
# or a recording shows your user name, host and whatever your prompt prints.
mkdir -p "$WORK/zsh"
printf "PROMPT='%%F{244}%%1~%%f %%# '\nunsetopt PROMPT_SP\n" > "$WORK/zsh/.zshrc"
export SHELL=/bin/zsh ZDOTDIR="$WORK/zsh"
# A command run there is the CLI's, whoever started this capture: not "claude-code"
# because the capture happened to be started from a Claude Code session.
unset CLAUDECODE CODETRELLIS_AGENT
# Steps only a person can take in the window (open the Rules view, type a
# message) are asked of the recorder, which clicks and types in the real page
# (scripts/demo/lib/window.ts writes the request, capture/desktop.cjs acts).
export DEMO_UI_DIR="$OUT/ui"

cd "$REPO_DIR"
echo "Starting the app (logs in $WORK)…"
node --import tsx src/backend/index.ts > "$WORK/backend.log" 2>&1 & PIDS+=($!)
node node_modules/vite/bin/vite.js --config video/capture/vite.capture.config.ts > "$WORK/vite.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 120); do
  if curl -fs -o /dev/null -H "x-codetrellis-token: $CODETRELLIS_CAPABILITY_TOKEN" "http://127.0.0.1:$API_PORT/api/health" \
    && curl -fs -o /dev/null "http://localhost:$WEB_PORT/"; then break; fi
  [ "$i" = 120 ] && { echo "The app did not come up; see $WORK/backend.log" >&2; tail -20 "$WORK/backend.log" >&2; exit 1; }
  sleep 1
done

# A re-capture into the same folder must not see the last run's "ready":
# the demo would start before the window has loaded, and its own check
# refuses to run against a shell that is not there yet.
rm -f "$OUT/ready" "$OUT/stop"
rm -rf "$OUT/ui"
node "$VIDEO_DIR/capture/desktop.cjs" --out="$OUT" --mode="$MODE" --url="http://localhost:$WEB_PORT/" ${CAPTURE_WIDTH:+--width="$CAPTURE_WIDTH"} ${CAPTURE_HEIGHT:+--height="$CAPTURE_HEIGHT"} ${CAPTURE_SCALE:+--scale="$CAPTURE_SCALE"} & REC=$!
for i in $(seq 1 60); do [ -f "$OUT/ready" ] && break; sleep 1; done
sleep 2

echo "Recording: demo group '$GROUP', $PACE pace, $MODE capture"
status=0
npx tsx scripts/demo.ts $([ -n "$SCENE" ] && echo "--scene=$SCENE" || echo "--group=$GROUP") --data-dir="$CODETRELLIS_DATA_DIR" --decide --pace="$PACE" --port="$MCP_PORT" --api-port="$API_PORT" ${GRANT:+--grant="$GRANT"} 2>&1 \
  | perl -MTime::HiRes=time -ne '$|=1; printf "%.3f %s", time, $_' | tee "$OUT/demo.log" || status=$?
sleep 3
touch "$OUT/stop"; wait "$REC"; REC=""
[ "$status" = 0 ] || echo "The demo exited $status; the capture is kept, check demo.log." >&2

node "$VIDEO_DIR/capture/encode.cjs" "$OUT" $([ "$MODE" = hd ] && echo --blend)
echo "Done: captures/$NAME/raw.mp4 (scene times in scenes.json)"
