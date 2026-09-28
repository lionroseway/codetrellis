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
 * that folder still exists.** Another checkout's copy is not imported over
 * it. If that copy differs, it is that workstream's change — which is what
 * the workstream footprint shows (A1.4), and what the plan list's "other
 * worktrees of this repo" reads from disk. When the holder's folder is gone
 * (moved, deleted), the next checkout to import takes the row over, as before.
 */

import fs from 'node:fs';
import path from 'node:path';

const canonical = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * True when `holder` is a different checkout from `importing` and still
 * exists, so an import from `importing` must leave the row alone.
 */
export function heldByAnotherCheckout(holder: string | null | undefined, importing: string): boolean {
  if (!holder || !path.isAbsolute(holder) || !fs.existsSync(holder)) return false;
  return canonical(holder) !== canonical(importing);
}
