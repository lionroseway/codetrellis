/**
 * An item's state (Phase 32 C2.1, C2.2b), in the words the plan tree, the
 * item page and the plan's MCP tools all use. Git proves building, pushed
 * and merged for any host or none. What only a host knows (a pull request
 * in review, its checks and reviews, one closed without merging) is said
 * only when a host the person turned on said it, and then with its source.
 *
 * Pure.
 */

export type GitStateName = 'none' | 'building' | 'pushed' | 'in-review' | 'merged' | 'closed';

/** How a merge was recognised: by git, or by the host's pull request. */
export type GitMergeHow = 'merge' | 'fast-forward' | 'squash-or-rebase' | 'names-key' | 'pull-request';

/** Where a state came from: git, or the host that said it (C2.2b). */
export type GitStateSource = 'git' | 'github';

/** A pull request as the host reported it. */
export interface ItemReview {
  number: number;
  url: string;
  /** Open only: its checks summed up; null when it has none. */
  checks: 'passing' | 'failing' | 'pending' | null;
  approvals: number;
  changesRequested: boolean;
}

export interface ItemGitState {
  state: GitStateName;
  /** Where it came from: git, or the host the person turned on (C2.2b). */
  source: GitStateSource;
  /** The branch the item is worked on (its own or its section's). */
  branch: string;
  /** The base it merges into. */
  base: string | null;
  /** The commit that proves the state: the branch head, or the commit on the base that merged it. */
  commit: string | null;
  /** Unix seconds of that commit. */
  at: number | null;
  how?: GitMergeHow;
  /** The remote it is on, when pushed. */
  remote?: string;
  /** Local commits not on the remote yet. */
  unpushed?: number;
  /** The branch's pull request, when a host said so (C2.2b). */
  review?: ItemReview;
  /** Why the host added nothing, when it was asked: it could not be read, or has no pull request for the branch. */
  hostNote?: string;
}

const HOW: Record<GitMergeHow, string> = {
  merge: 'merge commit',
  'fast-forward': 'fast-forward',
  'squash-or-rebase': 'squash or rebase',
  'names-key': 'a commit names it',
  'pull-request': 'pull request',
};

const SOURCE: Record<GitStateSource, string> = { git: 'git', github: 'GitHub' };

/** "from git", "from GitHub". */
export function sourceWords(s: Pick<ItemGitState, 'source'>): string {
  return `from ${SOURCE[s.source]}`;
}

function reviewParts(r: ItemReview): string[] {
  const parts: string[] = [];
  if (r.checks === 'passing') parts.push('checks passing');
  else if (r.checks === 'failing') parts.push('checks failing');
  else if (r.checks === 'pending') parts.push('checks running');
  if (r.changesRequested) parts.push('changes requested');
  if (r.approvals) parts.push(`${r.approvals} approval${r.approvals === 1 ? '' : 's'}`);
  return parts;
}

/** "3 Oct", in UTC so every surface and every machine says the same day. */
export function shortDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The state in a few words: "building on billing-v2", "pushed, not merged", "merged (squash or rebase, 3 Oct)". */
export function gitStateWords(s: Pick<ItemGitState, 'state' | 'branch' | 'how' | 'at' | 'unpushed' | 'base' | 'review'>): string {
  switch (s.state) {
    case 'merged': {
      const how = s.how === 'pull-request' && s.review ? `#${s.review.number}` : s.how ? HOW[s.how] : null;
      const parts = [how, s.at ? shortDate(s.at) : null].filter(Boolean);
      return `merged${s.base ? ` into ${s.base}` : ''}${parts.length ? ` (${parts.join(', ')})` : ''}`;
    }
    case 'in-review': {
      const parts = s.review ? reviewParts(s.review) : [];
      return `in review${s.review ? ` (#${s.review.number})` : ''}${parts.length ? `, ${parts.join(', ')}` : ''}`;
    }
    case 'closed':
      return `closed without merging${s.review ? ` (#${s.review.number}${s.at ? `, ${shortDate(s.at)}` : ''})` : ''}`;
    case 'pushed':
      return `pushed, not merged${s.unpushed ? `; ${s.unpushed} commit${s.unpushed === 1 ? '' : 's'} not pushed yet` : ''}`;
    case 'building':
      return `building on ${s.branch}, not pushed`;
    default:
      return `no ${s.branch} branch yet`;
  }
}

/** A short label for a chip: "building", "pushed", "in review", "merged", "closed". Empty for none. */
export function gitStateChip(s: Pick<ItemGitState, 'state'>): string {
  return s.state === 'none' ? '' : s.state === 'in-review' ? 'in review' : s.state;
}
