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

/** Everything this process currently considers an opened project. */
export function listTrustedRoots(): string[] {
  const roots = new Set<string>();
  if (activeProjectRoot) roots.add(activeProjectRoot);
  for (const p of listRecentProjects()) {
    if (p?.path) roots.add(p.path);
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

/** Non-throwing form, for callers that want to fall back rather than fail. */
export function isTrustedProjectRoot(candidate: unknown): boolean {
  try {
    resolveTrustedProjectRoot(candidate);
    return true;
  } catch {
    return false;
  }
}
