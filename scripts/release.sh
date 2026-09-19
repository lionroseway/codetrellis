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
# Transient staging release on the SOURCE repo that CI uploads Windows/Linux
# installers to (as release assets — not Actions artifacts, so no artifact-storage
# quota). release.sh downloads them locally, publishes the public release, then
# deletes this staging release.
STAGING_TAG="ci-v${VERSION}"
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
warn() { printf '\033[1;33m[release]\033[0m %s\n' "$*" >&2; }

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

# --- Sign + notarize + staple the DMGs themselves --------------------------
#
# electron-builder notarizes the .app but leaves the disk image unsigned, so
# Gatekeeper rejects the container the user actually double-clicks. Runs even
# with --skip-build: the check is idempotent and skips anything already
# stapled, so it costs nothing on a re-publish and catches a DMG that was
# built before this step existed.
#
# VERSION-PINNED, like every other glob in this script. out/make accumulates
# artifacts from previous releases, and an unpinned *.dmg here would spend a
# notarization round trip on each of them — and, worse, fail the release on a
# stale ad-hoc-signed DMG from an older build that has nothing to do with this
# one. Only this version's disk images are this release's business.
if [[ -n "$(ls "${OUT_DIR}"/CodeTrellis-${VERSION}-*.dmg 2>/dev/null)" ]]; then
  "${REPO_ROOT}/scripts/notarize-dmg.sh" "${OUT_DIR}"/CodeTrellis-${VERSION}-*.dmg
fi

# --- Build Windows + Linux on CI (native runners) ---
if [[ "$SKIP_BUILD" -eq 0 && "$MAC_ONLY" -eq 0 ]]; then
  log "Pushing HEAD so CI builds the exact same commit…"
  git push origin HEAD

  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  # Clear any leftover staging release from a previous failed run so this run's
  # downloads can't pick up stale assets.
  gh release delete "$STAGING_TAG" --repo "$SOURCE_REPO_SLUG" --cleanup-tag --yes >/dev/null 2>&1 || true
  log "Triggering CI (${CI_WORKFLOW}) for Windows + Linux on ${BRANCH} → staging ${STAGING_TAG}…"
  gh workflow run "$CI_WORKFLOW" --repo "$SOURCE_REPO_SLUG" --ref "$BRANCH" -f tag="$STAGING_TAG"

  # Give GitHub a moment to register the run, then grab the newest one.
  sleep 8
  RUN_ID="$(gh run list --repo "$SOURCE_REPO_SLUG" --workflow "$CI_WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId')"
  log "Watching CI run ${RUN_ID} (node-pty compiles natively on each OS)…"
  gh run watch "$RUN_ID" --repo "$SOURCE_REPO_SLUG" --exit-status

  # Pull the installers from the staging RELEASE (assets), not Actions artifacts —
  # this sidesteps the artifact-storage quota that used to block the upload.
  log "Downloading Windows + Linux installers from ${STAGING_TAG} → ${OUT_DIR}"
  CI_DL="$(mktemp -d)"
  gh release download "$STAGING_TAG" --repo "$SOURCE_REPO_SLUG" --dir "$CI_DL" \
    --pattern '*.exe' --pattern '*.AppImage' --pattern '*.deb' --pattern '*.rpm'
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
  "${OUT_DIR}"/codetrellis_${VERSION}_*.deb \
  "${OUT_DIR}"/codetrellis-${VERSION}.*.rpm \
  "${OUT_DIR}"/CodeTrellis-Companion-${VERSION}.apk ; do
  [[ -f "$f" ]] && upload_files+=("$f")
done
shopt -u nullglob

