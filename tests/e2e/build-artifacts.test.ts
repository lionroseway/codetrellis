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
