#!/usr/bin/env bash
#
# Cut a CodeTrellis Companion (mobile) release.
#
#   iOS      — built with the EAS pipeline, then submitted to TestFlight.
#              The submit block in mobile/eas.json is already configured
#              (ascAppId 6777139934, AILAR Limited, team 35GKY9KGZ3).
#   Android  — builds, but there is NO submit profile yet, so the AAB is left
#              for a manual Play Console upload. The script says so rather
#              than pretending it finished.
#
# BUILDS LOCALLY BY DEFAULT.
#
# `eas build --local` runs the same pipeline with the same credential handling
# as the hosted service, on this Mac. No queue, no build quota. Expo's hosted
# builders are the optional part of EAS, not the framework — see
# docs/claude/mobile-companion.md. Pass --hosted when this machine cannot do
# it (no fastlane, wrong Xcode, not a Mac).
#
# Usage:
#   ./scripts/release-mobile.sh                      # iOS: build local + submit
#   ./scripts/release-mobile.sh --platform android   # Android: build only
#   ./scripts/release-mobile.sh --hosted             # queue on EAS builders
#   ./scripts/release-mobile.sh --build-only         # build, don't submit
#   ./scripts/release-mobile.sh --submit-only --path out/CodeTrellis.ipa
#
# Prereqs:
#   - eas-cli logged in       (`npx eas-cli@latest whoami` → an account with
#                              access to the `ailar` org)
#   - clean working tree      (a release must be reproducible from its commit)
#   - fastlane, for a LOCAL iOS build   (`brew install fastlane`)
#   - Xcode + CocoaPods, for a local iOS build
#
# WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
#
#   - Bump the build number. `mobile/eas.json` sets appVersionSource "remote"
#     with autoIncrement on the production profile, so EAS owns that counter.
#     Setting it here would fight the server and produce duplicate uploads.
#   - Run `expo prebuild`. This is a CNG project: ios/ and android/ are
#     generated and gitignored, and EAS regenerates them. Hand-edits there are
#     wiped, so there is nothing to preserve.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="${REPO_ROOT}/mobile"
cd "$REPO_ROOT"

PLATFORM="ios"
HOSTED=0
BUILD_ONLY=0
SUBMIT_ONLY=0
ARTIFACT_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)    PLATFORM="${2:?--platform needs ios or android}"; shift 2 ;;
    --hosted)      HOSTED=1; shift ;;
    --build-only)  BUILD_ONLY=1; shift ;;
    --submit-only) SUBMIT_ONLY=1; shift ;;
    --path)        ARTIFACT_PATH="${2:?--path needs a file}"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;36m[release-mobile]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[release-mobile]\033[0m %s\n' "$*" >&2; }

case "$PLATFORM" in
  ios|android) ;;
  *) err "--platform must be ios or android (got '${PLATFORM}')"; exit 2 ;;
esac

# --- Versions must agree across desktop and mobile -------------------------
#
# The peer protocol lives in BOTH codebases — pairing, the reconnect proofs,
# the four data channels — and they are only ever tested against each other at
# matching versions. Shipping a mobile build against a different desktop
# version is how you get a pairing that succeeds and then silently fails to
# reconnect, which is the hardest class of bug to hear about from users.
#
# Phase 19 makes this sharper: the pairing and reconnect protocols changed, so
# a mismatched pair does not merely misbehave, it cannot connect at all.
DESKTOP_VERSION="$(node -p "require('${REPO_ROOT}/package.json').version")"
MOBILE_VERSION="$(node -p "require('${MOBILE_DIR}/app.json').expo.version")"

if [[ "$DESKTOP_VERSION" != "$MOBILE_VERSION" ]]; then
  err "Version mismatch: desktop ${DESKTOP_VERSION}, mobile ${MOBILE_VERSION}."
  err "The peer protocol is shared, so these ship together. Update"
  err "mobile/app.json → expo.version to ${DESKTOP_VERSION} and commit."
  exit 1
fi

log "Releasing CodeTrellis Companion ${MOBILE_VERSION} (${PLATFORM}) from $(git rev-parse --short HEAD)"

# --- Sanity checks ---------------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  err "Working tree is dirty. Commit or stash first — a release must be"
  err "reproducible from the commit it claims to be."
  git status --short
  exit 1
