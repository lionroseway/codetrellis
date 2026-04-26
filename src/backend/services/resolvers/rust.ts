import path from 'node:path';
import type { ResolverPlugin, ResolveContext } from './base';
import { findContainingSystem, tryExtensions } from './base';

/**
 * Rust resolver — minimum viable.
 *
 * Crate-relative resolution:
 *   - `crate::foo::bar` → resolve under the crate's `src/`
 *   - `super::foo`, `self::foo` → relative to importer
 *   - bare `extern_crate::...` → check Cargo workspace; skip if external
 */

const RS_EXTS = ['.rs'] as const;
const RS_MOD_SUFFIXES = ['/mod.rs'] as const;

const STD_PREFIXES = new Set(['std', 'core', 'alloc']);

function resolve(ctx: ResolveContext): string | null {
  const { importSource, importerPath, knownFiles, systems } = ctx;
  if (!importSource) return null;

  const segments = importSource.split('::').filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  const head = segments[0];

  if (STD_PREFIXES.has(head)) return null;

  const containing = findContainingSystem(importerPath, systems);

  // crate:: → from the crate root's src/
  if (head === 'crate') {
    if (!containing) return null;
    const crateRoot = path.join(containing.rootPath, 'src');
    const subpath = segments.slice(1, -1).join('/');
    const base = path.join(crateRoot, subpath);
    return tryExtensions(base, knownFiles, [...RS_EXTS, ...RS_MOD_SUFFIXES])
        ?? tryExtensions(path.join(crateRoot, 'lib'), knownFiles, RS_EXTS);
  }

  if (head === 'self' || head === 'super') {
    const importerDir = path.dirname(importerPath);
    let baseDir = importerDir;
    if (head === 'super') baseDir = path.dirname(importerDir);
    const tail = segments.slice(1).join('/');
    return tryExtensions(path.join(baseDir, tail), knownFiles, [...RS_EXTS, ...RS_MOD_SUFFIXES]);
  }

  // External crate name → check if it's a sibling crate in the same Cargo workspace
  for (const sys of systems) {
    if (sys.language !== 'rust') continue;
    if (sys.name === head || sys.packageName === head) {
      const crateRoot = path.join(sys.rootPath, 'src');
      const subpath = segments.slice(1).join('/');
      return tryExtensions(path.join(crateRoot, subpath), knownFiles, [...RS_EXTS, ...RS_MOD_SUFFIXES])
          ?? tryExtensions(path.join(crateRoot, 'lib'), knownFiles, RS_EXTS);
    }
  }

  return null;
}

export const rustResolver: ResolverPlugin = {
  languages: ['rust'],
  resolve,
};
