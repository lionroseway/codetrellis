/**
 * Every item's state with its source, and the plan's status in one view
 * (Phase 32 C2.4, shared-work doc C-2 §1: status is read, not written).
 *
 * Intent is what the plan's files hold. State is derived, and each state
 * says where it came from:
 *
 *  - **git**, for an item worked on a branch git can see (C2.1): building,
 *    pushed, merged;
 *  - **the review host** the person turned on (C2.2–C2.3): in review,
 *    closed, merged by its pull request;
 *  - **the plan itself** for everything else: its status, its criteria and
 *    sign-off, and who recorded each. A task with no branch, such as an
 *    analyst's report, says "from the plan" and is never shown as less
 *    certain than a code task beside it.
 *
 * The same answer reaches the window, the phone and an agent's get_plan.
 * Nothing here writes a file. Pure.
 */

import { gitStateWords, shortDate, sourceWords, type GitStateName, type GitStateSource, type ItemGitState } from './git-state-words';

/** A state the plan records, for an item git says nothing of. */
export type PlanStateName = 'not-started' | 'assigned' | 'in-progress' | 'blocked' | 'done' | 'skipped' | 'context';

export type ItemStateName = GitStateName | PlanStateName;

/** Where a state came from: git, the review host, or the plan itself. */
export type ItemStateSource = GitStateSource | 'plan';

/** Who recorded the plan's state, and when (ms). */
export interface StateRecord { by: string; byType: string; at: number }

/** An item's acceptance criteria, summed up. */
export interface CriteriaTally {
  met: number;
  total: number;
  /** Submitted and waiting for a person to decide. */
  awaiting: number;
  /** The person who approved the last criterion met, when every criterion is met. */
  signedOffBy: string | null;
}

/** What the plan knows of one item: the input to `planStateOf`. */
export interface PlanItemFacts {
  uid: string;
  title: string;
  kind: 'object' | 'action';
  parentUid: string | null;
  status?: string | null;
  assignee?: string | null;
  progressPercent?: number | null;
  blockedReason?: string | null;
  criteria?: CriteriaTally | null;
  /** The newest status change, from the plan's events. */
  recorded?: StateRecord | null;
}

export interface ItemStatus {
  itemUid: string;
  title: string;
  kind: 'object' | 'action';
  state: ItemStateName;
  source: ItemStateSource;
  words: string;
  /** "from the plan", "from git", "from GitHub". */
  from: string;
  /** For a state from the plan: who recorded it. */
  recorded: StateRecord | null;
  /** The branch the item is worked on, when it has one. */
  branch: string | null;
  /** Why git is not the source for an item on a branch: "no billing branch yet". */
  gitNote?: string;
  /** The git (and host) state, when that is the source. */
  git?: ItemGitState & { words: string };
}

const TASK_STATUS: Record<string, PlanStateName> = {
  pending: 'not-started',
  assigned: 'assigned',
  in_progress: 'in-progress',
  blocked: 'blocked',
  done: 'done',
  skipped: 'skipped',
};

function criteriaWords(c: CriteriaTally | null | undefined, state: PlanStateName): string | null {
  if (!c || c.total === 0) return null;
  if (state === 'done' && c.met === c.total && c.signedOffBy) return `signed off by ${c.signedOffBy}`;
  const parts = [`${c.met} of ${c.total} criteria met`];
  if (c.awaiting) parts.push(`${c.awaiting} waiting for sign-off`);
  return parts.join(', ');
}

/** A task's state in the plan's words: "in progress, 40%", "blocked: waits on the spec", "done, signed off by Priya". */
export function taskStateWords(f: Pick<PlanItemFacts, 'status' | 'assignee' | 'progressPercent' | 'blockedReason' | 'criteria'>): { state: PlanStateName; words: string } {
  const state = TASK_STATUS[f.status ?? 'pending'] ?? 'not-started';
  let words: string;
  switch (state) {
    case 'assigned': words = f.assignee ? `assigned to ${f.assignee}` : 'assigned'; break;
    case 'in-progress': words = `in progress${f.progressPercent ? `, ${f.progressPercent}%` : ''}`; break;
    case 'blocked': words = f.blockedReason ? `blocked: ${f.blockedReason}` : 'blocked'; break;
    case 'not-started': words = 'not started'; break;
    default: words = state;
  }
  const crit = criteriaWords(f.criteria, state);
  if (crit) words += state === 'done' && crit.startsWith('signed off') ? `, ${crit}` : `; ${crit}`;
  return { state, words };
}

