/**
 * Each workstream's own commits, for its Timeline lane (Phase 32 B2.2):
 * ◆ a commit, ◆◆ a merge.
 *
 * "Its own" means what is on it and not on main: a worktree's commits since
 * its merge base, a branch's since its. The main checkout's lane shows main's
 * recent commits. So a commit shows once, on the lane it was made on, not on
 * every lane that branched after it.
 *
 * Folders and refs come from `listWorkstreams`, never from a caller. Git runs
 * with `execFile`, `-C <folder>` and fixed arguments; a range is built only
 * from two full SHAs, and a ref is checked by `git-safety` first.
 */

import { execFileSync } from 'node:child_process';
import type { Workstream, WorkstreamCommit } from '../../shared/types';
import { isSafeGitRef } from './git-safety';

export type { WorkstreamCommit };

/** At most this many per lane: the lane is a summary, not the log. */
export const MAX_COMMITS = 50;

const SHA = /^[0-9a-f]{40}$/;
const RS = '\x1e';
const US = '\x1f';
const FORMAT = `--format=%H${US}%P${US}%cI${US}%aN${US}%s${US}%b${RS}`;

function git(folder: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', folder, ...args], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** `git log` output in FORMAT, as commits. */
export function parseCommits(raw: string): WorkstreamCommit[] {
  return raw.split(RS).map((r) => r.replace(/^\n+/, '')).filter(Boolean).flatMap((record) => {
    const [sha, parents, at, author, subject, body = ''] = record.split(US);
    if (!sha || !SHA.test(sha.trim())) return [];
    const agent = body.match(/^agent:\s*(\S+)/m)?.[1] ?? null;
    return [{
      sha: sha.trim(), at: Date.parse(at), author: author ?? '', subject: subject ?? '',
      merge: (parents ?? '').trim().split(/\s+/).filter(Boolean).length > 1, agent,
    }];
  });
}

/**
 * A workstream's own commits since `sinceMs`, newest first.
 * `mainPath` is the main checkout's folder, where a branch workstream's ref is read.
 */
export function commitsOf(w: Workstream, mainPath: string, sinceMs: number): WorkstreamCommit[] {
  const since = `--since=@${Math.floor(sinceMs / 1000)}`;
  const common = [since, `--max-count=${MAX_COMMITS}`, FORMAT];
  let raw: string | null;
  if (w.main) {
    raw = git(w.root, ['log', 'HEAD', ...common]);
  } else if (w.root.startsWith('branch:')) {
    const head = w.head && SHA.test(w.head) ? w.head : null;
    const base = w.changes?.base && SHA.test(w.changes.base) ? w.changes.base : null;
    if (!head) {
      if (!w.ref || !isSafeGitRef(w.ref)) return [];
      raw = git(mainPath, ['log', w.ref, ...common]);
    } else {
      raw = git(mainPath, ['log', base ? `${base}..${head}` : head, ...common]);
    }
  } else {
    const base = w.changes?.base && SHA.test(w.changes.base) ? w.changes.base : null;
    raw = git(w.root, ['log', base ? `${base}..HEAD` : 'HEAD', ...common]);
  }
  return raw ? parseCommits(raw) : [];
}

/** Every workstream's own commits since `sinceMs`, by root. */
/**
 * One workstream's commits change only when its head or its merge base
 * moves, so each is kept, by both, and reused (Phase 32 E1): the window
 * asked on every file change in any worktree, and each answer was a `git
 * log` per workstream, synchronously, seconds on a repository with many
 * branches, while the requests piled up behind it. A kept answer is reused
 * for a window that starts no earlier than the one it was read for, and for
 * at most KEEP_MS (a head without a sha, the main checkout's, can move
 * unseen).
 */
const KEEP_MS = 60_000;
const kept = new Map<string, { at: number; sinceMs: number; commits: WorkstreamCommit[] }>();

function keyOf(w: Workstream): string | null {
  const head = w.head && SHA.test(w.head) ? w.head : null;
  return head ? `${w.root}\u0000${head}\u0000${w.changes?.base ?? ''}` : null;
}

export function commitsByWorkstream(workstreams: readonly Workstream[], sinceMs: number, now = Date.now()): Record<string, WorkstreamCommit[]> {
  const main = workstreams.find((w) => w.main);
  const out: Record<string, WorkstreamCommit[]> = {};
  if (!main) return out;
  for (const w of workstreams) {
    const key = keyOf(w);
    const hit = key ? kept.get(key) : undefined;
    if (hit && now - hit.at < KEEP_MS && hit.sinceMs <= sinceMs) {
      out[w.root] = hit.commits.filter((c) => c.at >= sinceMs);
      continue;
    }
    const commits = commitsOf(w, main.root, sinceMs);
    if (key) kept.set(key, { at: now, sinceMs, commits });
    out[w.root] = commits;
  }
  if (kept.size > 500) kept.clear();
  return out;
}

/** Test seam: forget what was kept. */
export function forgetKeptCommits(): void { kept.clear(); }
