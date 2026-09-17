#!/usr/bin/env bash
#
# Sign, notarize and staple the macOS DMGs.
#
# WHY THIS IS A SEPARATE STEP FROM THE BUILD
#
# electron-builder signs and notarizes the .app, and it does that correctly —
# `spctl -a` on the bundle reports "Notarized Developer ID". But the DMG that
# carries it is left unsigned (`dmg.sign` defaults to false, and electron-builder's
# notarize step runs against the app before the disk image is even assembled).
#
# That is not cosmetic. Gatekeeper assesses the DMG when the user opens it,
# separately from the app inside it:
#
#     spctl -a -t open --context context:primary-signature CodeTrellis-x.y.z.dmg
#     → rejected (source=no usable signature)
#
# So a user downloading a release with a perfectly notarized app inside still
# meets "cannot be opened because it is from an unidentified developer" on the
# disk image, and has to right-click → Open to get past it. v0.1.14 was built,
# signed and notarized correctly and still had this; it was caught by checking
# the artifact rather than trusting "notarization successful" in the build log.
#
# Stapling matters too: without a stapled ticket the check needs Apple's
# servers, so a user who is offline — or behind a network that blocks them —
# is refused despite everything being valid.
#
# Usage:  ./scripts/notarize-dmg.sh out/make/*.dmg

set -euo pipefail

log() { printf '\033[1;36m[notarize-dmg]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[notarize-dmg]\033[0m %s\n' "$*" >&2; }

if [[ $# -eq 0 ]]; then
  err "Usage: $0 <dmg> [dmg...]"
  exit 2
fi

# The identity is DISCOVERED from the keychain, not configured — same stance as
# electron-builder.signed.cjs, which omits `identity` for exactly this reason.
# A machine with no certificate then fails here with a clear message instead of
# silently producing an unsigned artifact. CSC_NAME overrides it if a machine
# ever holds more than one Developer ID.
if [[ -z "${CSC_NAME:-}" ]]; then
  # NB: macOS ships bash 3.2, which has no `mapfile`. Read the array the
  # portable way so this does not break on a stock machine.
  _ids=()
  while IFS= read -r _line; do
    [[ -n "$_line" ]] && _ids+=("$_line")
  done < <(security find-identity -v -p codesigning 2>/dev/null \
    | grep "Developer ID Application" \
    | sed -E 's/.*"(.*)".*/\1/')
  if [[ ${#_ids[@]} -eq 0 ]]; then
    err "No 'Developer ID Application' certificate in the keychain."
    err "Signing needs the real certificate; there is no ad-hoc fallback for a release."
    exit 1
  fi
  if [[ ${#_ids[@]} -gt 1 ]]; then
    err "Multiple Developer ID Application identities found; set CSC_NAME to choose:"
    printf '  %s\n' "${_ids[@]}" >&2
    exit 1
  fi
  CSC_NAME="${_ids[0]}"
fi
log "Signing identity: ${CSC_NAME}"

: "${APPLE_API_KEY:?Set APPLE_API_KEY (path to the App Store Connect .p8) in scripts/release-env.sh}"
: "${APPLE_API_KEY_ID:?Set APPLE_API_KEY_ID in scripts/release-env.sh}"
: "${APPLE_API_ISSUER:?Set APPLE_API_ISSUER in scripts/release-env.sh}"

for dmg in "$@"; do
  [[ -f "$dmg" ]] || { err "No such file: ${dmg}"; exit 1; }
  name="$(basename "$dmg")"

  # Already done? Re-running a release after fixing notes should not spend
  # another notarization round trip on an artifact that is already stapled.
  if xcrun stapler validate "$dmg" >/dev/null 2>&1; then
    log "${name}: already signed and stapled — skipping"
    continue
  fi

  log "${name}: signing…"
  codesign --sign "$CSC_NAME" --timestamp --force "$dmg"

  log "${name}: notarizing (this waits on Apple — usually a couple of minutes)…"
  #
  # `notarytool submit --wait` EXITS 0 EVEN WHEN APPLE REJECTS THE SUBMISSION.
  # It reports "status: Invalid" in its output and returns success, so `set -e`
  # does not catch it and the next step cheerfully tries to staple a ticket
  # that was never issued. Measured, not assumed: a stale ad-hoc-signed DMG
  # sailed through this step and failed at `stapler` with "Record not found",
  # which reads like a network problem rather than a rejected notarization.
  #
  # So parse the status and fail on anything that is not Accepted.
  notarize_json="$(xcrun notarytool submit "$dmg" \
    --key "$APPLE_API_KEY" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --wait --output-format json)"

  status="$(printf '%s' "$notarize_json" | /usr/bin/python3 -c \
    'import json,sys; print(json.load(sys.stdin).get("status","<none>"))')"
  submission_id="$(printf '%s' "$notarize_json" | /usr/bin/python3 -c \
    'import json,sys; print(json.load(sys.stdin).get("id",""))')"

  if [[ "$status" != "Accepted" ]]; then
    err "${name}: Apple returned status '${status}' — NOT notarized."
    err "Read the reasons with:"
    err "  xcrun notarytool log ${submission_id} --key \"\$APPLE_API_KEY\" \\"
    err "    --key-id \"\$APPLE_API_KEY_ID\" --issuer \"\$APPLE_API_ISSUER\""
    err "The usual cause is an app inside that was ad-hoc signed rather than"
    err "signed with the Developer ID certificate — i.e. built with"
    err "\`npm run package:mac\` instead of \`package:mac:signed\`."
    exit 1
  fi
  log "${name}: Apple accepted submission ${submission_id}"

  log "${name}: stapling the ticket…"
  xcrun stapler staple "$dmg"

  # Verify against the artifact, not against the exit codes above. This is the
  # exact assessment Gatekeeper performs when the user opens the download.
  if ! spctl -a -t open --context context:primary-signature -v "$dmg" 2>&1 | grep -q accepted; then
    err "${name}: STILL REJECTED by Gatekeeper after signing and stapling."
    spctl -a -t open --context context:primary-signature -v "$dmg" || true
    exit 1
  fi

  log "${name}: accepted by Gatekeeper ✓"
done

log "All disk images signed, notarized and stapled."