/** A section's (or a note's) state from the tasks under it: "2 of 5 tasks done", "all 3 tasks done", "no tasks under it". */
export function sectionStateWords(under: ReadonlyArray<{ state: ItemStateName }>): { state: PlanStateName; words: string } {
  const counted = under.filter((t) => t.state !== 'skipped');
  const total = counted.length;
  if (total === 0) return { state: 'context', words: 'no tasks under it' };
  const done = counted.filter((t) => isFinished(t.state)).length;
  const blocked = counted.filter((t) => t.state === 'blocked').length;
  const started = counted.filter((t) => t.state !== 'not-started' && t.state !== 'none').length;
  const tail = blocked ? `; ${blocked} blocked` : '';
  if (done === total) return { state: 'done', words: `all ${total} task${total === 1 ? '' : 's'} done` };
  if (started === 0) return { state: 'not-started', words: `none of ${total} task${total === 1 ? '' : 's'} started` };
  return { state: blocked ? 'blocked' : 'in-progress', words: `${done} of ${total} task${total === 1 ? '' : 's'} done${tail}` };
}

/** Done in the plan, or merged by git or a host. */
export function isFinished(state: ItemStateName): boolean {
  return state === 'done' || state === 'merged';
}

/** "from the plan", or the git source's words. */
export function stateFromWords(source: ItemStateSource): string {
  return source === 'plan' ? 'from the plan' : sourceWords({ source });
}

/** "recorded by Sam, 26 Sep". */
export function recordedWords(r: StateRecord | null | undefined): string | null {
  return r ? `recorded by ${r.by}, ${shortDate(Math.floor(r.at / 1000))}` : null;
}

/** The line an item's page and a row's hover say: "in progress, 40% — from the plan, recorded by Sam, 26 Sep". */
export function statusLine(s: Pick<ItemStatus, 'words' | 'source' | 'recorded' | 'gitNote'>): string {
  const from = [stateFromWords(s.source), s.source === 'plan' ? recordedWords(s.recorded) : null].filter(Boolean).join(', ');
  return `${s.words} — ${from}${s.gitNote ? `; ${s.gitNote}` : ''}`;
}

/**
 * Every item's status. `git` holds the git (and host) state of each item on
 * a branch; an item git can say nothing of yet (its branch not made) takes
 * the plan's state and says why. Sections are summed from the tasks under
 * them once those are known.
 */
export function itemStatuses(
  items: readonly PlanItemFacts[],
  git: ReadonlyMap<string, ItemGitState & { words: string }>,
): ItemStatus[] {
  const children = new Map<string | null, PlanItemFacts[]>();
  for (const i of items) {
    const list = children.get(i.parentUid) ?? [];
    list.push(i);
    children.set(i.parentUid, list);
  }
  const out = new Map<string, ItemStatus>();

  const visit = (f: PlanItemFacts): ItemStatus => {
    const done = out.get(f.uid);
    if (done) return done;
    const kids = (children.get(f.uid) ?? []).map(visit);
    const g = git.get(f.uid);
    let s: ItemStatus;
    if (g && g.state !== 'none') {
      s = {
        itemUid: f.uid, title: f.title, kind: f.kind, state: g.state, source: g.source, words: g.words,
        from: sourceWords(g), recorded: null, branch: g.branch, git: g,
      };
    } else {
      const fromPlan = f.kind === 'action' && (f.status || kids.every((k) => k.kind !== 'action'))
        ? taskStateWords(f)
        : sectionStateWords(tasksUnder(f.uid, children, out));
      s = {
        itemUid: f.uid, title: f.title, kind: f.kind, state: fromPlan.state, source: 'plan', words: fromPlan.words,
        from: 'from the plan', recorded: f.kind === 'action' ? f.recorded ?? null : null, branch: g?.branch ?? null,
        ...(g ? { gitNote: gitStateWords(g) } : {}),
      };
    }
    out.set(f.uid, s);
    return s;
  };
  for (const f of items) visit(f);
  return items.map((f) => out.get(f.uid)!);
}

/** Every task under an item, at any depth, as already worked out. */
function tasksUnder(uid: string, children: ReadonlyMap<string | null, PlanItemFacts[]>, done: ReadonlyMap<string, ItemStatus>): ItemStatus[] {
  const out: ItemStatus[] = [];
  const walk = (u: string) => {
    for (const c of children.get(u) ?? []) {
      const s = done.get(c.uid);
      if (s && c.kind === 'action') out.push(s);
      walk(c.uid);
    }
  };
  walk(uid);
  return out;
}

