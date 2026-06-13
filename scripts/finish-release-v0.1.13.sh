#!/usr/bin/env bash
#
# One-shot completion of the v0.1.13 public release.
#
# Why this exists: the first attempt was blocked because GitHub Actions
# *artifact storage quota* was full, which fails the Windows/Linux CI upload.
# The stale artifacts were deleted, but GitHub recalculates the quota gate only
# every 6-12h — so the retry must wait for that window. This script does the
# whole completion in one go once the quota has cleared.
#
# Run it (after ~8-10h from 2026-06-13 ~19:00 UTC) from the repo root on THIS
# Mac (signing keys + notarization run locally):
#
#   bash scripts/finish-release-v0.1.13.sh
#
# Idempotency: if `npm run release` finds the release already exists it aborts;
# in that case re-run with the desktop set already published and this script
# will just (re)attach Android + fix the README.

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"   # 0.1.13
TAG="v${VERSION}"
RELEASES_REPO="lionroseway/codetrellis-releases"
RELEASES_DIR="/Users/saif/Workspaces/AILAR/codetrellis-releases"
APK="out/make/CodeTrellis-Companion-${VERSION}.apk"

log() { printf '\033[1;36m[finish]\033[0m %s\n' "$*"; }

# --- 0. Preflight: confirm the CI quota has actually cleared -------------------
log "Checking GitHub Actions artifact storage gate by re-running CI…"
# release.sh will trigger + watch CI itself; if uploads still fail it aborts and
# we stop here without publishing a partial release.

# --- 1. Full desktop release (signed mac + win/linux CI + gh publish) ----------
if gh release view "$TAG" --repo "$RELEASES_REPO" >/dev/null 2>&1; then
  log "$TAG already exists — skipping desktop build/publish, will just attach Android + fix README."
else
  log "Running full desktop release (npm run release)…"
  npm run release
fi

# --- 2. Attach the Android APK (release.sh does not handle Android) ------------
if [[ -f "$APK" ]]; then
  log "Attaching Android APK → $TAG"
  gh release upload "$TAG" "$APK" --repo "$RELEASES_REPO" --clobber
else
  log "WARNING: $APK missing — rebuild with: (cd mobile && npx eas-cli build -p android --profile production-apk) then re-run."
fi

# --- 3. Add a Mobile section to the release notes -----------------------------
log "Appending Mobile section to the release notes…"
BODY="$(gh release view "$TAG" --repo "$RELEASES_REPO" --json body --jq .body)"
if ! grep -q "CodeTrellis-Companion-${VERSION}.apk" <<<"$BODY"; then
  gh release edit "$TAG" --repo "$RELEASES_REPO" --notes "${BODY}

## Mobile companion

- **Android** — \`CodeTrellis-Companion-${VERSION}.apk\` (sideload; allow \"Install unknown apps\").
- **iOS** — via TestFlight (build submitted to App Store Connect)."
fi

# --- 4. Bump the releases-repo README download table (0.1.12 → 0.1.13) --------
if [[ -f "${RELEASES_DIR}/README.md" ]]; then
  log "Bumping README download table in ${RELEASES_REPO}…"
  # Only the previous release version appears in the download table.
  sed -i '' "s/0\.1\.12/${VERSION}/g" "${RELEASES_DIR}/README.md"
  ( cd "$RELEASES_DIR" \
    && git add README.md \
    && git commit -q -m "docs: bump download table to v${VERSION}" \
    && git push origin main ) || log "README commit/push skipped (no change or push failed)."
fi

log "Done. Release: https://github.com/${RELEASES_REPO}/releases/tag/${TAG}"
gh release view "$TAG" --repo "$RELEASES_REPO" --json assets --jq '.assets[].name' | sed 's/^/  - /'
