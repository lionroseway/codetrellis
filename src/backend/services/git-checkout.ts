/**
 * Facts about the git checkout at a project root, asked of git.
 *
 * WHY NOT READ `.git` BY HAND
 *
 * In a linked worktree `.git` is a FILE (`gitdir: <common>/worktrees/x`),
 * not a directory, so `path.join(root, '.git', 'HEAD')` does not exist.
 * Everything that read it that way — the branch in the TopBar, the
 * recent-projects entry, `/api/git/info`, merge-conflict detection, the
 * manifest commit — reported no branch, "no commits", no conflict, or
 * failed outright from any worktree, which is exactly where parallel
 * agents work (Phase 32 §0.4a). Branches under `refs/heads/` also miss
 * every packed ref, which is where a clone or `git gc` keeps them.
 *
 * git answers all of these the same way from every checkout, so this
 * module asks it. Callers pass an opened (confined) project root; git runs
 * with `-C <root>` via execFile — no shell, and no caller-supplied
 * arguments reach git from here.
 */

import { execFileSync } from 'node:child_process';

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
  } catch {
    return null;
  }
}

/**
 * This checkout's own git dir, absolute: `<root>/.git` for a main
 * checkout, `<common>/worktrees/<name>` for a linked one. Per-checkout
 * state (HEAD, MERGE_HEAD, index) lives here. Null when not a repo.
 */
export function checkoutGitDir(root: string): string | null {
  return git(root, ['rev-parse', '--absolute-git-dir'])?.trim() || null;
}

/**
 * The checked-out branch's short name, `'detached'` when HEAD is not on a
 * branch, null when `root` is not in a repository. A branch with no
 * commits yet still has a name.
 */
export function currentBranch(root: string): string | null {
  const name = git(root, ['symbolic-ref', '-q', '--short', 'HEAD'])?.trim();
  if (name) return name;
  return checkoutGitDir(root) ? 'detached' : null;
}

/** Local branch names, loose and packed alike. */
export function localBranches(root: string): string[] {
  const out = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

/** Does HEAD resolve to a commit? False for a fresh repo, or no repo. */
export function hasCommits(root: string): boolean {
  return !!git(root, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'])?.trim();
}
