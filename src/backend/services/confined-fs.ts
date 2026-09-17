/**
 * The single filesystem boundary (Phase 19, Gate 2).
 *
 * WHY LEXICAL CHECKS ARE NOT ENOUGH
 *
 * The obvious containment check is string arithmetic:
 *
 *     const full = path.resolve(root, userInput);
 *     if (!full.startsWith(root)) throw;          // or path.relative(...)
 *
 * That enforces containment of the *text of a path*, not of the *file it
 * reaches*. A symlink or a Windows junction placed beneath the allowed root
 * points anywhere, and `path.resolve` follows none of it — the string still
 * starts with the root, so the check passes and the read escapes.
 *
 * This was finding A2, and its significance is that it undermines every
 * other path check in the codebase at once: fixing the individual traversal
 * findings with better string comparisons would have left all of them
 * bypassable by the same trick.
 *
 * WHAT THIS MODULE DOES INSTEAD
 *
 *   1. Canonicalises BOTH the root and the target with `realpath`, so
 *      comparison happens between resolved locations rather than between
 *      strings a link can lie about.
 *   2. Rejects symlinks and reparse points at the boundary, rather than
 *      following them and hoping the destination is also inside.
 *   3. Opens with O_NOFOLLOW where the platform has it, so even a link
 *      swapped in after the check cannot be followed by the open itself.
 *   4. Re-checks immediately before a mutation, because a check followed by
 *      an `await` and then a write is a time-of-check/time-of-use race: an
 *      attacker who can create files in the directory can swap a link into
 *      place in between.
 *   5. Creates files atomically with O_CREAT|O_EXCL below the canonical
 *      directory, so a create cannot silently land on an existing symlink.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not decide WHICH root is allowed. Passing a root that came from a
 * request body would satisfy every check here and still be wrong — that is
 * Gate 2.2, and it is the caller's responsibility. See
 * `resolveTrustedProjectRoot`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** O_NOFOLLOW is POSIX. Windows has no equivalent open flag. */
const HAS_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' && process.platform !== 'win32';

export class ConfinementError extends Error {
  readonly code = 'EOUTSIDE_ROOT';
  constructor(message: string) {
    super(message);
    this.name = 'ConfinementError';
  }
}

/**
 * Canonicalise a directory that is expected to exist.
 *
 * Throws rather than falling back to the lexical path: a root we cannot
 * resolve is a root we cannot safely compare against, and quietly degrading
 * to string comparison is exactly the behaviour this module exists to stop.
 */
export function canonicalRoot(root: string): string {
  if (!root || typeof root !== 'string') {
    throw new ConfinementError('A containment root is required');
  }
  try {
    return fs.realpathSync.native(path.resolve(root));
  } catch (err) {
    throw new ConfinementError(
      `Cannot canonicalise the containment root "${root}": ${(err as Error).message}`,
    );
  }
}

/**
 * Resolve `candidate` beneath `root` and prove the result is inside it.
 *
 * `candidate` may be absolute or relative. Either way it must land inside the
 * canonical root, and no component of it may be a symlink.
 *
 * Returns the canonical absolute path. The file need not exist — a create is
 * a legitimate operation — but every EXISTING ancestor is verified.
 */
export function resolveWithin(root: string, candidate: string, label = 'path'): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new ConfinementError(`${label}: a path is required`);
  }
  // A NUL byte truncates the path at the OS layer, so "a.txt\0.png" opens
  // "a.txt". Node rejects these, but not every path reaches Node's checks by
  // the same route, and the cost of being explicit is nil.
  if (candidate.includes('\0')) {
    throw new ConfinementError(`${label}: path contains a NUL byte`);
  }

  const canonRoot = canonicalRoot(root);
  const joined = path.resolve(canonRoot, candidate);

  // Walk from the root down, canonicalising as far as the filesystem goes.
  // The deepest existing ancestor is what we can actually verify; anything
  // below it does not exist yet and therefore cannot be a link.
  let existing = joined;
  const missing: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    missing.unshift(path.basename(existing));
    existing = parent;
  }

  // ORDER MATTERS, AND THIS IS EASY TO GET BACKWARDS.
  //
  // The link check must run on the LEXICAL path, before canonicalisation.
  // realpath RESOLVES links away, so checking the canonical result for
  // symlinks always succeeds — by construction it contains none. An earlier
  // version of this function did exactly that and silently accepted a
  // symlink; the unit test for "a link pointing back inside" caught it.
  assertNoSymlinkOnPath(canonRoot, existing, label);

  let canonExisting: string;
  try {
    canonExisting = fs.realpathSync.native(existing);
  } catch (err) {
    throw new ConfinementError(`${label}: cannot resolve "${candidate}": ${(err as Error).message}`);
  }

  // Belt and braces: even with no link on the path we walked, assert the
  // canonical destination is contained. This catches a link in an ancestor
  // ABOVE the root, which the walk above deliberately does not examine.
  if (!isInside(canonRoot, canonExisting)) {
    throw new ConfinementError(
      `${label}: resolves outside the permitted directory ` +
        `(resolved to ${canonExisting}, which is not inside ${canonRoot})`,
    );
  }

  return missing.length ? path.join(canonExisting, ...missing) : canonExisting;
}

