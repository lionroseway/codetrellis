/**
 * What the review host adds to git's answer, per branch (Phase 32 C2.2b).
 *
 * Only for a project whose host the person turned on (`activeReviewHost`),
 * and only for branches a plan works on. Answers are kept for two minutes,
 * so the plan tree's 30-second refresh and every agent asking get_plan cost
 * GitHub one read per branch per two minutes, well inside the 60 an hour a
 * public repository allows without a token. A read in flight is shared.
 *
 * `overlayHost` is the rule for combining, and it is pure: the host adds
 * what git cannot see (in review, closed) and names the pull request that
 * merged a branch; where the host and git disagree, the stronger proof
 * stands and the other is said, never dropped.
 */

import type { ItemGitState } from '../../../shared/lib/git-state-words';
import type { DetectedHost } from './detect';
import { activeReviewHost } from './switch';
import { readGithubBranch, type HostRead } from './github';

export const HOST_TTL_MS = 120_000;
/** A plan with more branches than this is read in part; the rest stay git's until their turn. */
const MAX_BRANCHES = 25;
const CONCURRENCY = 4;

interface Entry { at: number; read: HostRead }
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<HostRead>>();

const keyOf = (host: DetectedHost, branch: string) => `${host.hostname}/${host.slug}#${branch}`;

/** Forget every answer: the person turned a host on or off, or changed its token. */
export function forgetHostReads(): void {
  cache.clear();
}

/** The host's latest answer for a branch, if the project's host is on and one is kept. */
export function cachedHostRead(projectRoot: string, branch: string): HostRead | null {
  const active = activeReviewHost(projectRoot);
  if (!active) return null;
  return cache.get(keyOf(active.host, branch))?.read ?? null;
}

/**
 * Ask the host about these branches, where the kept answer is older than
 * the TTL. Does nothing for a project whose host is off. Never throws.
 */
export async function refreshHostReads(projectRoot: string, branches: readonly string[], now = Date.now()): Promise<void> {
  const active = activeReviewHost(projectRoot);
  if (!active || active.host.kind !== 'github') return;
  const { host, token } = active;
  const stale = [...new Set(branches)]
    .filter((b) => { const e = cache.get(keyOf(host, b)); return !e || now - e.at >= HOST_TTL_MS; })
    .slice(0, MAX_BRANCHES);
  let next = 0;
  const worker = async () => {
    while (next < stale.length) {
      const branch = stale[next++];
      const key = keyOf(host, branch);
      let p = inflight.get(key);
      if (!p) {
        p = readGithubBranch(host.owner, host.repo, branch, token).finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      cache.set(key, { at: Date.now(), read: await p });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stale.length) }, worker));
}

/** Git's answer with what the host said added to it. Pure. */
export function overlayHost(state: ItemGitState, read: HostRead | null): ItemGitState {
  if (!read) return state;
  if (!read.ok) return { ...state, hostNote: read.error };
  const r = read.review;
  if (!r) return { ...state, hostNote: 'GitHub has no pull request for this branch.' };
  const review = { number: r.number, url: r.url, checks: r.checks, approvals: r.approvals, changesRequested: r.changesRequested };
  if (r.state === 'merged') {
    return { ...state, state: 'merged', source: 'github', how: 'pull-request', commit: r.mergeCommit ?? state.commit, at: r.at ?? state.at, review };
  }
  if (r.state === 'open') {
    // Git may already see its changes on the base (merged by hand, the PR left open): git's proof stands.
    if (state.state === 'merged') return { ...state, review, hostNote: `GitHub still has #${r.number} open, but its changes are on ${state.base ?? 'the base'}.` };
    return { ...state, state: 'in-review', source: 'github', review };
  }
  if (state.state === 'merged') return { ...state, review, hostNote: `GitHub says #${r.number} was closed without merging; git shows its changes on ${state.base ?? 'the base'}.` };
  return { ...state, state: 'closed', source: 'github', at: r.at ?? state.at, review };
}
