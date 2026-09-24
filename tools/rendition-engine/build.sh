#!/usr/bin/env bash
#
# Phase 31 §7.6 — build the conversion engine from LibreOffice's own source.
#
# LibreOffice (pinned commit) compiled to WebAssembly by Emscripten (pinned
# version), headless, with LibreOfficeKit exported for our driver, and with
# NO NETWORK: curl is off (LibreOffice turns it off for Emscripten), the
# Fetch API is not linked, the glue targets Node only, and every socket
# syscall and name lookup resolves to a stub that fails (no-network.js).
#
# Resumable: compiler output is cached (ccache) and `make` stops itself
# before the CI job's time limit, so a CI run that does not finish leaves
# the cache warm for the next run to pick up. See README.md.
#
# Environment:
#   WORK        build directory                    (default: ./.rendition-build)
#   OUT         where the raw build output goes     (default: $WORK/out)
#   JOBS        parallel jobs                       (default: nproc)
#   MAKE_BUDGET seconds `make` may run before it stops, leaving the cache
#               for the next run; 0 = no limit       (default: 0)
#   TARBALLS    LibreOffice's third-party source tarballs, kept between runs
#                                                   (default: $WORK/tarballs)
#
# Exit 75 means make stopped at its budget: run again to continue.

set -euo pipefail

LIBREOFFICE_COMMIT="d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1"   # libreoffice-24-8, final commit
LIBREOFFICE_REPO="https://github.com/LibreOffice/core"
EMSDK_VERSION="3.1.74"

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$PWD/.rendition-build}"
OUT="${OUT:-$WORK/out}"
JOBS="${JOBS:-$(nproc)}"
MAKE_BUDGET="${MAKE_BUDGET:-0}"
TARBALLS="${TARBALLS:-$WORK/tarballs}"
LO="$WORK/libreoffice"
EMSDK="$WORK/emsdk"

log() { printf '\n== %s\n' "$*"; }
mkdir -p "$WORK" "$OUT" "$TARBALLS"

# ── Emscripten ───────────────────────────────────────────────────────────
log "Emscripten $EMSDK_VERSION"
if [ ! -d "$EMSDK" ]; then
  git clone --quiet https://github.com/emscripten-core/emsdk.git "$EMSDK"
fi
(cd "$EMSDK" && ./emsdk install "$EMSDK_VERSION" >/dev/null && ./emsdk activate "$EMSDK_VERSION" >/dev/null)
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null
emcc --version | head -1

# ── LibreOffice source, pinned ───────────────────────────────────────────
log "LibreOffice $LIBREOFFICE_COMMIT"
if [ ! -d "$LO/.git" ]; then
  mkdir -p "$LO"
  git -C "$LO" init --quiet
  git -C "$LO" remote add origin "$LIBREOFFICE_REPO"
fi
if [ "$(git -C "$LO" rev-parse HEAD 2>/dev/null || true)" != "$LIBREOFFICE_COMMIT" ]; then
  git -C "$LO" fetch --quiet --depth 1 origin "$LIBREOFFICE_COMMIT"
  git -C "$LO" checkout --quiet --force FETCH_HEAD
  git -C "$LO" clean -fdxq -e workdir -e instdir
fi
test "$(git -C "$LO" rev-parse HEAD)" = "$LIBREOFFICE_COMMIT"

# ── Patches: the upstream WASM build fixes, then ours ────────────────────
log "Patches"
git -C "$LO" checkout --quiet --force -- .
git -C "$LO" apply "$HERE/patches/wasm-build-fixes.patch"
# The vendored configuration, plus where third-party sources are kept. Only
# rewritten when it changes, so a resumed build does not reconfigure.
{ cat "$HERE/autogen.input"; printf '\n--with-external-tar=%s\n' "$TARBALLS"; } > "$WORK/autogen.input"
cmp -s "$WORK/autogen.input" "$LO/autogen.input" 2>/dev/null || cp "$WORK/autogen.input" "$LO/autogen.input"
cp "$HERE/no-network.js" "$LO/codetrellis-no-network.js"

