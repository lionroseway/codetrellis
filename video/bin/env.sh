# Sourced by every script here: where the tools are, and nothing phones home.
#
# FFmpeg and FFprobe come from npm (@ffmpeg-installer), so nothing needs a
# system install. Chromium is whatever is already on the machine: a cloud
# session's /opt/pw-browsers, or the repository's own Playwright browsers,
# or VIDEO_CHROMIUM / HYPERFRAMES_BROWSER_PATH if you set them.

VIDEO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$VIDEO_DIR/.." && pwd)"
export VIDEO_DIR REPO_DIR

if [ ! -d "$VIDEO_DIR/node_modules/hyperframes" ]; then
  echo "video/: run 'npm install && npm run setup' in video/ first." >&2
  return 1 2>/dev/null || exit 1
fi

FFMPEG="$(cd "$VIDEO_DIR" && node -p "require('@ffmpeg-installer/ffmpeg').path")"
FFPROBE="$(cd "$VIDEO_DIR" && node -p "require('@ffprobe-installer/ffprobe').path")"
export FFMPEG FFPROBE
export PATH="$(dirname "$FFMPEG"):$(dirname "$FFPROBE"):$VIDEO_DIR/node_modules/.bin:$PATH"
export HYPERFRAMES_FFMPEG_PATH="$FFMPEG" HYPERFRAMES_FFPROBE_PATH="$FFPROBE"

# HyperFrames' CLI has telemetry, update checks and installers; Remotion has
# none of the first but honours DO_NOT_TRACK too.
export DO_NOT_TRACK=1 HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 \
  HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_FEEDBACK=1

# The headless shell renders compositions; full Chromium records the app.
first() { for p in "$@"; do [ -x "$p" ] && { echo "$p"; return; }; done; }
if [ -z "${HYPERFRAMES_BROWSER_PATH:-}" ]; then
  # Newer Playwright installs Chrome for Testing: chrome-headless-shell-<platform>/chrome-headless-shell.
  HYPERFRAMES_BROWSER_PATH="$(first /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell \
    "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-mac*/headless_shell \
    "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac*/chrome-headless-shell \
    "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux*/headless_shell \
    "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell)"
fi
if [ -n "$HYPERFRAMES_BROWSER_PATH" ]; then
  export HYPERFRAMES_BROWSER_PATH HYPERFRAMES_NO_AUTO_INSTALL=1
else
  unset HYPERFRAMES_BROWSER_PATH
fi
if [ -z "${VIDEO_CHROMIUM:-}" ]; then
  VIDEO_CHROMIUM="$(first /opt/pw-browsers/chromium-*/chrome-linux/chrome \
    "$HOME"/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium \
    "$HOME"/Library/Caches/ms-playwright/chromium-*/chrome-mac*/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" \
    "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome)"
fi
[ -n "$VIDEO_CHROMIUM" ] && export VIDEO_CHROMIUM

# need_space <GB> <what>: stop before starting something that would fill the
# disk halfway through. A smooth capture writes up to ~2 GB of frames before it
# encodes them, and a render that runs out of room dies late with FFmpeg's
# exit 1. `npm run clean` frees what is rebuildable.
need_space() {
  local free_gb
  free_gb="$(df -Pk "$VIDEO_DIR" | awk 'NR==2 { printf "%d", $4 / 1048576 }')"
  if [ "$free_gb" -lt "$1" ]; then
    echo "Only ${free_gb} GB free on this disk; $2 needs about $1 GB. Run 'npm run clean' (or free space) and try again." >&2
    return 1
  fi
}

# The app and the demo run on the repository's own Node (.nvmrc).
if [ -d "$HOME/.local/node26/bin" ]; then export PATH="$HOME/.local/node26/bin:$PATH"; fi
