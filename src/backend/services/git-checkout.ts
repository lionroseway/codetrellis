/**
 * Facts about the git checkout at a project root, read from disk the way
 * git lays it out — including in a linked worktree.
 *
 * WHY THIS EXISTS
 *
 * In a linked worktree `.git` is a FILE (`gitdir: <common>/worktrees/x`),
 * not a directory, so `path.join(root, '.git', 'HEAD')` does not exist.
 * Everything that read it that way — the branch in the TopBar, the
 * recent-projects entry, `/api/git/info`, merge-conflict detection, the
 * manifest commit — reported no branch, "no commits", no conflict, or
 * failed outright from any worktree, which is exactly where parallel
 * agents work (Phase 32 §0.4a). Listing `refs/heads/` also missed every
 * packed ref, which is where a clone or `git gc` keeps branches.
 *
 * WHY FILE READS, NOT `git`
 *
 * `/api/auto-detect` asks this about directories named in Claude Code's
 * session files, which are not opened projects; reading two small files
 * there is fine, running git there is not something to add. And git
 * refuses a repository owned by another user (`safe.directory`), which
 * would blank the branch chip where the plain read worked. The layout
 * read here — the `.git` file, `commondir`, HEAD, loose and packed refs —
 * is git's documented on-disk format (gitrepository-layout). The reftable
 * backend is not read; neither was it before.
 */

import fs from 'node:fs';
import path from 'node:path';

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * This checkout's own git dir, absolute: `<root>/.git` for a main
 * checkout, `<common>/worktrees/<name>` for a linked one. Per-checkout
 * state (HEAD, MERGE_HEAD, index) lives here. Null when `root` has no
 * `.git` of its own — including a subdirectory of a repository, as before.
 */
export function checkoutGitDir(root: string): string | null {
  const dotGit = path.resolve(root, '.git');
  let st: fs.Stats;
  try {
    st = fs.statSync(dotGit);
  } catch {
    return null;
  }
  let dir: string;
  if (st.isDirectory()) {
    dir = dotGit;
  } else if (st.isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dotGit) ?? '');
    if (!m) return null;
    dir = path.resolve(root, m[1]);
  } else {
    return null;
  }
  return fs.existsSync(path.join(dir, 'HEAD')) ? dir : null;
}

/** Where refs and objects live: the main `.git`, shared by every worktree. */
function commonGitDir(gitDir: string): string {
  const rel = readText(path.join(gitDir, 'commondir'))?.trim();
  return rel ? path.resolve(gitDir, rel) : gitDir;
}

/** HEAD's symbolic ref (`refs/heads/x`), or null when detached / unreadable. */
function headRef(gitDir: string): { ref: string | null; detached: boolean } | null {
  const head = readText(path.join(gitDir, 'HEAD'))?.trim();
  if (!head) return null;
  const m = /^ref:\s*(refs\/\S+)$/.exec(head);
  // The ref is joined onto the common dir below; a HEAD naming `..` is
  // not one git would write, and is treated as unreadable.
  if (m) return m[1].split('/').includes('..') ? null : { ref: m[1], detached: false };
  return /^[0-9a-f]{40,64}$/.test(head) ? { ref: null, detached: true } : null;
}

/** `refs/heads/<name>` entries in packed-refs, as full ref names. */
function packedRefs(commonDir: string): Set<string> {
  const out = new Set<string>();
  for (const line of (readText(path.join(commonDir, 'packed-refs')) ?? '').split('\n')) {
    // "<sha> <ref>"; '#' is the header, '^' a peeled tag line.
    const m = /^[0-9a-f]{40,64} (refs\/\S+)$/.exec(line.trim());
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * The checked-out branch's short name, `'detached'` when HEAD is not on a
 * branch, null when `root` is not a checkout. A branch with no commits
 * yet still has a name.
 */
export function currentBranch(root: string): string | null {
  const gitDir = checkoutGitDir(root);
  if (!gitDir) return null;
  const head = headRef(gitDir);
  if (!head) return null;
  if (head.detached) return 'detached';
  return head.ref!.replace(/^refs\/heads\//, '');
}

/** Local branch names, loose and packed alike, sorted. */
export function localBranches(root: string): string[] {
  const gitDir = checkoutGitDir(root);
  if (!gitDir) return [];
  const common = commonGitDir(gitDir);
  const names = new Set<string>();
  for (const ref of packedRefs(common)) {
    if (ref.startsWith('refs/heads/')) names.add(ref.slice('refs/heads/'.length));
  }
  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
      else if (e.isFile()) names.add(`${prefix}${e.name}`);
    }
  };
  walk(path.join(common, 'refs', 'heads'), '');
  return [...names].sort();
}

/** Does HEAD point at a commit? False for a fresh repo, or no repo. */
export function hasCommits(root: string): boolean {
  const gitDir = checkoutGitDir(root);
  if (!gitDir) return false;
  const head = headRef(gitDir);
  if (!head) return false;
  if (head.detached) return true;
  const common = commonGitDir(gitDir);
  return fs.existsSync(path.join(common, head.ref!)) || packedRefs(common).has(head.ref!);
}
