/**
 * Each item's state from git, for any host or none (Phase 32 C2.1,
 * shared-work doc C-2 §5).
 *
 * An item is worked on a branch: its own `workstream`, or its section's
 * (C5.1). Git alone proves three things about that branch, and nothing is
 * asked of any host:
 *
 *  - **building**: the branch exists;
 *  - **pushed**: a remote-tracking copy of it exists (as last fetched: the
 *    app never fetches, so the update check stays its only request);
 *  - **merged**: the work reached the base, one of three ways —
 *      · ancestry: a merge commit on the base has the branch head as a
 *        parent, or the base fast-forwarded past it (a branch that moved
 *        since it was made, so a fresh branch is not "merged");
 *      · by content: every file the branch changes is on the base at the
 *        version the branch left it (bug 53's check), which is how a squash
 *        or a rebase looks, with no ancestry at all;
 *      · the branch is gone and a commit on the base names the item's key.
 *
 * A branch that stopped stays "pushed", never "merged": closed without
 * merging is something only a host can say (C2.2).
 */

import { execFileSync } from 'node:child_process';
import { isSafeGitRef } from './git-safety';
import { branchVersions, isMergedInto, listBranchRefs, mainVersionsSince, type BranchRef } from './branch-workstreams';
import type { GitMergeHow, ItemGitState } from '../../shared/lib/git-state-words';
import { getPlan } from './plan-service';
import { listAllItems, getItem } from './plan-item-service';
import { listWorktrees } from './worktree-service';
import { resolveTrustedProjectRoot } from './trusted-roots';
import { resolveSection, usableBase } from './section-workstreams';
import { gitStateWords } from '../../shared/lib/git-state-words';


const SHA = /^[0-9a-f]{40}$/;
/** How far back the base is searched for a commit naming a key, when the branch is gone. */
const KEY_WINDOW_DAYS = 90;

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 16 * 1024 * 1024,
  });
}

function tryGit(repo: string, args: string[]): string | null {
  try { return git(repo, args); } catch { return null; }
}

const commitTime = (repo: string, sha: string) => Number(tryGit(repo, ['show', '-s', '--format=%ct', sha])?.trim()) || null;
const isAncestor = (repo: string, a: string, b: string) => tryGit(repo, ['merge-base', '--is-ancestor', a, b]) !== null;

/** The commit the local branch was made at, from its reflog; null when there is none (a remote-only branch). */
function createdAt(repo: string, branch: string): string | null {
  const out = tryGit(repo, ['reflog', 'show', '--format=%H', `refs/heads/${branch}`]);
  const lines = out?.trim().split('\n').filter((l) => SHA.test(l)) ?? [];
  return lines.length ? lines[lines.length - 1] : null;
}

/** The merge commit on `baseHead` that brought `head` in, if one did. */
function mergeCommitOf(repo: string, head: string, baseHead: string): string | null {
  const out = tryGit(repo, ['rev-list', '--merges', '--ancestry-path', '--parents', '--reverse', `${head}..${baseHead}`]);
  for (const line of out?.trim().split('\n') ?? []) {
    const [commit, , ...others] = line.split(' ');
    if (others.includes(head)) return commit;
  }
  return null;
}

/** The newest commit on the base, since `sinceSec`, that touches `path`. */
function lastTouch(repo: string, baseHead: string, path: string, sinceSec: number): string | null {
  const out = tryGit(repo, ['log', baseHead, `--since=@${Math.max(0, sinceSec)}`, '-1', '--format=%H', '--', path]);
  const sha = out?.trim() ?? '';
  return SHA.test(sha) ? sha : null;
}

