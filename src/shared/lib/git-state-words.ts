/**
 * An item's state as git proves it (Phase 32 C2.1), in the words the plan
 * tree, the item page, the plan's MCP tools and (C2.4) STATUS.md all use.
 * Git proves building, pushed and merged for any host or none; what only a
 * host knows (in review, checks, closed) is never claimed here.
 *
 * Pure.
 */

export type GitStateName = 'none' | 'building' | 'pushed' | 'merged';

/** How a merge was recognised. */
export type GitMergeHow = 'merge' | 'fast-forward' | 'squash-or-rebase' | 'names-key';

export interface ItemGitState {
  state: GitStateName;
  /** Where it came from: git, for every state C2.1 reports. A host adapter (C2.2) adds its own. */
  source: 'git';
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
}

const HOW: Record<GitMergeHow, string> = {
  merge: 'merge commit',
  'fast-forward': 'fast-forward',
  'squash-or-rebase': 'squash or rebase',
  'names-key': 'a commit names it',
};

/** "3 Oct", in UTC so every surface and every machine says the same day. */
export function shortDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The state in a few words: "building on billing-v2", "pushed, not merged", "merged (squash or rebase, 3 Oct)". */
export function gitStateWords(s: Pick<ItemGitState, 'state' | 'branch' | 'how' | 'at' | 'unpushed' | 'base'>): string {
  switch (s.state) {
    case 'merged': {
      const parts = [s.how ? HOW[s.how] : null, s.at ? shortDate(s.at) : null].filter(Boolean);
      return `merged${s.base ? ` into ${s.base}` : ''}${parts.length ? ` (${parts.join(', ')})` : ''}`;
    }
    case 'pushed':
      return `pushed, not merged${s.unpushed ? `; ${s.unpushed} commit${s.unpushed === 1 ? '' : 's'} not pushed yet` : ''}`;
    case 'building':
      return `building on ${s.branch}, not pushed`;
    default:
      return `no ${s.branch} branch yet`;
  }
}

/** A short label for a chip: "building", "pushed", "merged". Empty for none. */
export function gitStateChip(s: Pick<ItemGitState, 'state'>): string {
  return s.state === 'none' ? '' : s.state;
}
