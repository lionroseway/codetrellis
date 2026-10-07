/**
 * Phase 33 V6 — did the change do what the task said
 * (AGENT-CHECKS-AND-REVIEW §2.6).
 *
 * Only when a change is linked to a task: a plan item whose branch
 * (`workstream`) is the change's head. Without one there is no section at
 * all, not an empty one. With one, for each linked item:
 *  - each criterion, verbatim, with where it stands;
 *  - the files it planned against the files the change touched;
 * and the changed files no linked item planned.
 *
 * `reviewPlan` has the parts; this puts them in the review of a change.
 */

import { execFileSync } from 'node:child_process';
import { listPlans } from './plan-service';
import { listAllItems } from './plan-item-service';
import { listCriteria } from './criteria-service';
import { covers, reviewPlan, type ReviewedItem } from './plan-review-service';
import type { CriterionState } from '../../shared/types/criteria';

export interface TaskItemOutcome {
  planUid: string;
  planTitle: string;
  uid: string;
  title: string;
  verdict: ReviewedItem['verdict'];
  criteria: Array<{ text: string; state: CriterionState }>;
  /** Planned files the change touched. */
  landed: string[];
  /** Planned files it did not. */
  missing: string[];
  words: string;
}

export interface TaskOutcome {
  /** The branch the items name. */
  branch: string;
  items: TaskItemOutcome[];
  /** Files the change touched that no linked item planned. */
  unplanned: string[];
  /** One sentence each, worst first. */
  words: string[];
}

const DONE: ReadonlySet<string> = new Set(['completed', 'archived']);
const STATE_WORDS: Record<CriterionState, string> = {
  met: 'met', submitted: 'waiting for a person', sent_back: 'sent back', stale: 'stale', open: 'open',
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], max = 5) => xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;

/** The branch a ref names, for linking: `HEAD` reads as the checked-out branch. */
function branchOf(projectRoot: string, head: string): string {
  if (head !== 'HEAD') return head;
  try {
    return execFileSync('git', ['-C', projectRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return head; }
}

export function itemWords(i: Omit<TaskItemOutcome, 'words'>): string {
  const planned = i.landed.length + i.missing.length;
  const files = i.verdict === 'no-targets' ? 'planned no files'
    : i.verdict === 'landed' ? `touched every file it planned (${planned})`
    : i.verdict === 'untouched' ? `touched none of the ${plural(planned, 'file')} it planned: ${list(i.missing)}`
    : `touched ${i.landed.length} of the ${planned} files it planned; not ${list(i.missing)}`;
  const met = i.criteria.filter((c) => c.state === 'met').length;
  const counts = (s: CriterionState) => i.criteria.filter((c) => c.state === s).length;
  const rest = (['submitted', 'sent_back', 'stale'] as const).filter((s) => counts(s) > 0).map((s) => `${counts(s)} ${STATE_WORDS[s]}`);
  const criteria = i.criteria.length === 0 ? 'no criteria'
    : `${met} of ${plural(i.criteria.length, 'criterion', 'criteria')} met${rest.length ? ` (${rest.join(', ')})` : ''}`;
  const mark = i.verdict === 'landed' && met === i.criteria.length ? '✓' : (i.verdict === 'untouched' || counts('sent_back') > 0) ? '✗' : '◐';
  return `${mark} ${i.title}: ${files}; ${criteria}.`;
}

/** Every file the change touched, as a pull request counts them: since it left the base. */
function changedFiles(projectRoot: string, base: string, head: string): string[] | null {
  try {
    return execFileSync('git', ['-C', projectRoot, 'diff', '--name-only', `${base}...${head}`, '--'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((f) => f.trim()).filter(Boolean);
  } catch { return null; }
}

/** What the task linked to `head` asked, against what the change did; null when nothing links to it. */
export function taskOutcome(projectRoot: string, base: string, head: string): TaskOutcome | null {
  const branch = branchOf(projectRoot, head);
  const linked: Array<{ planUid: string; planTitle: string; item: ReturnType<typeof listAllItems>[number]; reviewed: ReviewedItem }> = [];
  for (const plan of listPlans(projectRoot)) {
    if (DONE.has(plan.status)) continue;
    const mine = listAllItems(plan.uid).filter((i) => i.workstream === branch);
    if (mine.length === 0) continue;
    // reviewPlan reads the planned files the same way every review does.
    const r = reviewPlan({ planUid: plan.uid, projectPath: projectRoot, before: `commit:${base}`, after: `commit:${head}` });
    if (!r.ok) continue;
    for (const item of mine) {
      const reviewed = r.review.items.find((x) => x.uid === item.uid);
      if (reviewed) linked.push({ planUid: plan.uid, planTitle: plan.title, item, reviewed });
    }
  }
  if (linked.length === 0) return null;
  // The footprint from git, not the code snapshot: a manifest or a doc is part of what the change touched.
  const changed = changedFiles(projectRoot, base, head) ?? [];
  const targets: string[] = [];
  const items = linked.map(({ planUid, planTitle, item, reviewed }) => {
    const planned = [...reviewed.landed, ...reviewed.missing];
    targets.push(...planned);
    const landed = planned.filter((t) => changed.some((f) => covers(t, f)));
    const missing = planned.filter((t) => !landed.includes(t));
    const verdict: ReviewedItem['verdict'] = planned.length === 0 ? 'no-targets'
      : landed.length === 0 ? 'untouched' : missing.length === 0 ? 'landed' : 'partial';
    const o = {
      planUid, planTitle, uid: item.uid, title: item.title, verdict,
      criteria: listCriteria(item.uid).map((c) => ({ text: c.text, state: c.state })),
      landed, missing,
    };
    return { ...o, words: itemWords(o) };
  });
  const unplanned = changed.filter((f) => !targets.some((t) => covers(t, f)));
  const rank = (w: string) => (w.startsWith('✗') ? 0 : w.startsWith('◐') ? 1 : 2);
  const words = items.map((i) => i.words).sort((a, b) => rank(a) - rank(b));
  if (unplanned.length) words.push(`Changed ${plural(unplanned.length, 'file')} the task did not plan: ${list(unplanned)}.`);
  return { branch, items, unplanned, words };
}

export function taskMarkdown(t: TaskOutcome): string {
  const lines = ['### Did it do what the task said', ''];
  for (const w of t.words) lines.push(`- ${w}`);
  for (const i of t.items) {
    if (i.criteria.length === 0) continue;
    lines.push('', `**${i.title}**`, '');
    for (const c of i.criteria) lines.push(`- ${c.state === 'met' ? '✓' : c.state === 'sent_back' ? '✗' : '○'} ${c.text} (${STATE_WORDS[c.state]})`);
  }
  return lines.join('\n');
}
