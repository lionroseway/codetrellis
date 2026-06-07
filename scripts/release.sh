#!/usr/bin/env bash
#
# Cut a CodeTrellis release.
#
#   macOS         — built + signed (Developer ID: AILAR Limited) + notarized
#                   LOCALLY on this Mac. Signing keys never leave the machine.
#   Windows/Linux — built on GitHub Actions (.github/workflows/build-installers.yml)
#                   on native runners, because node-pty can't cross-compile from
#                   macOS (since the better-sqlite3 native migration). This script
#                   triggers that CI run, waits for it, and downloads the artifacts.
#   Publish       — `gh release create` on the PUBLIC codetrellis-releases repo.
#                   Source stays in the private codetrellis repo.
#
# Usage:
#   ./scripts/release.sh               # mac (local) + win/linux (CI) + publish
#   ./scripts/release.sh --dry-run     # build everything, skip the gh publish
#   ./scripts/release.sh --skip-build  # publish existing out/make/* (faster re-runs)
#   ./scripts/release.sh --mac-only    # skip win/linux CI (mac DMGs only)
#
# Prereqs:
#   - gh authenticated (`gh auth status`)
#   - clean working tree (releases must be reproducible from the commit)
#   - scripts/release-env.sh present with Apple creds (cp from .example)
#   - Developer ID Application cert in the login keychain

set -euo pipefail

# --- Config ---
SOURCE_REPO_SLUG="lionroseway/codetrellis"
RELEASES_REPO_SLUG="lionroseway/codetrellis-releases"
CI_WORKFLOW="build-installers.yml"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
OUT_DIR="${REPO_ROOT}/out/make"

