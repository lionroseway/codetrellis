/**
 * Which checkout a doc or plan belongs to, when several carry it (Phase 32
 * A1.7b, bug 46).
 *
 * A system doc or plan lives in the repository, so every checkout of it — a
 * linked worktree, another clone, a copy — carries the same file with the
 * same uid, and rows are keyed by uid. Importing from a second checkout used
 * to rewrite the row: a doc moved to the worktree (the main checkout then
 * listed none of its docs), and a plan kept its root but took the worktree's
 * title, status and items.
 *
 * The rule, for both: **a row belongs to the checkout that holds it while
 * that folder still exists.** Another checkout *of the same repository* — a
 * linked worktree (same git common dir) or a clone (same origin) — does not
 * import its copy over it. A folder that is not the same repository is not a
 * second checkout: importing there is a deliberate move (a teammate's export,
 * a copied plan dir) and takes the row over, as it always did. If that copy differs, it is that workstream's change — which is what
 * the workstream footprint shows (A1.4), and what the plan list's "other
 * worktrees of this repo" reads from disk. When the holder's folder is gone
 * (moved, deleted), the next checkout to import takes the row over, as before.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getNormalisedOriginUrl } from './git-identity';

const canonical = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

/** The repository's shared git dir, when `folder` is itself a checkout (not a folder inside one). */
function commonDir(folder: string): string | null {
  if (!fs.existsSync(path.join(folder, '.git'))) return null;
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: folder, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? canonical(path.resolve(folder, out)) : null;
  } catch {
    return null;
  }
}

/** Two checkouts of one repository: worktrees of it, or clones of the same origin. */
export function sameRepository(a: string, b: string): boolean {
  const common = commonDir(a);
  if (common && common === commonDir(b)) return true;
  const origin = getNormalisedOriginUrl(a);
  return !!origin && origin === getNormalisedOriginUrl(b);
}

/**
 * True when `holder` is another checkout of the same repository as
 * `importing` and still exists, so an import from `importing` must leave the
 * row alone.
 */
export function heldByAnotherCheckout(holder: string | null | undefined, importing: string): boolean {
  if (!holder || !path.isAbsolute(holder) || !fs.existsSync(holder)) return false;
  if (canonical(holder) === canonical(importing)) return false;
  return sameRepository(holder, importing);
}
