import fs from 'node:fs';
import path from 'node:path';
import type { ResolverPlugin, ResolveContext } from './base';
import { pickRepresentativeFile } from './base';
import type { DiscoveredSystem } from '../../../shared/types';

/**
 * Go resolver — Phase 20.
 *
 * See [docs/PHASE-20-GO-SUPPORT.md](../../../../docs/PHASE-20-GO-SUPPORT.md).
 *
 * Go import paths are **module-qualified**, not filesystem-relative —
 * the opposite of every other resolver here. So `findContainingSystem`
 * is deliberately NOT used: an import resolves against whichever
 * module declares its prefix, which is frequently not the module the
 * importing file lives in.
 *
 *   go.mod:  module github.com/org/billing
 *   import:  github.com/org/billing/internal/ledger
 *            └──────── module ────────┘└─── pkg ───┘
 *   → <dir holding that go.mod>/internal/ledger/<a .go file>
 *
 * `system-discovery` already parses the `module` line of every
 * `go.mod` it finds into `packageName`, so the module index is built
 * from `ctx.systems` with no file reads. The one thing it does not
 * capture is `replace` directives, which monorepos use to wire sibling
 * modules together — those are read here, cached per manifest.
 *
 * `go.work` needs no handling: its `use` directives point at
 * directories that each contain their own `go.mod`, so they are
 * already discovered as systems in their own right.
 *
 * Go imports a *package* (a directory), not a file. The graph model
 * wants one edge per import, so we resolve to a single representative
 * file in that directory — see `pickPackageFile`.
 */

interface ModuleEntry {
  /** Declared module path, e.g. `github.com/org/billing` (or `…/v2`). */
  modulePath: string;
  /** Absolute directory that module path maps to. */
  rootPath: string;
}

// `replace` parsing is keyed by go.mod path + mtime so an edited
// manifest is picked up on the next scan without a restart.
const replaceCache = new Map<string, { mtimeMs: number; entries: ModuleEntry[] }>();

/**
 * `replace github.com/org/x => ../x` and the grouped `replace ( … )`
 * form. Only local-path targets matter: a replace pointing at another
 * *module version* is still an external dependency.
 */
function readReplaceDirectives(manifestPath: string): ModuleEntry[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(manifestPath);
  } catch {
    return [];
  }

  const cached = replaceCache.get(manifestPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.entries;

  let raw = '';
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch {
    return [];
  }

  const dir = path.dirname(manifestPath);
  const entries: ModuleEntry[] = [];

  // Matches both `replace a => ./b` and the bodies of a grouped
  // `replace ( a => ./b \n c => ../d )` block, since every line inside
  // the group has the same `x => y` shape.
  const LINE_RE = /^\s*(?:replace\s+)?(\S+?)(?:\s+v\S+)?\s*=>\s*(\S+)(?:\s+v\S+)?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = LINE_RE.exec(raw))) {
    const [, from, to] = m;
    if (from === 'replace' || from.startsWith('//')) continue;
    // Only local paths — `./x`, `../x`, or absolute.
    if (!to.startsWith('.') && !path.isAbsolute(to)) continue;
    entries.push({ modulePath: from, rootPath: path.resolve(dir, to) });
  }

  replaceCache.set(manifestPath, { mtimeMs: stat.mtimeMs, entries });
  return entries;
}

function buildModuleIndex(systems: ReadonlyArray<DiscoveredSystem>): ModuleEntry[] {
  const entries: ModuleEntry[] = [];

  for (const sys of systems) {
    if (sys.manifestKind !== 'go.mod') continue;
    const modulePath = sys.packageName || sys.name;
    if (modulePath) entries.push({ modulePath, rootPath: sys.rootPath });
    if (sys.manifestPath) entries.push(...readReplaceDirectives(sys.manifestPath));
  }

  // Longest module path first: nested modules are legal, and the most
  // specific declaration must win.
  entries.sort((a, b) => b.modulePath.length - a.modulePath.length);
  return entries;
}

/**
 * Go imports a directory. Pick one file to carry the edge: prefer a
 * file named after the package directory (the dominant convention),
 * then any non-test file.
 *
 * The directory index this walks is shared with the other
 * directory-importing languages — see `pickRepresentativeFile`.
 */
function pickPackageFile(dir: string, knownFiles: Set<string>): string | null {
  return pickRepresentativeFile(dir, knownFiles, {
    extensions: ['.go'],
    prefer: path.basename(dir),
    deprioritize: (file) => file.endsWith('_test.go'),
  });
}

/**
 * There is deliberately no stdlib pre-filter here.
 *
 * There was: "no dot in the first segment" (`fmt`, `net/http`), on the
 * grounds that every module path is domain-prefixed. That is a
 * convention, not a rule — `go mod init billing` is legal and common in
 * internal repositories — and the filter ran BEFORE the module index,
 * so a project whose own module is dotless resolved none of its own
 * imports. It failed silently, as an absence of edges.
 *
 * The index is authoritative instead: a prefix that matches a module
 * this project declares is by definition not stdlib. Anything the index
 * does not claim returns null, which is where the real stdlib imports
 * end up — the same answer, without the assumption.
 */
function resolve(ctx: ResolveContext): string | null {
  const { importSource, knownFiles, systems } = ctx;
  if (!importSource) return null;

  const index = buildModuleIndex(systems);

  for (const entry of index) {
    if (importSource !== entry.modulePath && !importSource.startsWith(entry.modulePath + '/')) {
      continue;
    }

    const remainder = importSource.slice(entry.modulePath.length).replace(/^\//, '');
    const dir = remainder ? path.join(entry.rootPath, remainder) : entry.rootPath;

    const hit = pickPackageFile(dir, knownFiles);
    if (hit) return hit;
    // Prefix matched but the directory holds no known .go file — an
    // external dependency that happens to share a prefix, or a package
    // outside the scan. Keep looking at shorter prefixes.
  }

  return null;
}

export const goResolver: ResolverPlugin = {
  languages: ['go'],
  resolve,
};