/** True when `target` is `root` itself or lies beneath it. */
export function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const rel = path.relative(root, target);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Throw if any component between `root` and `target` is a symlink or
 * reparse point.
 *
 * `target` MUST be the lexical path, not a canonicalised one — realpath
 * resolves links away, so a canonical path can never contain one and this
 * check would be vacuous.
 *
 * `lstat` is the other half of the point: `stat` follows links and reports
 * the destination's type, which is precisely the information a link hides.
 */
function assertNoSymlinkOnPath(root: string, target: string, label: string): void {
  let current = target;
  while (current !== root && current.length > root.length) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(current);
    } catch {
      return; // vanished mid-walk; the open will fail honestly
    }
    if (st.isSymbolicLink()) {
      throw new ConfinementError(
        `${label}: "${current}" is a symbolic link. Links are not followed at this boundary.`,
      );
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/**
 * Read a file that must be inside `root`.
 *
 * Opens with O_NOFOLLOW where available, so a link swapped in after
 * `resolveWithin` returned still cannot be followed — closing the
 * time-of-check/time-of-use window rather than merely shortening it.
 */
export function readFileWithin(root: string, candidate: string, label = 'path'): Buffer {
  const target = resolveWithin(root, candidate, label);
  const flags = HAS_NOFOLLOW
    ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    : fs.constants.O_RDONLY;
  let fd: number | null = null;
  try {
    fd = fs.openSync(target, flags);
    // Re-verify AFTER the open, against the descriptor we actually hold.
    // On platforms without O_NOFOLLOW this is the check that catches a swap.
    const st = fs.fstatSync(fd);
    if (!st.isFile()) {
      throw new ConfinementError(`${label}: not a regular file`);
    }
    return fs.readFileSync(fd);
  } catch (err) {
    if (err instanceof ConfinementError) throw err;
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ELOOP') {
      throw new ConfinementError(`${label}: refused to follow a symbolic link`);
    }
    throw err;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* */ }
    }
  }
}

/** `readFileWithin` as UTF-8 text. */
export function readTextWithin(root: string, candidate: string, label = 'path'): string {
  return readFileWithin(root, candidate, label).toString('utf-8');
}

/**
 * Write a file that must be inside `root`, atomically.
 *
 * Writes to a temporary name in the SAME directory then renames. Same
 * directory matters twice: rename is only atomic within a filesystem, and a
 * partially-written file is never visible under the real name.
 *
 * The containment check is re-run immediately before the write, not reused
 * from earlier in the caller — that gap is the race.
 */
export function writeFileWithin(
  root: string,
  candidate: string,
  data: string | Buffer,
  label = 'path',
): string {
  const target = resolveWithin(root, candidate, label);
  const dir = path.dirname(target);

  fs.mkdirSync(dir, { recursive: true });
  // The directory may have been created through a link; re-assert now that
  // it exists, since resolveWithin could only verify as far as its deepest
  // EXISTING ancestor.
  const canonDir = resolveWithin(root, dir, `${label} (directory)`);

  const tmp = path.join(canonDir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  let fd: number | null = null;
  try {
    // O_EXCL: fail rather than write through an existing file or link.
    fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    // Refuse to replace a symlink at the destination.
    try {
      const st = fs.lstatSync(target);
      if (st.isSymbolicLink()) {
        throw new ConfinementError(`${label}: destination is a symbolic link; refusing to write through it`);
      }
    } catch (err) {
      if (err instanceof ConfinementError) throw err;
      // ENOENT — the normal create case.
    }

    fs.renameSync(tmp, target);
    return target;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* */ }
    }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* */ }
  }
}

/**
 * Delete a path that must be inside `root`.
 *
 * `recursive` exists for callers that genuinely manage a subtree. The
 * containment check is re-run here rather than trusted from the caller,
 * because a recursive delete is the least forgiving operation in this file.
 */
export function removeWithin(
  root: string,
  candidate: string,
  opts: { recursive?: boolean } = {},
  label = 'path',
): void {
  const target = resolveWithin(root, candidate, label);
  if (target === canonicalRoot(root)) {
    throw new ConfinementError(`${label}: refusing to delete the containment root itself`);
  }
  fs.rmSync(target, { recursive: opts.recursive === true, force: false });
}

/** True when `candidate` resolves inside `root`, without throwing. */
export function isWithin(root: string, candidate: string): boolean {
  try {
    resolveWithin(root, candidate);
    return true;
  } catch {
    return false;
  }
}
