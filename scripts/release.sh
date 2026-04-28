#!/usr/bin/env bash
#
# Cut a CodeTrellis release.
#
# Builds installers for macOS (arm64 + x64 DMG), Windows (NSIS Setup
# + Portable EXE), and Linux (deb + AppImage), then publishes them as
# a GitHub Release on the **public** `codetrellis-releases` repo.
# Source stays in the private `codetrellis` repo.
#
# rpm is intentionally skipped — `rpmbuild` isn't on macOS and
# AppImage already covers Fedora / RHEL / Arch users. Add it back via
# CI on a Linux runner if/when needed.
#
# Usage:
#   ./scripts/release.sh                # uses version from package.json
#   ./scripts/release.sh --dry-run      # build only, no upload
#   ./scripts/release.sh --skip-build   # upload existing out/make/* (faster re-runs)
#
# Prereqs:
#   - logged in via `gh auth status`
#   - clean working tree (script aborts otherwise — releases must be
#     reproducible from a tagged commit)

set -euo pipefail

# --- Config ---
SOURCE_REPO_SLUG="lionroseway/codetrellis"
RELEASES_REPO_SLUG="lionroseway/codetrellis-releases"
RELEASES_REPO_URL="https://github.com/${RELEASES_REPO_SLUG}.git"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
OUT_DIR="${REPO_ROOT}/out/make"

DRY_RUN=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;36m[release]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[release]\033[0m %s\n' "$*" >&2; }

# --- Sanity checks ---
log "Releasing v${VERSION} from $(git rev-parse --short HEAD)"

if [[ -n "$(git status --porcelain)" ]]; then
  err "Working tree is dirty. Commit or stash before releasing — releases must be reproducible."
  git status --short
  exit 1
fi

if ! command -v gh >/dev/null; then
  err "gh CLI not installed. Install from https://cli.github.com/"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  err "Not authenticated with gh. Run 'gh auth login' first."
  exit 1
fi

# Check the public releases repo doesn't already have this tag.
if [[ "$DRY_RUN" -eq 0 ]]; then
  if gh release view "$TAG" --repo "$RELEASES_REPO_SLUG" >/dev/null 2>&1; then
    err "Release $TAG already exists on $RELEASES_REPO_SLUG."
    err "Delete it first:  gh release delete $TAG --repo $RELEASES_REPO_SLUG --cleanup-tag --yes"
    exit 1
  fi
fi

# --- Build ---
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  log "Building installers (this takes ~3-5 min)…"

  log "  → macOS DMG (arm64 + x64)"
  npm run package:mac-universal

  log "  → Windows NSIS + Portable"
  npm run package:win

  log "  → Linux deb + AppImage (skipping rpm — needs rpmbuild)"
  # Override the package.json `linux.target` config from the CLI so we
  # don't try to build rpm. electron-builder takes targets after `--linux`.
  npx electron-builder --linux deb AppImage
else
  log "Skipping build (--skip-build); using existing $OUT_DIR"
fi

# --- Collect artefacts ---
log "Collecting artefacts from ${OUT_DIR}"

# These are the files we expect to exist after the builds above.
# `*.snap` etc. would land here too if we added them later.
expected_files=(
  "${OUT_DIR}/CodeTrellis-${VERSION}-arm64.dmg"
  "${OUT_DIR}/CodeTrellis-${VERSION}-x64.dmg"
  "${OUT_DIR}/CodeTrellis-Setup-${VERSION}.exe"
  "${OUT_DIR}/CodeTrellis-Portable-${VERSION}.exe"
  "${OUT_DIR}/CodeTrellis-${VERSION}.deb"
  "${OUT_DIR}/CodeTrellis-${VERSION}.AppImage"
)

# Some platforms emit slightly different names — fall back to globs.
upload_files=()
for f in "${expected_files[@]}"; do
  if [[ -f "$f" ]]; then
    upload_files+=("$f")
  else
    err "  ⚠ missing: $(basename "$f")"
  fi
done

# Linux deb and AppImage filenames sometimes have arch suffixes; pick
# them up via glob too.
shopt -s nullglob
for f in "${OUT_DIR}"/CodeTrellis_${VERSION}_amd64.deb "${OUT_DIR}"/*.AppImage; do
  if [[ -f "$f" && ! " ${upload_files[*]} " =~ " ${f} " ]]; then
    upload_files+=("$f")
  fi
done
shopt -u nullglob

if [[ ${#upload_files[@]} -eq 0 ]]; then
  err "No artefacts found in $OUT_DIR. Did the build fail?"
  exit 1
fi

log "Will upload ${#upload_files[@]} files:"
for f in "${upload_files[@]}"; do
  printf '    %s (%s)\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "--dry-run: stopping before upload."
  exit 0
fi

# --- Publish to public releases repo ---
log "Creating release $TAG on $RELEASES_REPO_SLUG"

# Build the release notes inline. Pulling from CHANGELOG.md or the git
# log would be nicer but we don't have one yet.
COMMIT_SHA="$(git rev-parse HEAD)"
COMMIT_SHORT="$(git rev-parse --short HEAD)"
NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT

cat > "$NOTES_FILE" <<EOF
CodeTrellis ${VERSION} — installer downloads.

> The source repository is currently private. We're collecting
> feedback before the public source release; reach out via issues
> here or join the conversation at [codetrellis.dev](https://codetrellis.dev).

## Downloads

- **macOS (Apple Silicon)** — \`CodeTrellis-${VERSION}-arm64.dmg\`
- **macOS (Intel)** — \`CodeTrellis-${VERSION}-x64.dmg\`
- **Windows installer (NSIS)** — \`CodeTrellis-Setup-${VERSION}.exe\`
- **Windows portable** — \`CodeTrellis-Portable-${VERSION}.exe\`
- **Linux (.deb)** — for Debian / Ubuntu / Mint
- **Linux (AppImage)** — for Fedora / RHEL / Arch (\`chmod +x\` then run)

## First-launch notes

Builds are not yet code-signed, so the OS will warn you the first
time. This is expected — bypass it once and the warning won't repeat.

- **macOS**: right-click → Open → Open. Or System Settings → Privacy & Security → "Open Anyway".
- **Windows**: SmartScreen → "More info" → "Run anyway".
- **Linux .deb**: \`sudo dpkg -i CodeTrellis-${VERSION}.deb\`
- **Linux AppImage**: \`chmod +x\` then \`./CodeTrellis-${VERSION}.AppImage\`

---
Built from \`${SOURCE_REPO_SLUG}\` @ \`${COMMIT_SHORT}\`.
EOF

# `gh release create` on the public repo. The tag is created remotely
# at the same time. We deliberately don't push the tag from the
# source repo here — source repo tags are managed separately via
# `git tag` + `git push origin <tag>` if/when the maintainer wants
# them to mark the build commit on the source side.
gh release create "$TAG" \
  --repo "$RELEASES_REPO_SLUG" \
  --title "v${VERSION}" \
  --notes-file "$NOTES_FILE" \
  --target main \
  "${upload_files[@]}"

log "Release published: https://github.com/${RELEASES_REPO_SLUG}/releases/tag/${TAG}"
log "Done."