fi

cd "$MOBILE_DIR"

command -v npx >/dev/null || { err "npx not found"; exit 1; }

# --- Resolve the EAS command ------------------------------------------------
#
# NOT plain `npx eas-cli`. Unpinned, npx resolves it through a path that fails
# on this machine with a bare "npm error Invalid Version:" and no other clue —
# which reads exactly like a broken login. `eas-cli` is not a dependency of the
# mobile project (it is a tool, not a library), so there is nothing local to
# resolve against; a global install is used when present, and an explicitly
# tagged npx otherwise.
if command -v eas >/dev/null 2>&1; then
  EAS=(eas)
else
  EAS=(npx eas-cli@latest)
fi
log "Using: ${EAS[*]}"

if ! "${EAS[@]}" whoami >/dev/null 2>&1; then
  err "Not logged in to EAS. Run:  ${EAS[*]} login"
  err "The account needs access to the 'ailar' organisation."
  exit 1
fi
log "EAS account: $("${EAS[@]}" whoami 2>/dev/null | tail -1)"

# A local iOS build shells out to fastlane for signing and archiving. Without
# it the build fails several minutes in, with an error that does not obviously
# name the cause.
if [[ "$PLATFORM" == "ios" && "$HOSTED" -eq 0 && "$SUBMIT_ONLY" -eq 0 ]]; then
  if ! command -v fastlane >/dev/null 2>&1; then
    err "fastlane is required for a LOCAL iOS build and is not installed."
    err "  brew install fastlane"
    err "…or pass --hosted to build on EAS's builders instead (expect a queue)."
    exit 1
  fi
  command -v xcodebuild >/dev/null || { err "Xcode not found (xcode-select)"; exit 1; }
fi

# --- Build -----------------------------------------------------------------
if [[ "$SUBMIT_ONLY" -eq 0 ]]; then
  if [[ "$HOSTED" -eq 1 ]]; then
    log "Building on EAS hosted builders (queued, rate-limited)…"
    "${EAS[@]}" build --profile production --platform "$PLATFORM" --non-interactive
    log "Hosted build submitted. When it finishes, submit with:"
    log "  ./scripts/release-mobile.sh --submit-only --platform ${PLATFORM}"
    exit 0
  fi

  # --local writes the artifact into the current directory with a generated
  # name. Pin it so the submit step does not have to guess which file appeared.
  EXT="ipa"; [[ "$PLATFORM" == "android" ]] && EXT="aab"
  ARTIFACT_PATH="${MOBILE_DIR}/build-${MOBILE_VERSION}.${EXT}"
  rm -f "$ARTIFACT_PATH"

  log "Building locally (no queue). This takes a while — Xcode does the work."
  "${EAS[@]}" build \
    --profile production \
    --platform "$PLATFORM" \
    --local \
    --non-interactive \
    --output "$ARTIFACT_PATH"

  log "Built: ${ARTIFACT_PATH}"
fi

if [[ "$BUILD_ONLY" -eq 1 ]]; then
  log "--build-only: stopping before submit."
  exit 0
fi

# --- Submit ----------------------------------------------------------------
if [[ "$PLATFORM" == "android" ]]; then
  err "No Android submit profile exists in mobile/eas.json."
  err "Upload this to the Play Console by hand:"
  err "  ${ARTIFACT_PATH:-<the .aab from the build above>}"
  err "Adding a submit block here is the remaining gap — see"
  err "docs/claude/mobile-companion.md."
  exit 0
fi

log "Submitting to App Store Connect → TestFlight…"
if [[ -n "$ARTIFACT_PATH" ]]; then
  "${EAS[@]}" submit --platform ios --path "$ARTIFACT_PATH" --non-interactive
else
  # No local artifact: submit the most recent finished build on EAS.
  "${EAS[@]}" submit --platform ios --latest --non-interactive
fi

log "Submitted. Apple processes the build before it appears in TestFlight —"
log "usually minutes, occasionally much longer."
log ""
log "RELEASE NOTE FOR THIS VERSION — say it plainly to testers:"
log "  every existing pairing stops working and must be redone."
log "  The device list offers 'Pair again' and explains why; it is not a bug."