// ── What is state, and so never written (C2.4b) ─────────────────────────

/**
 * An item's state: its status, progress, blocked reason and who has claimed
 * it. The plan's files keep intent and never these, so a change to them
 * alone writes no file and a teammate's pull never carries them.
 */
export const ITEM_STATE_FIELDS: ReadonlySet<string> = new Set([
  'status', 'assignee', 'assigneeType', 'assigneeModel', 'assigneeSession', 'progressPercent', 'blockedReason',
]);

/** True when an update changes nothing but state (who made it aside). */
export function isStateOnly(updates: object): boolean {
  const keys = Object.entries(updates)
    .filter(([k, v]) => v !== undefined && k !== 'author' && k !== 'authorType')
    .map(([k]) => k);
  return keys.length > 0 && keys.every((k) => ITEM_STATE_FIELDS.has(k));
}

// ── The plan's status view ──────────────────────────────────────────────

export interface StatusLine { itemUid: string; title: string; words: string; source: ItemStateSource; from: string }

export interface PlanStatusView {
  /** "3 of 5 tasks done". */
  progress: { done: number; total: number; words: string };
  /** Blocked, or waiting for a person to sign off. */
  waiting: StatusLine[];
  /** Under way: assigned or in progress in the plan; building, pushed or in review by git or a host. */
  inProgress: StatusLine[];
  /**
   * One line per branch: ticket → this plan → where its work is. "PR #118
   * (open)" only when a host said so; otherwise what git proves ("billing
   * pushed").
   */
  lineage: string[];
  /** When anything in the plan last changed (ms), or null. */
  updatedAt: number | null;
}

const UNDER_WAY: ReadonlySet<ItemStateName> = new Set(['assigned', 'in-progress', 'building', 'pushed', 'in-review']);

function lineOf(s: ItemStatus): StatusLine {
  return { itemUid: s.itemUid, title: s.title, words: s.words, source: s.source, from: s.from };
}

/** Where a branch's work is, for the lineage: "PR #118 (open)", "MR !42 (merged)", or what git proves. */
export function branchLineageWords(g: ItemGitState): string {
  if (g.review && g.source !== 'git') {
    const what = g.source === 'gitlab' ? `MR ${g.review.ref ?? `!${g.review.number}`}` : `PR ${g.review.ref ?? `#${g.review.number}`}`;
    const state = g.state === 'in-review' ? 'open' : g.state === 'merged' ? 'merged' : g.state === 'closed' ? 'closed' : 'open';
    return `${what} (${state})`;
  }
  switch (g.state) {
    case 'merged': return `${g.branch} merged${g.base ? ` into ${g.base}` : ''}`;
    case 'pushed': return `${g.branch} pushed`;
    case 'building': return `${g.branch} not pushed yet`;
    default: return `no ${g.branch} branch yet`;
  }
}

/**
 * The plan's status in one view. `tickets` are the plan's ticket keys
 * (JIRA-142), oldest first.
 */
export function planStatusView(statuses: readonly ItemStatus[], tickets: readonly string[], updatedAt: number | null): PlanStatusView {
  const tasks = statuses.filter((s) => s.kind === 'action' && s.state !== 'skipped');
  const done = tasks.filter((s) => isFinished(s.state)).length;
  const waiting = statuses.filter((s) => s.kind === 'action' && (s.state === 'blocked' || /waiting for sign-off/.test(s.words))).map(lineOf);
  const inProgress = statuses.filter((s) => s.kind === 'action' && UNDER_WAY.has(s.state) && !waiting.some((w) => w.itemUid === s.itemUid)).map(lineOf);

  const head = [tickets.join(', '), 'this plan'].filter(Boolean).join(' → ');
  const byBranch = new Map<string, ItemGitState>();
  for (const s of statuses) {
    if (s.git && !byBranch.has(s.git.branch)) byBranch.set(s.git.branch, s.git);
  }
  const lineage = byBranch.size ? [...byBranch.values()].map((g) => `${head} → ${branchLineageWords(g)}`) : [head];

  return {
    progress: { done, total: tasks.length, words: `${done} of ${tasks.length} task${tasks.length === 1 ? '' : 's'} done` },
    waiting, inProgress, lineage, updatedAt,
  };
}