if [[ ${#upload_files[@]} -eq 0 ]]; then
  err "No artefacts found in $OUT_DIR for ${VERSION}. Did the builds fail?"
  exit 1
fi

# --- The Android APK is a release asset, and it went missing once ---
#
# v0.1.12 and v0.1.13 shipped `CodeTrellis-Companion-<version>.apk` on the
# releases repo — it is how the companion is distributed while there is no
# Play listing. v0.1.14 was the first release cut by THIS script, which
# knew nothing about it, so the APK silently stopped shipping and nothing
# said a word.
#
# This script cannot build it: an APK needs the Android SDK and a Gradle
# run, and mobile is not integrated here (see CLAUDE.md). What it CAN do is
# refuse to be quiet about its absence, which is the part that failed.
#
# Not fatal on purpose — a desktop-only hotfix is legitimate, and
# --mac-only exists. But it must be impossible to publish without the
# omission being stated.
if [[ ! -f "${OUT_DIR}/CodeTrellis-Companion-${VERSION}.apk" ]]; then
  warn "No Android APK for ${VERSION} — this release will ship WITHOUT the companion."
  warn "  v0.1.12 and v0.1.13 shipped one; v0.1.14 dropped it silently."
  warn "  To include it, build first and re-run:"
  warn "    cd mobile && npx eas-cli build --local --profile production-apk --platform android \\"
  warn "      --output ${OUT_DIR}/CodeTrellis-Companion-${VERSION}.apk"
fi

# --- Sign the manifest (Phase 19, finding 23) ---
#
# The app verifies a download against a sha256. Until this existed that digest
# came from the GitHub API — which put GitHub in the trust chain: anyone who
# took over the releases repo would publish a bad binary AND a matching digest,
# and every check would pass.
#
# SHA256SUMS is signed with a key that lives on the release machine and never
# in CI. The public half ships inside the app, so a running copy can check a
# download without asking a server whose answer it would have to trust.
#
# The file list comes from `upload_files` rather than a second set of globs
# here, so the manifest cannot describe a different set than the release
# actually contains.
log "Signing the release manifest…"
node "${REPO_ROOT}/scripts/sign-release-manifest.js" "$OUT_DIR" "${upload_files[@]}"
upload_files+=("${OUT_DIR}/SHA256SUMS" "${OUT_DIR}/SHA256SUMS.sig")

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

> Source lives at [${SOURCE_REPO_SLUG}](https://github.com/${SOURCE_REPO_SLUG}).
> Binaries are published here so download URLs stay stable and need no
> authentication. Feedback via issues on either repo, or [codetrellis.dev](https://codetrellis.dev).

## Downloads

- **macOS (Apple Silicon)** — \`CodeTrellis-${VERSION}-arm64.dmg\` (signed + notarized)
- **macOS (Intel)** — \`CodeTrellis-${VERSION}-x64.dmg\` (signed + notarized)
- **Windows installer (NSIS)** — \`CodeTrellis-Setup-${VERSION}.exe\`
- **Windows portable** — \`CodeTrellis-Portable-${VERSION}.exe\`
- **Linux AppImage** — \`CodeTrellis-${VERSION}-x86_64.AppImage\` / \`CodeTrellis-${VERSION}-arm64.AppImage\` (portable, no install)
- **Linux .deb** (Debian / Ubuntu) and **.rpm** (Fedora / RHEL) — also attached

## First-launch notes

- **macOS** — signed & notarized by Apple, so it should just open (drag to
  Applications, open). If you *do* hit a Gatekeeper warning or an "app is
  damaged" error (older build, or a download that stripped the quarantine
  attributes), clear it once: \`xattr -cr /Applications/CodeTrellis.app\`.
- **Windows** — not code-signed yet, so SmartScreen may warn once →
  "More info" → "Run anyway".
- **Linux (AppImage)** — \`chmod +x CodeTrellis-${VERSION}-x86_64.AppImage && ./CodeTrellis-${VERSION}-x86_64.AppImage\`.
  Prefer the \`.deb\` / \`.rpm\` where you have the choice: an AppImage runs from a
  nosuid mount, so Chromium cannot use its setuid sandbox helper there.
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

# Tidy up the transient CI staging release on the source repo.
if [[ "$MAC_ONLY" -eq 0 ]]; then
  log "Deleting staging release ${STAGING_TAG} from ${SOURCE_REPO_SLUG}…"
  gh release delete "$STAGING_TAG" --repo "$SOURCE_REPO_SLUG" --cleanup-tag --yes >/dev/null 2>&1 || true
fi

# --- The notes above are a floor, not release notes ---
#
# What this script publishes is a download page: the file list and the
# first-launch tips, with no "what's new" in it at all. v0.1.14 shipped the
# whole of Phase 19's security hardening — four gates, a re-pairing protocol
# change and a dependency sweep — under the words "installer downloads", and
# nobody reading the release could tell any of it had happened.
#
# Writing them is a separate step, on purpose: it needs the commit range read
# and turned into outcomes, which is judgement rather than templating. Say so
# here rather than letting a published release look finished.
warn "The notes on ${TAG} are the generated download page, NOT release notes."
warn "  Write the real ones — see .claude/skills/codetrellis-release-notes —"
warn "  then: gh release edit ${TAG} --repo ${RELEASES_REPO_SLUG} --notes-file <file>"

log "Done."
