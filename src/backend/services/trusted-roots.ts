/**
 * Which directories this process is willing to treat as a project root
 * (Phase 19, Gate 2.2).
 *
 * THE AMPLIFIER THIS REMOVES
 *
 * Several findings were only as severe as they were because the ROOT itself
 * came from the request. An endpoint that accepts `projectRoot` in its body
 * and then carefully confines a path beneath it has confined nothing: the
 * caller chose the root, so every path is "inside" it by construction.
 *
 * `confined-fs` deliberately does not police this — a root from a request
 * body passes every check in that module. The two halves are different
 * questions:
 *
 *     confined-fs   is this path inside that root?
 *     this module   is that root one we actually opened?
 *
 * Both are needed. Neither substitutes for the other.
 *
 * WHAT COUNTS AS TRUSTED
 *
 * A root the USER opened, not one a caller named:
 *
 *   - the active project (whatever was last scanned);
 *   - any project in the recent-projects list, which is only written by
 *     `recordProjectOpen` when a project is genuinely opened;
 *   - the project a stored plan or item belongs to, for callers that
 *     legitimately work from a plan rather than from an open project.
 *
 * A caller supplying a path that matches one of those is not choosing a
 * root — it is naming one the user already chose, which is exactly what a
 * multi-project UI needs to do.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalRoot, ConfinementError } from './confined-fs';
import { listRecentProjects } from './recent-projects-service';

/**
 * Canonicalise for comparison, tolerating a path that no longer exists.
 *
 * A project can be deleted or unmounted while it is still in the recent
 * list, and that must not throw while we are merely comparing candidates.
 */
function canonicaliseForCompare(p: string): string | null {
  try {
    return fs.realpathSync.native(path.resolve(p));
  } catch {
    return null;
  }
}

/**
 * The active project, published by the backend rather than imported from it.
 *
 * A static import of `server.ts` here would be a cycle (server imports the
 * services, the services would import server), and the repo's bundle guard
 * forbids the lazy `require('../server')` that would dodge it — a relative
 * runtime require survives typecheck and throws MODULE_NOT_FOUND in the
 * packaged app. Inverting the dependency is cheaper than either.
 */
let activeProjectRoot: string | null = null;

/** Called by the backend whenever the active project changes. */
export function setActiveProjectRoot(projectPath: string | null): void {
  activeProjectRoot = projectPath;
}

/**
 * The project the user is looking at, or null.
 *
 * Exposed for the write paths that CREATE something belonging to a
 * project without being handed one — importing a ticket tree, importing
 * a conversation. Those used to store an empty project path, which is
 * not "unknown" but "belongs to nowhere": every project-scoped feature
 * on such a plan (drift, review comparands, git context) then degraded
 * silently, and the plan looked normal while answering nothing.
 *
 * A caller-supplied `project_path` still wins — this is the fallback,
 * and it is exactly the root the confinement check already trusts.
 */
export function getActiveProjectRoot(): string | null {
  return activeProjectRoot;
}

/** Everything this process currently considers an opened project. */
export function listTrustedRoots(): string[] {
  const roots = new Set<string>();
  if (activeProjectRoot) roots.add(activeProjectRoot);

  // The recent-projects list lives in the database, which is not up during
  // early startup. Failing here would 500 every confined endpoint rather than
  // deny cleanly — and degrading to "the active project only" is STRICTER, not
  // looser, so it is a safe fallback rather than a fail-open one.
  try {
    for (const p of listRecentProjects()) {
      if (p?.path) roots.add(p.path);
    }
  } catch (err) {
    console.warn('[TrustedRoots] Recent projects unavailable, using the active project only:', err);
  }

  return [...roots];
}

/**
 * Turn a caller-supplied project path into a trusted, canonical root.
 *
 * Throws unless it matches a project the user actually opened. The caller
 * must use the RETURNED value — it is canonical, so a later comparison
 * cannot be fooled by a link or a `..` that normalises differently.
 *
 * `allowAbsent` exists for the narrow case of a project that has been
 * deleted from disk but whose plans are still being read; it relaxes the
 * existence requirement, never the membership one.
 */
