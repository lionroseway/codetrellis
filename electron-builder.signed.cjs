/**
 * electron-builder config for SIGNED + NOTARIZED macOS builds.
 *
 * Reuses the base `build` config from package.json and overrides the
 * `mac` block to turn on real Developer ID signing + Apple notarization.
 * The default `npm run package:mac` is untouched (still ad-hoc signed via
 * scripts/adhoc-sign.js, no certificate required) — only the dedicated
 * `npm run package:mac:signed` uses this file, and it sets CT_SIGN=1 so the
 * ad-hoc afterPack hook stands down and lets electron-builder sign for real.
 *
 * Prerequisites:
 *   1. A "Developer ID Application" certificate in the login keychain
 *      (electron-builder auto-discovers it).
 *   2. Notarization credentials via an App Store Connect API key, set in
 *      the environment before running the build:
 *        APPLE_API_KEY     absolute path to AuthKey_XXXXXXXXXX.p8
 *        APPLE_API_KEY_ID  the key's Key ID
 *        APPLE_API_ISSUER  the Issuer ID (UUID)
 *        APPLE_TEAM_ID     your 10-character Apple Team ID
 */
const base = require('./package.json').build;

// Omit `identity` entirely so electron-builder auto-discovers the
// Developer ID certificate (the package.json default pins it to `null`,
// which hard-disables signing).
const { identity: _drop, ...macBase } = base.mac;

module.exports = {
  ...base,
  mac: {
    ...macBase,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // electron-builder 26: `notarize` is a boolean. When true, @electron/notarize
    // reads credentials from the environment — either an App Store Connect API key
    // (APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER) or Apple ID
    // (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD), plus APPLE_TEAM_ID. Activate only
    // when creds are present so a signing-only build (no notarization) still works.
    notarize: Boolean(process.env.APPLE_API_KEY || process.env.APPLE_ID),
  },
  dmg: {
    ...base.dmg,
    sign: false,
  },
};
