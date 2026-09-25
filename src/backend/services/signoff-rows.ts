/**
 * Phase 31 §13 — what was agreed, criterion by criterion, in one shape.
 *
 * The PR draft and the sign-off pack are the same data with two outputs:
 * every criterion on every item of a plan, verbatim, with where it stands,
 * the evidence it was judged on (the file, the place in it, the hash), and
 * the decision — who, how, when. One function builds the rows; the PR
 * draft's table and the pack both render from them, so the two cannot
 * disagree about what was signed.
 *
 * A self-approval is marked as one. On an `agent`-policy criterion the
 * agent's own submission is its approval, recorded in the agent's name
 * (criteria-service) — a reader must never mistake it for a person's.
 */

import { listAllItems } from './plan-item-service';
import { listCriteria } from './criteria-service';
import { getArtefact } from './artefact-service';
import { describeLocator } from '../../shared/lib/locator';
import { formatReference } from '../../shared/lib/references';
import type { ItemCriterion, PlanItem } from '../../shared/types';
import { decisionWords, evidenceWords, stateWords, type SignoffEvidence, type SignoffRow } from '../../shared/lib/signoff';

export type { SignoffEvidence, SignoffRow } from '../../shared/lib/signoff';

function refOf(item: PlanItem): string {
  return formatReference(item.kind === 'object' ? 'page' : 'task', item.uid);
}

export function rowsForCriterion(item: PlanItem, c: ItemCriterion): SignoffRow {
  const evidence: SignoffEvidence[] = c.latestSubmission.map((e) => {
    const artefact = e.attachmentUid ? getArtefact(e.attachmentUid) : null;
    return {
      path: artefact?.path ?? null,
      locator: e.locator,
      where: describeLocator(e.locator),
      sha256AtSubmit: e.sha256AtSubmit,
      sha256Now: artefact?.sha256 ?? null,
      attachmentUid: e.attachmentUid,
    };
  });
  const s = c.latestSignoff;
  const recorded = s?.evidenceHashes ?? {};
  const changedFiles = c.state === 'stale'
    ? Object.keys(recorded)
      .filter((uid) => (getArtefact(uid)?.sha256 ?? null) !== recorded[uid])
      .map((uid) => getArtefact(uid)?.path ?? uid)
    : [];
  return {
    itemUid: item.uid,
    itemTitle: item.title,
    itemRef: refOf(item),
    criterionUid: c.uid,
    text: c.text,
    kind: c.kind,
    policy: c.policy,
    state: c.state,
    evidence,
    submissionNote: c.latestSubmission.find((e) => e.note)?.note ?? null,
    submittedBy: c.latestSubmission[0]?.submittedBy ?? null,
    decision: s
      ? {
        decision: s.decision, actor: s.actor, actorType: s.actorType, channel: s.channel,
        note: s.note, at: s.createdAt, evidenceHashes: recorded,
      }
      : null,
    selfApproved: !!s && s.decision === 'approved' && s.actorType !== 'human',
    changedFiles,
  };
}

/** Every criterion on every item of a plan, in plan order. */
export function signoffRows(planUid: string): SignoffRow[] {
  return listAllItems(planUid).flatMap((item) => listCriteria(item.uid).map((c) => rowsForCriterion(item, c)));
}

/** A table cell: one line, no pipes, nothing that renders as markup. */
function cell(text: string): string {
  return text.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'").trim() || '—';
}

/**
 * `## Acceptance criteria` for a PR description: every criterion, where it
 * stands, what it was judged on and who signed. Empty when the plan has no
 * criteria — a section of dashes tells a reviewer nothing.
 */
export function renderCriteriaTable(rows: SignoffRow[]): string {
  if (rows.length === 0) return '';
  const lines = [
    '## Acceptance criteria',
    '',
    '| Task | Criterion | State | Evidence | Signed |',
    '|---|---|---|---|---|',
    ...rows.map((r) =>
      `| ${cell(r.itemTitle)} | ${cell(r.text)} | ${cell(stateWords(r))} | ${cell(evidenceWords(r))} | ${cell(decisionWords(r))} |`),
  ];
  const self = rows.filter((r) => r.selfApproved);
  if (self.length > 0) {
    lines.push('', `_${self.length} of these ${self.length === 1 ? 'was' : 'were'} approved by the agent's own checks (agent policy), not by a person._`);
  }
  return lines.join('\n');
}

/** One warning per criterion a reviewer should not merge past without knowing. */
export function criteriaWarnings(rows: SignoffRow[]): string[] {
  return rows
    .filter((r) => r.state !== 'met')
    .map((r) => {
      const why = r.state === 'stale' && r.changedFiles.length
        ? `changed since approved (${r.changedFiles.join(', ')})`
        : stateWords(r);
      return `"${r.text}" on ${r.itemTitle} is ${why}.`;
    });
}