export function resolveTrustedProjectRoot(
  candidate: unknown,
  label = 'projectRoot',
  opts: { allowAbsent?: boolean } = {},
): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new ConfinementError(`${label}: a project path is required`);
  }

  const canonCandidate = canonicaliseForCompare(candidate);
  if (!canonCandidate) {
    if (opts.allowAbsent) {
      // Still has to be a known project — absence is forgiven, membership
      // is not.
      const lexical = path.resolve(candidate);
      const known = listTrustedRoots().some((r) => path.resolve(r) === lexical);
      if (known) return lexical;
    }
    throw new ConfinementError(
      `${label}: "${candidate}" does not exist or cannot be resolved`,
    );
  }

  for (const root of listTrustedRoots()) {
    const canonRoot = canonicaliseForCompare(root);
    if (canonRoot && canonRoot === canonCandidate) {
      // Re-canonicalise through confined-fs so callers get a value produced
      // by the same code path that will later police paths beneath it.
      return canonicalRoot(canonCandidate);
    }
  }

  throw new ConfinementError(
    `${label}: "${candidate}" is not an opened project. ` +
      'Project roots are derived from the projects this app has opened, not from the request.',
  );
}

/**
 * A plan directory an import may read: `<opened project>/.codetrellis/plans/<slug>`.
 *
 * Import took this path from the caller (REST body or query, an MCP
 * argument, a paired phone's RPC) and read whatever was there. Compared
 * on the REAL path, so a symlinked slug or `.codetrellis` that resolves
 * elsewhere does not match. Accepts the directory or its `plan.yaml`.
 * Returns the canonical directory.
 */
export function resolveTrustedPlanDir(candidate: unknown, label = 'planDir'): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new ConfinementError(`${label}: a plan directory is required`);
  }
  const dir = /[\\/]plan\.ya?ml$/.test(candidate) ? path.dirname(candidate) : candidate;
  let canon: string;
  try {
    canon = fs.realpathSync.native(path.resolve(dir));
  } catch {
    throw new ConfinementError(`${label}: "${candidate}" does not exist or cannot be resolved`);
  }
  for (const root of listTrustedRoots()) {
    const canonRoot = canonicaliseForCompare(root);
    if (canonRoot && path.dirname(canon) === path.join(canonRoot, '.codetrellis', 'plans')) return canon;
  }
  throw new ConfinementError(
    `${label}: "${candidate}" is not a plan directory (.codetrellis/plans/<slug>) of a project this app has opened.`,
  );
}

export function isTrustedPlanDir(candidate: unknown): boolean {
  try {
    resolveTrustedPlanDir(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Non-throwing form, for callers that want to fall back rather than fail. */
export function isTrustedProjectRoot(candidate: unknown): boolean {
  try {
    resolveTrustedProjectRoot(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make a stored absolute path relative to a project root, tolerating the
 * difference between the path the user OPENED and its canonical form.
 *
 * These drift apart by design. `scan` is exempt from confinement — it is how a
 * path becomes a project — so rows are written under whatever the user typed,
 * e.g. `/tmp/demo`. Every confined handler then resolves through
 * `resolveTrustedProjectRoot`, which returns the REALPATH: `/private/tmp/demo`
 * on macOS, because /tmp is a symlink. A plain `path.relative` between the two
 * yields `../../tmp/demo/src/a.ts`, which matches nothing — so diff, compare,
 * review and playback reported every file as removed AND re-added for any
 * project opened through a symlink. On macOS that is anything under /tmp.
 *
 * Reconciled on the READ side deliberately. Canonicalising at scan time would
 * be tidier and would silently orphan every row in every existing database
 * until the user rescanned — that is a migration, not a bug fix.
 */
export function projectRelative(projectRoot: string, absPath: string): string {
  if (!path.isAbsolute(absPath)) return absPath;

  const canonical = (() => {
    try { return canonicalRoot(projectRoot); } catch { return path.resolve(projectRoot); }
  })();

  // The canonical form, plus every opened path that resolves to it.
  const aliases = [projectRoot, canonical];
  for (const root of listTrustedRoots()) {
    try {
      if (canonicalRoot(root) === canonical) aliases.push(root);
    } catch { /* a project that has gone from disk cannot contain anything */ }
  }

  for (const root of aliases) {
    if (absPath === root) return '';
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (absPath.startsWith(prefix)) return path.relative(root, absPath);
  }
  return path.relative(projectRoot, absPath);
}
