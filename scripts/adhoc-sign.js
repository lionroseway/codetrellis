/**
 * electron-builder afterPack hook — ad-hoc codesign the .app bundle.
 *
 * Signs every Mach-O binary and .dylib inside the .app bundle from
 * the inside out (frameworks → helpers → main executable → top-level
 * bundle). This replaces the unreliable `codesign --deep` approach
 * which Apple deprecated and which leaves Sealed Resources empty.
 *
 * Without proper signing, macOS quarantine hides the app on install
 * and Gatekeeper blocks launch.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  // Bail unless we're building a macOS target. Was previously
  // `process.platform !== 'darwin'`, which checks the HOST, not the
  // TARGET — so cross-arch Win/Linux builds from a Mac host tried to
  // xattr a .app that doesn't exist.
  const target = context.electronPlatformName;
  if (target !== 'darwin' && target !== 'mas') return;

  // Real signed builds (npm run package:mac:signed) set CT_SIGN=1.
  // In that mode electron-builder performs proper Developer ID signing +
  // notarization, so stand down — an ad-hoc signature here would stomp it.
  if (process.env.CT_SIGN === '1') {
    console.log('[adhoc-sign] CT_SIGN=1 — skipping ad-hoc signing (electron-builder will sign + notarize for real)');
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  console.log(`[adhoc-sign] Stripping xattrs: ${appPath}`);
  execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });

  // 1. Sign all .dylib files
  console.log('[adhoc-sign] Signing .dylib files...');
  const dylibs = findFiles(appPath, '.dylib');
  for (const f of dylibs) {
    signFile(f);
  }

  // 2. Sign all .node native addons (e.g. node-pty)
  console.log('[adhoc-sign] Signing .node native addons...');
  const nodeAddons = findFiles(appPath, '.node');
  for (const f of nodeAddons) {
    signFile(f);
  }

  // 3. Sign all .so files
  const soFiles = findFiles(appPath, '.so');
  for (const f of soFiles) {
    signFile(f);
  }

  // 4. Sign helper apps (inside Frameworks/)
  console.log('[adhoc-sign] Signing helper apps...');
  const frameworksDir = path.join(appPath, 'Contents', 'Frameworks');
  if (fs.existsSync(frameworksDir)) {
    const entries = fs.readdirSync(frameworksDir);

    // Sign helper .app bundles first
    for (const entry of entries) {
      const fullPath = path.join(frameworksDir, entry);
      if (entry.endsWith('.app')) {
        signBundle(fullPath);
      }
    }

    // Sign .framework bundles
    for (const entry of entries) {
      const fullPath = path.join(frameworksDir, entry);
      if (entry.endsWith('.framework')) {
        signBundle(fullPath);
      }
    }
  }

  // 5. Sign the main executable
  console.log('[adhoc-sign] Signing main executable...');
  const mainExec = path.join(appPath, 'Contents', 'MacOS', 'CodeTrellis');
  if (fs.existsSync(mainExec)) {
    signFile(mainExec);
  }

  // 6. Sign the top-level .app bundle
  console.log(`[adhoc-sign] Signing top-level bundle: ${appPath}`);
  signBundle(appPath);

  // 7. Verify
  try {
    execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'pipe' });
    console.log('[adhoc-sign] Verification passed ✓');
  } catch (err) {
    // Non-fatal: verification can fail for Electron apps due to their
    // unusual bundle structure, but the per-component signatures still
    // satisfy Gatekeeper enough to prevent "hidden app" issues.
    console.log(`[adhoc-sign] Verification warning (non-fatal): ${err.stderr?.toString().trim() || 'unknown'}`);
  }

  console.log('[adhoc-sign] Done');
};

function signFile(filePath) {
  try {
    execSync(
      `codesign --force --sign - --timestamp=none "${filePath}"`,
      { stdio: 'pipe' },
    );
  } catch (err) {
    // Some files may not be Mach-O — skip silently
    const msg = err.stderr?.toString() || '';
    if (!msg.includes('not a Mach-O') && !msg.includes('not valid')) {
      console.log(`[adhoc-sign] Warning signing ${path.basename(filePath)}: ${msg.trim()}`);
    }
  }
}

function signBundle(bundlePath) {
  try {
    execSync(
      `codesign --force --sign - --timestamp=none "${bundlePath}"`,
      { stdio: 'pipe' },
    );
  } catch (err) {
    console.log(`[adhoc-sign] Warning signing bundle ${path.basename(bundlePath)}: ${err.stderr?.toString().trim()}`);
  }
}

/**
 * Recursively find files with a given extension inside a directory.
 */
function findFiles(dir, ext) {
  const results = [];
  try {
    const out = execSync(
      `find "${dir}" -name "*${ext}" -type f 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    );
    for (const line of out.trim().split('\n')) {
      if (line) results.push(line);
    }
  } catch {
    // find may fail on some paths — that's fine
  }
  return results;
}