/** The newest commit on the base naming one of the keys, as a word. */
function commitNaming(repo: string, baseHead: string, keys: readonly string[], sinceSec: number): string | null {
  const clean = keys.filter((k) => /^[A-Za-z0-9][A-Za-z0-9_.#-]{3,63}$/.test(k));
  if (clean.length === 0) return null;
  // git log has no whole-word match: take the candidates by fixed string,
  // newest first, and keep the first whose message has a key as a word.
  const args = ['log', baseHead, `--since=@${Math.max(0, sinceSec)}`, '--max-count=50', '--format=%H%x00%B%x1e', '-i', '-F'];
  for (const k of clean) args.push(`--grep=${k}`);
  const words = clean.map((k) => new RegExp(`(^|[^A-Za-z0-9_])${k.replace(/[.#-]/g, (c) => `\\${c}`)}($|[^A-Za-z0-9_])`, 'i'));
  for (const entry of (tryGit(repo, args) ?? '').split('\x1e')) {
    const [sha, message = ''] = entry.replace(/^\s+/, '').split('\0');
    if (SHA.test(sha) && words.some((w) => w.test(message))) return sha;
  }
  return null;
}

interface Refs { local: BranchRef | null; remote: BranchRef | null }

function refsOf(all: readonly BranchRef[], branch: string): Refs {
  const local = all.find((r) => r.ref === `refs/heads/${branch}`) ?? null;
  const remote = all.find((r) => r.ref.startsWith('refs/remotes/') && !r.ref.endsWith('/HEAD')
    && r.short.split('/').slice(1).join('/') === branch) ?? null;
  return { local, remote };
}

/** The base's heads to test against: the local branch and its remote-tracking copies. */
function baseHeads(all: readonly BranchRef[], base: string): string[] {
  const { local, remote } = refsOf(all, base);
  return [...new Set([local?.head, remote?.head].filter((h): h is string => !!h && SHA.test(h)))];
}

/** Did the branch head reach the base, and how. */
function mergedInto(repo: string, branch: string, head: string, headTime: number, bases: readonly string[]): { commit: string; how: GitMergeHow } | null {
  for (const baseHead of bases) {
    if (isAncestor(repo, head, baseHead)) {
      const merge = head !== baseHead ? mergeCommitOf(repo, head, baseHead) : null;
      if (merge) return { commit: merge, how: 'merge' };
      // Fast-forward, unless the branch never moved from where it was made.
      // With no reflog (a branch only on the remote), a branch exactly at the
      // base's head could as well be new and empty, so it is not called merged.
      const made = createdAt(repo, branch);
      if (made ? made !== head : head !== baseHead) return { commit: head, how: 'fast-forward' };
      continue;
    }
    // A squash or a rebase: the branch's changes, at its versions, on the base.
    const since = headTime - 86_400;
    const versions = branchVersions(repo, baseHead, head);
    if (isMergedInto(versions, mainVersionsSince(repo, baseHead, since))) {
      return { commit: lastTouch(repo, baseHead, versions[0].path, since) ?? baseHead, how: 'squash-or-rebase' };
    }
  }
  return null;
}

/**
 * One branch's state against a base. `keys` are what a commit message may
 * call the item by (its uid's first eight characters, a ticket key). Never
 * throws; a repository git cannot read is `none`.
 */
export function branchGitState(repo: string, branch: string, base: string | null, keys: readonly string[], opts: { refs?: readonly BranchRef[]; nowSec?: number } = {}): ItemGitState {
  const out: ItemGitState = { state: 'none', source: 'git', branch, base, commit: null, at: null };
  if (!isSafeGitRef(branch)) return out;
  const all = opts.refs ?? listBranchRefs(repo);
  const { local, remote } = refsOf(all, branch);
  const bases = base && isSafeGitRef(base) ? baseHeads(all, base) : [];
  const head = local?.head ?? remote?.head ?? null;

  if (!head) {
    // Gone: merged and deleted, if a commit on the base names the item.
    const since = (opts.nowSec ?? Math.floor(Date.now() / 1000)) - KEY_WINDOW_DAYS * 86_400;
    for (const baseHead of bases) {
      const named = commitNaming(repo, baseHead, keys, since);
      if (named) return { ...out, state: 'merged', commit: named, at: commitTime(repo, named), how: 'names-key' };
    }
    return out;
  }

  const headTime = (local ?? remote)!.committedAt || commitTime(repo, head) || 0;
  const merged = bases.length ? mergedInto(repo, branch, head, headTime, bases) : null;
  if (merged) return { ...out, state: 'merged', commit: merged.commit, at: commitTime(repo, merged.commit), how: merged.how };

  if (remote) {
    const unpushed = local && local.head !== remote.head
      ? Number(tryGit(repo, ['rev-list', '--count', `${remote.head}..${local.head}`])?.trim()) || 0
      : 0;
    return {
      ...out, state: 'pushed', commit: remote.head, at: remote.committedAt || null,
      remote: remote.short.split('/')[0], ...(unpushed ? { unpushed } : {}),
    };
  }
  return { ...out, state: 'building', commit: head, at: headTime || null };
}

// ── A plan's items ───────────────────────────────────────────────────────


export interface PlanItemGitState extends ItemGitState {
  itemUid: string;
  /** The item the branch is set on: this one, or its section. */
  fromUid: string;
  words: string;
}

/**
 * The git state of every item in a plan that is worked on a branch (its
 * own or its section's), against the plan's base or the main checkout's
 * branch. Items with no branch are left out: git has nothing to say of
 * them. One answer per branch, shared by its items, except where a gone
 * branch is recognised by an item's own key.
 */
export function planGitStates(planUid: string, opts: { nowSec?: number } = {}): { base: string | null; items: PlanItemGitState[] } | null {
  const plan = getPlan(planUid);
  if (!plan) return null;
  let root: string;
  try { root = resolveTrustedProjectRoot(plan.projectPath, 'plan git state'); } catch { return { base: null, items: [] }; }
  let repo = root;
  let mainBranch: string | null = null;
  try {
    const main = listWorktrees(root).find((w) => w.isMain);
    if (main) { repo = main.path; mainBranch = main.branch; }
  } catch { /* not a repository: nothing to say */ }
  const base = usableBase(plan.baseRef) ?? mainBranch;
  const refs = listBranchRefs(repo);
  const seen = new Map<string, ItemGitState>();
  const items: PlanItemGitState[] = [];
  for (const item of listAllItems(planUid)) {
    const section = resolveSection(item, getItem);
    if (!section) continue;
    const keys = [...new Set([item.uid.slice(0, 8), section.fromUid.slice(0, 8)])];
    const k = `${section.branch}\0${keys.join('\0')}`;
    const state = seen.get(k) ?? branchGitState(repo, section.branch, base, keys, { refs, nowSec: opts.nowSec });
    seen.set(k, state);
    items.push({ ...state, itemUid: item.uid, fromUid: section.fromUid, words: gitStateWords(state) });
  }
  return { base, items };
}