MK="$LO/solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk"
# No Fetch API: it is an HTTP client, and nothing a converter does needs one.
grep -q -- '-s FETCH=1 ' "$MK"
sed -i 's/ -s FETCH=1 / /' "$MK"
! grep -q 'FETCH=1' "$MK"
# The glue for Node only (no browser XHR/fetch paths), and the no-network stubs.
cat >> "$MK" <<'MKEOF'

# CodeTrellis (Phase 31 §7.6): Node-only glue, and no network — every socket
# syscall and name lookup resolves to a stub that fails.
gb_EMSCRIPTEN_LDFLAGS += -s ENVIRONMENT=node --js-library $(SRCDIR)/codetrellis-no-network.js
MKEOF

# ── Configure ────────────────────────────────────────────────────────────
log "Configure"
cd "$LO"
if [ ! -f config_host.mk ] || [ autogen.input -nt config_host.mk ]; then
  ./autogen.sh
fi
# --enable-wasm-strip turns curl off for Emscripten; hold it to that.
grep -q '^#define HAVE_FEATURE_CURL 0' config_host/config_features.h \
  || { echo "curl is enabled; the engine must not have an HTTP client"; exit 1; }

# ── Build ────────────────────────────────────────────────────────────────
# A step of the upstream build zips autotext files it has not generated yet
# on some runs; creating them early is what the upstream script does too.
autotext() {
  local d="$LO/workdir/CustomTarget/extras/source/autotext/user/mytexts"
  [ -d "$d" ] || return 0
  [ -f "$d/BlockList.xml" ] && return 0
  mkdir -p "$d/META-INF"
  cp "$LO/extras/source/autotext/mytexts/BlockList.xml" "$d/" 2>/dev/null \
    || echo '<?xml version="1.0" encoding="UTF-8"?><block-list:block-list xmlns:block-list="http://openoffice.org/2001/block-list"/>' > "$d/BlockList.xml"
  cp "$LO/extras/source/autotext/mytexts/META-INF/manifest.xml" "$d/META-INF/" 2>/dev/null \
    || echo '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:media-type="application/vnd.sun.star.autotext" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="BlockList.xml"/></manifest:manifest>' > "$d/META-INF/manifest.xml"
  touch "$d/mimetype"
}
( while sleep 20; do autotext; done ) &
HELPER=$!
trap 'kill $HELPER 2>/dev/null || true' EXIT

log "make -j$JOBS (budget: ${MAKE_BUDGET}s)"
status=0
if [ "$MAKE_BUDGET" -gt 0 ]; then
  timeout --signal=INT "$MAKE_BUDGET" make -j"$JOBS" || status=$?
else
  make -j"$JOBS" || status=$?
fi
if [ "$status" -eq 124 ] || [ "$status" -eq 130 ]; then
  echo "make stopped at its time budget; the compiler cache carries this run's work to the next"
  exit 75
fi
[ "$status" -eq 0 ] || exit "$status"

# ── Collect ──────────────────────────────────────────────────────────────
log "Collect"
rm -rf "$OUT" && mkdir -p "$OUT"
P="$LO/instdir/program"
for f in soffice.wasm soffice.data; do cp "$P/$f" "$OUT/"; done
# The glue: an ES module factory (soffice.mjs) or a classic script (soffice.js).
if [ -f "$P/soffice.mjs" ]; then cp "$P/soffice.mjs" "$OUT/"; else cp "$P/soffice.js" "$OUT/soffice.cjs"; fi
for f in "$P"/soffice.worker.*; do [ -f "$f" ] && cp "$f" "$OUT/"; done
# The data package is found by name next to the glue, not at its build path.
sed -i 's|PACKAGE_NAME="[^"]*soffice\.data"|PACKAGE_NAME="soffice.data"|g; s|datafile_[^"]*emscripten_fs_image/soffice\.data|datafile_soffice.data|g' "$OUT"/soffice.*js
# What it was built from, for the engine's manifest (assemble.ts).
cat > "$OUT/build-info.json" <<JSON
{
  "libreoffice": { "repository": "$LIBREOFFICE_REPO", "commit": "$LIBREOFFICE_COMMIT" },
  "emscripten": "$EMSDK_VERSION",
  "emcc": "$(emcc --version | head -1 | sed 's/"/\\"/g')"
}
JSON
ls -la "$OUT"
log "Built LibreOffice $LIBREOFFICE_COMMIT with Emscripten $EMSDK_VERSION"
