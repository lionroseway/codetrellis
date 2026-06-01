/**
 * electron-builder afterPack hook — ad-hoc codesign the .app bundle.
 *
 * Runs `codesign --force --deep --sign -` on the packed app so the
 * DMG ships with a valid ad-hoc signature. Without this, macOS
 * quarantine (com.apple.provenance xattr) breaks the app on first
 * launch and it won't appear in Launchpad / Spotlight.
 *
 * Also strips extended attributes that Gatekeeper adds during copy.
 */

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  console.log(`[adhoc-sign] Stripping xattrs: ${appPath}`);
  execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });

  console.log(`[adhoc-sign] Ad-hoc signing: ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, {
    stdio: 'inherit',
  });

  console.log('[adhoc-sign] Done');
};