DRY_RUN=0; SKIP_BUILD=0; MAC_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --mac-only)   MAC_ONLY=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;36m[release]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[release]\033[0m %s\n' "$*" >&2; }

# --- Load signing/notarization creds (gitignored — never committed) ---
if [[ -f "${REPO_ROOT}/scripts/release-env.sh" ]]; then
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/scripts/release-env.sh"
fi

# --- Sanity checks ---
log "Releasing ${TAG} from $(git rev-parse --short HEAD)"

command -v gh >/dev/null || { err "gh CLI not installed — https://cli.github.com/"; exit 1; }
gh auth status >/dev/null 2>&1 || { err "Not authenticated with gh — run 'gh auth login'."; exit 1; }

if [[ -n "$(git status --porcelain)" ]]; then
  err "Working tree is dirty. Commit or stash first — releases must be reproducible."
  git status --short
  exit 1
fi

if [[ "$DRY_RUN" -eq 0 ]] && gh release view "$TAG" --repo "$RELEASES_REPO_SLUG" >/dev/null 2>&1; then
  err "Release $TAG already exists on $RELEASES_REPO_SLUG."
  err "Delete it first:  gh release delete $TAG --repo $RELEASES_REPO_SLUG --cleanup-tag --yes"
  exit 1
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  : "${APPLE_API_KEY:?Apple creds missing — copy scripts/release-env.sh.example to scripts/release-env.sh and fill it in}"
  : "${APPLE_API_KEY_ID:?Set APPLE_API_KEY_ID in scripts/release-env.sh}"
  : "${APPLE_API_ISSUER:?Set APPLE_API_ISSUER in scripts/release-env.sh}"
  : "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID in scripts/release-env.sh}"
fi

# --- Build macOS locally (signed + notarized) ---
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  log "Building signed + notarized macOS DMGs (arm64 + x64)…"
  log "  (electron-builder runs Apple notarization inline — can take several minutes)"
  npm run package:mac:signed
fi

# --- Build Windows + Linux on CI (native runners) ---
if [[ "$SKIP_BUILD" -eq 0 && "$MAC_ONLY" -eq 0 ]]; then
  log "Pushing HEAD so CI builds the exact same commit…"
  git push origin HEAD

  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  log "Triggering CI (${CI_WORKFLOW}) for Windows + Linux on ${BRANCH}…"
  gh workflow run "$CI_WORKFLOW" --repo "$SOURCE_REPO_SLUG" --ref "$BRANCH"

  # Give GitHub a moment to register the run, then grab the newest one.
  sleep 8
  RUN_ID="$(gh run list --repo "$SOURCE_REPO_SLUG" --workflow "$CI_WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId')"
  log "Watching CI run ${RUN_ID} (node-pty compiles natively on each OS)…"
  gh run watch "$RUN_ID" --repo "$SOURCE_REPO_SLUG" --exit-status

  log "Downloading Windows + Linux artifacts → ${OUT_DIR}"
  CI_DL="$(mktemp -d)"
  gh run download "$RUN_ID" --repo "$SOURCE_REPO_SLUG" --dir "$CI_DL"
  find "$CI_DL" \( -name '*.exe' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) -exec cp -v {} "$OUT_DIR/" \;
  rm -rf "$CI_DL"
elif [[ "$MAC_ONLY" -eq 1 ]]; then
  log "--mac-only: skipping the Windows/Linux CI build."
fi

# --- Collect artefacts ---
log "Collecting artefacts from ${OUT_DIR}"
shopt -s nullglob
upload_files=()
for f in \
  "${OUT_DIR}/CodeTrellis-${VERSION}-arm64.dmg" \
  "${OUT_DIR}/CodeTrellis-${VERSION}-x64.dmg" \
  "${OUT_DIR}/CodeTrellis-Setup-${VERSION}.exe" \
  "${OUT_DIR}/CodeTrellis-Portable-${VERSION}.exe" \
  "${OUT_DIR}"/CodeTrellis-${VERSION}*.AppImage \
  "${OUT_DIR}"/*.deb \
  "${OUT_DIR}"/*.rpm ; do
  [[ -f "$f" ]] && upload_files+=("$f")
done
shopt -u nullglob

if [[ ${#upload_files[@]} -eq 0 ]]; then
  err "No artefacts found in $OUT_DIR for ${VERSION}. Did the builds fail?"
  exit 1
fi

log "Will upload ${#upload_files[@]} files:"
for f in "${upload_files[@]}"; do
  printf '    %s (%s)\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "--dry-run: stopping before publish."
  exit 0
fi

# --- Publish to public releases repo ---
log "Creating release $TAG on $RELEASES_REPO_SLUG"
COMMIT_SHORT="$(git rev-parse --short HEAD)"
NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT

cat > "$NOTES_FILE" <<EOF
CodeTrellis ${VERSION} — installer downloads.

> The source repository is currently private. We're collecting feedback
> before the public source release — reach out via issues here or at
> [codetrellis.dev](https://codetrellis.dev).

## Downloads

- **macOS (Apple Silicon)** — \`CodeTrellis-${VERSION}-arm64.dmg\` (signed + notarized)
- **macOS (Intel)** — \`CodeTrellis-${VERSION}-x64.dmg\` (signed + notarized)
- **Windows installer (NSIS)** — \`CodeTrellis-Setup-${VERSION}.exe\`
- **Windows portable** — \`CodeTrellis-Portable-${VERSION}.exe\`
- **Linux AppImage** — \`CodeTrellis-${VERSION}.AppImage\` (portable, no install)
- **Linux .deb** (Debian / Ubuntu) and **.rpm** (Fedora / RHEL) — also attached

## First-launch notes

- **macOS** — signed & notarized by Apple, so it should just open (drag to
  Applications, open). If you *do* hit a Gatekeeper warning or an "app is
  damaged" error (older build, or a download that stripped the quarantine
  attributes), clear it once: \`xattr -cr /Applications/CodeTrellis.app\`.
- **Windows** — not code-signed yet, so SmartScreen may warn once →
  "More info" → "Run anyway".
- **Linux (AppImage)** — \`chmod +x CodeTrellis-${VERSION}.AppImage && ./CodeTrellis-${VERSION}.AppImage\`.
- **Linux (.deb)** — \`sudo apt install ./codetrellis_*.deb\` (or \`sudo dpkg -i\`).
- **Linux (.rpm)** — \`sudo dnf install ./codetrellis-*.rpm\` (or \`sudo rpm -i\`).

---
Built from \`${SOURCE_REPO_SLUG}\` @ \`${COMMIT_SHORT}\` (macOS local + Windows/Linux CI).
EOF

gh release create "$TAG" \
  --repo "$RELEASES_REPO_SLUG" \
  --title "v${VERSION}" \
  --notes-file "$NOTES_FILE" \
  --target main \
  "${upload_files[@]}"

log "Release published: https://github.com/${RELEASES_REPO_SLUG}/releases/tag/${TAG}"
log "Done."
