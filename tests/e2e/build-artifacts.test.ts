/**
 * Committed build artifacts must match the packages they were generated from.
 *
 * WHY THIS EXISTS
 *
 * Three separate times in one evening, a dependency upgrade silently
 * invalidated a committed artifact:
 *
 *   - patches/werift+0.23.0.patch stopped applying at werift 0.24 (caught only
 *     because npm ci failed loudly in CI).
 *   - patches/werift-sctp+0.0.11.patch pointed at a package that no longer
 *     existed.
 *   - resources/tree-sitter/tree-sitter.wasm was already 13KB adrift from the
 *     installed web-tree-sitter before anyone touched it.
 *
 * None of these are caught by typecheck, lint, the build, or the rest of this
 * suite. They are caught by a human noticing something is subtly wrong weeks
 * later, which is the worst possible detector.
 *
 * So: assert the coupling directly. Each test here should fail with a message
 * that says exactly which command regenerates the artifact.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');

test.describe('Committed build artifacts', () => {
  /**
   * The tree-sitter runtime WASM is loaded from resources/, NOT from
   * node_modules — ast-parser.ts points `locateFile` at GRAMMAR_DIR, which
   * resolves to resources/tree-sitter in dev and <resourcesPath>/tree-sitter
   * in the packaged app. So bumping the web-tree-sitter npm package changes
   * the JS glue while leaving the WASM runtime it drives untouched.
   *
   * The failure mode is not a crash. Grammars can still "load" while parsing
   * silently returns nothing — and an empty parse means an empty dependency
   * graph, which is the entire product.
   */
  test('resources/tree-sitter/tree-sitter.wasm matches the installed web-tree-sitter', () => {
    const committed = path.join(repoRoot, 'resources', 'tree-sitter', 'tree-sitter.wasm');

    // web-tree-sitter does not export package.json, so resolve the module and
    // walk up to the package root.
    let pkgDir = path.dirname(require.resolve('web-tree-sitter'));
    while (pkgDir !== path.dirname(pkgDir) && path.basename(pkgDir) !== 'web-tree-sitter') {
      pkgDir = path.dirname(pkgDir);
    }
    expect(path.basename(pkgDir), 'could not locate the web-tree-sitter package root').toBe('web-tree-sitter');

    const shipped = path.join(pkgDir, 'web-tree-sitter.wasm');

    expect(fs.existsSync(committed), `${committed} is missing`).toBe(true);
    expect(
      fs.existsSync(shipped),
      `${shipped} is missing — web-tree-sitter changed its layout, re-target this test`,
    ).toBe(true);

    const a = fs.readFileSync(committed);
    const b = fs.readFileSync(shipped);

    expect(
      a.equals(b),
      'resources/tree-sitter/tree-sitter.wasm is out of date with the installed ' +
        `web-tree-sitter (${a.length} vs ${b.length} bytes). Regenerate it:\n` +
        '  cp node_modules/web-tree-sitter/web-tree-sitter.wasm resources/tree-sitter/tree-sitter.wasm',
    ).toBe(true);
  });

  /**
   * patch-package writes the version into the filename, so a stale patch is
   * visible without parsing it — but only if something looks.
   */
  test('every patch file targets an installed package at the installed version', () => {
    const patchesDir = path.join(repoRoot, 'patches');
    if (!fs.existsSync(patchesDir)) return;

    const patches = fs.readdirSync(patchesDir).filter((f) => f.endsWith('.patch'));
    expect(patches.length, 'patches/ exists but is empty — delete it or add the patch back').toBeGreaterThan(0);

    for (const file of patches) {
      // e.g. "werift+0.24.4.patch"  or  "@scope+name+1.2.3.patch"
      const base = file.replace(/\.patch$/, '');
      const parts = base.split('+');
      const version = parts.pop()!;
      const pkg = parts.join('/').replace(/^@?/, (m, off) => (base.startsWith('@') ? '@' : m));

      const pkgJson = path.join(repoRoot, 'node_modules', pkg, 'package.json');
      expect(
        fs.existsSync(pkgJson),
        `patches/${file} targets "${pkg}", which is not installed. ` +
          'Delete the patch if the dependency is gone.',
      ).toBe(true);

      const installed = JSON.parse(fs.readFileSync(pkgJson, 'utf-8')).version;
      expect(
        installed,
        `patches/${file} was made for ${pkg}@${version} but ${installed} is installed. ` +
          `Regenerate it:\n  npx patch-package ${pkg}`,
      ).toBe(version);
    }
  });
});

/**
 * The mobile terminal bundle is generated, committed, and easy to forget.
 *
 * mobile/components/xterm-bundle.ts inlines xterm.js, addon-fit and the CSS
 * into a single HTML document so the terminal WebView works with no network.
 * scripts/gen-xterm-bundle.js builds it, and its own header says "re-run after
 * bumping the @xterm/* deps" — which is precisely the instruction that gets
 * missed, because nothing fails if you don't.
 *
 * Merge an @xterm bump without regenerating and package.json claims one
 * version while the app ships another. The xterm 5 -> 6 bump changed this file
 * from 301,894 to 507,134 bytes, so the drift is not subtle once you look —
 * the problem is that nobody looks.
 *
 * The generator is idempotent (verified), so the check is simply: regenerate
 * into a temp file and compare bytes.
 */
test.describe('Mobile xterm bundle', () => {
  test('mobile/components/xterm-bundle.ts is in sync with the installed @xterm packages', () => {
    const mobileDir = path.join(repoRoot, 'mobile');
    const bundle = path.join(mobileDir, 'components', 'xterm-bundle.ts');
    const generator = path.join(mobileDir, 'scripts', 'gen-xterm-bundle.js');

    // mobile/ has its own node_modules; skip rather than fail when only the
    // desktop tree is installed (CI installs them in separate jobs).
    if (!fs.existsSync(path.join(mobileDir, 'node_modules', '@xterm', 'xterm'))) {
      test.skip(true, 'mobile/node_modules not installed — nothing to compare against');
      return;
    }

    expect(fs.existsSync(bundle), `${bundle} is missing`).toBe(true);
    expect(fs.existsSync(generator), `${generator} is missing`).toBe(true);

    const before = fs.readFileSync(bundle);
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');

    try {
      execFileSync(process.execPath, [generator], { cwd: mobileDir, stdio: 'pipe' });
      const after = fs.readFileSync(bundle);
      expect(
        before.equals(after),
        'mobile/components/xterm-bundle.ts is out of date with the installed ' +
          `@xterm packages (${before.length} vs ${after.length} bytes). Regenerate it:\n` +
          '  cd mobile && node scripts/gen-xterm-bundle.js',
      ).toBe(true);
    } finally {
      // Never leave the working tree modified by a test.
      fs.writeFileSync(bundle, before);
    }
  });
});
