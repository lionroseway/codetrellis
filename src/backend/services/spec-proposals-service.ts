/**
 * Phase 32 B7.2 — proposing a change to a spec page (JOURNEYS I1).
 *
 * An agent that finds the spec is wrong proposes the change instead of
 * editing the page: the new text of the page or of one section (a heading,
 * `shared/lib/spec-sections.ts`), why, and the evidence (a failing test, a
 * file, a commit). The proposal is kept against the page's version at the
 * time, with the section's text then, and lists every task relying on that
 * page or section in any plan of the project (B7.1). The page itself is not
 * touched: a person decides (B7.4).
 *
 * Asked about later, a proposal says whether the page has changed since it
 * was made, so nobody accepts a change against text that has moved.
 *
 * B7.3: each session holding a task that relies on the page (or section) is
 * told of an open proposal once, on its next call, and never the proposer.
 * Its agent says what the change would mean for that work (`replyToProposal`:
 * none, or changes with a sentence), which is kept with who and which plan
 * and posted as a weigh-in in the proposer's plan.
 *
 * B7.4: the decision is a person's. Making a proposal raises a `proposal`
 * breakpoint hit, so it waits in the inbox with the other things waiting on
 * them (count, push, `await_decision`). A person accepts, amends then
 * accepts, or rejects it over REST (`personFrom`); no MCP tool can. Accepting
 * writes the page's new version as the person, and flags every task relying
 * on it "spec changed" until the agent holding it has been told, once. The
 * proposing session is told the outcome, once.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import { getItem, updateItem } from './plan-item-service';
import { appendPlanEvent } from './plan-event-service';
import { answerHit, getHit, specBreakpointOn } from './breakpoint-service';
import { recordBreakpointEvent } from './agent-event-log';
import { pushForBreakpoint } from './push-notification-service';
import { getPlan } from './plan-service';
import { postChannelEvent } from './channel-event-service';
import { reliedOnBy, reliedOnWords, type RelianceIn } from './spec-links-service';
import type { ChannelEvent } from '../../shared/types';
import { findSection, sectionText, withSectionText } from '../../shared/lib/spec-sections';

export type ProposalStatus = 'open' | 'accepted' | 'rejected' | 'withdrawn';

export interface ProposalEvidence {
  tests?: string[];
  files?: string[];
  commits?: string[];
  note?: string;
}

export interface SpecProposal {
  uid: string;
  pageUid: string;
  pageTitle: string;
  planUid: string;
  /** A heading's slug, or '' for the whole page. */
  section: string;
  sectionTitle: string | null;
  baseVersion: number;
  /** The page's version now. */
  currentVersion: number;
  /** The page has had a new version since the proposal was made. */
  pageChangedSince: boolean;
  beforeText: string;
  proposedText: string;
  why: string;
  evidence: ProposalEvidence;
  /** Who relied on the page (or section) when the proposal was made. */
  affected: RelianceIn[];
  /** "2 tasks in 2 plans rely on this" */
  affectedWords: string | null;
  author: string;
  authorType: string;
  sessionId: string | null;
  status: ProposalStatus;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  decidedByType: string | null;
  decisionNote: string | null;
  /** What the agents doing the relying work said it would mean for them (B7.3), oldest first. */
  impacts: ProposalImpact[];
  /** The inbox entry a person decides it from (B7.4); the proposer can await_decision on it. */
  hitRef: string | null;
  /** The text a person accepted, when they amended it first. */
  decidedText: string | null;
  /**
   * A spec breakpoint a person set on the page (B7.5a), with their note. It
   * does not hold a proposal, which a person decides anyway, but the card
   * shows why they guarded the page.
   */
  pageBreakpoint: { id: string; note: string | null } | null;
}

export type ImpactKind = 'none' | 'changes';

export interface ProposalImpact {
  id: number;
  impact: ImpactKind;
  words: string;
  /** How many tasks it would change, when the agent said. */
  tasks: number | null;
  /** The replying session's task that relies on the page, and its plan. */
  itemUid: string | null;
  itemTitle: string | null;
  planUid: string | null;
  planTitle: string | null;
  author: string;
  authorType: string;
  sessionId: string | null;
  createdAt: number;
}

export interface ProposeInput {
  page: string;
  section?: string;
  text: string;
  why: string;
  evidence?: ProposalEvidence;
}

const rows = (sql: string, params: unknown[] = []): unknown[][] => getDb().exec(sql, params)[0]?.values ?? [];
const parse = <T>(s: unknown, fallback: T): T => {
  try { return JSON.parse(String(s)) as T; } catch { return fallback; }
};

/** The page's latest version number (1 when it was made and never edited). */
export function pageVersion(pageUid: string): number {
  return (rows('SELECT COALESCE(MAX(version), 1) FROM plan_item_versions WHERE item_uid = ?', [pageUid])[0]?.[0] as number) ?? 1;
}

/** Why a proposal cannot be made, in a sentence; null when it can. */
export function proposalProblem(input: ProposeInput): string | null {
  const page = getItem(input.page);
  if (!page) return `No page ${input.page}.`;
  if (page.kind !== 'object') return `"${page.title}" is a task, not a page: only a spec page can be changed by proposal.`;
  if (input.section && !findSection(page.body ?? '', input.section)) {
    return `"${page.title}" has no heading "${input.section}". Sections are addressed by their heading's slug, such as "fields" for "## Fields".`;
  }
  if (!input.text.trim()) return 'The proposal needs the new text.';
  if (!input.why.trim()) return 'The proposal needs a why: what is wrong with the spec as it is.';
  const before = input.section ? sectionText(page.body ?? '', input.section) ?? '' : page.body ?? '';
  if (before.trim() === input.text.trim()) return 'The proposed text is the same as the page has now.';
  return null;
}

const affectedWords = (affected: RelianceIn[]): string | null => {
  const w = reliedOnWords(affected);
  return w ? w.replace(/^Relied on by /, '') + (affected.length === 1 ? ' relies on this' : ' rely on this') : null;
};

function fromRow(r: unknown[]): SpecProposal {
  const pageUid = r[1] as string;
  const page = getItem(pageUid);
  const section = r[3] as string;
  const base = r[4] as number;
  const current = page ? pageVersion(pageUid) : base;
  const affected = parse<RelianceIn[]>(r[9], []);
  return {
    uid: r[0] as string,
    pageUid,
    pageTitle: page?.title ?? '',
    planUid: r[2] as string,
    section,
    sectionTitle: section && page ? findSection(page.body ?? '', section)?.title ?? null : null,
    baseVersion: base,
    currentVersion: current,
    pageChangedSince: current !== base,
    beforeText: r[5] as string,
    proposedText: r[6] as string,
    why: r[7] as string,
    evidence: parse<ProposalEvidence>(r[8], {}),
    affected,
    affectedWords: affectedWords(affected),
    author: r[10] as string,
    authorType: r[11] as string,
    sessionId: (r[12] as string | null) ?? null,
    status: r[13] as ProposalStatus,
    createdAt: r[14] as number,
    decidedAt: (r[15] as number | null) ?? null,
    decidedBy: (r[16] as string | null) ?? null,
    decidedByType: (r[17] as string | null) ?? null,
    decisionNote: (r[18] as string | null) ?? null,
    impacts: impactsOf(r[0] as string),
    hitRef: (r[19] as string | null) ?? null,
    decidedText: (r[20] as string | null) ?? null,
    pageBreakpoint: guardOf(pageUid),
  };
}

function guardOf(pageUid: string): { id: string; note: string | null } | null {
  const bp = specBreakpointOn(pageUid);
  return bp ? { id: bp.id, note: bp.note } : null;
}

function impactsOf(proposalUid: string): ProposalImpact[] {
  return rows(
    `SELECT id, impact, words, tasks, item_uid, plan_uid, author, author_type, session_id, created_at
       FROM spec_proposal_impacts WHERE proposal_uid = ? ORDER BY created_at, id`,
    [proposalUid],
  ).map((r) => {
    const itemUid = (r[4] as string | null) ?? null;
    const planUid = (r[5] as string | null) ?? null;
    return {
      id: r[0] as number,
      impact: r[1] as ImpactKind,
      words: r[2] as string,
      tasks: (r[3] as number | null) ?? null,
      itemUid,
      itemTitle: itemUid ? getItem(itemUid)?.title ?? null : null,
      planUid,
      planTitle: planUid ? getPlan(planUid)?.title ?? null : null,
      author: r[6] as string,
      authorType: r[7] as string,
      sessionId: (r[8] as string | null) ?? null,
      createdAt: r[9] as number,
    };
  });
}

const COLUMNS = `uid, page_uid, plan_uid, section, base_version, before_text, proposed_text, why, evidence, affected,
  author, author_type, session_id, status, created_at, decided_at, decided_by, decided_by_type, decision_note, hit_ref, decided_text`;

/** Make a proposal. Checked by `proposalProblem` first. */
export function proposeSpecChange(
  input: ProposeInput,
  by: { author: string; authorType: string; sessionId?: string | null },
): SpecProposal {
  const page = getItem(input.page)!;
  const section = input.section ?? '';
  const before = section ? sectionText(page.body ?? '', section) ?? '' : page.body ?? '';
  const affected = reliedOnBy(page.uid, section || undefined);
  const uid = randomUUID();
  getDb().run(
    `INSERT INTO spec_proposals (uid, page_uid, plan_uid, section, base_version, before_text, proposed_text, why, evidence,
       affected, author, author_type, session_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    [uid, page.uid, page.planUid, section, pageVersion(page.uid), before, input.text, input.why.trim(),
      JSON.stringify(input.evidence ?? {}), JSON.stringify(affected), by.author, by.authorType, by.sessionId ?? null, Date.now()],
  );
  raiseHit(uid, page.planUid, page.uid, by);
  markDirty();
  return getProposal(uid)!;
}

/**
 * The inbox entry for a new proposal: a `proposal` breakpoint on it, and a
 * hit waiting for a person, as a held agent call would be. Pushed to a phone
 * that is away, like any other.
 */
function raiseHit(uid: string, planUid: string, pageUid: string, by: { author: string; authorType: string; sessionId?: string | null }, now = Date.now()): void {
  const bp = `bp_${randomBytes(6).toString('hex')}`;
  getDb().run(
    `INSERT INTO breakpoints (id, kind, target, plan_uid, note, created_at, created_by, created_by_type)
     VALUES (?, 'proposal', ?, ?, NULL, ?, ?, ?)`,
    [bp, uid, planUid, now, by.author, by.authorType],
  );
  const ref = `bp-${randomBytes(5).toString('hex')}`;
  const workstream = by.sessionId
    ? (rows('SELECT workstream_root FROM agent_sessions WHERE session_id = ?', [by.sessionId])[0]?.[0] as string | null | undefined) ?? null
    : null;
  getDb().run(
    `INSERT INTO breakpoint_hits (ref, breakpoint_id, tool, action, item_uid, plan_uid, agent, session_id, workstream_root, hit_at)
     VALUES (?, ?, 'propose_spec_change', 'propose', ?, ?, ?, ?, ?, ?)`,
    [ref, bp, pageUid, planUid, by.author, by.sessionId ?? null, workstream, now],
  );
  getDb().run('UPDATE spec_proposals SET hit_ref = ? WHERE uid = ?', [ref, uid]);
  const hit = getHit(ref)!;
  recordBreakpointEvent('breakpoint_hit', { ref, kind: 'proposal', action: 'propose', tool: hit.tool, itemUid: pageUid, itemTitle: hit.itemTitle, planUid, agent: by.author, breakpointId: bp, on: uid }, by.author);
  void pushForBreakpoint(hit).catch(() => {});
}

export function getProposal(uid: string): SpecProposal | null {
  const r = rows(`SELECT ${COLUMNS} FROM spec_proposals WHERE uid = ?`, [uid])[0];
  return r ? fromRow(r) : null;
}

/** Proposals, newest first: for a page, for a project (its plans), and by status. */
export function listProposals(filter: { pageUid?: string; projectPath?: string; status?: ProposalStatus } = {}): SpecProposal[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.pageUid) { where.push('s.page_uid = ?'); params.push(filter.pageUid); }
  if (filter.status) { where.push('s.status = ?'); params.push(filter.status); }
  if (filter.projectPath) {
    where.push('s.plan_uid IN (SELECT uid FROM plans WHERE project_path = ? OR project_path = ?)');
    params.push(filter.projectPath, filter.projectPath.replace(/[\\/]+$/, ''));
  }
  const cols = COLUMNS.split(',').map((c) => `s.${c.trim()}`).join(', ');
  return rows(
    `SELECT ${cols} FROM spec_proposals s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC`,
    params,
  ).map(fromRow);
}

/** What a direct edit to a relied-on page should say: who relies on it, and that proposing lets them weigh in. */
export function directEditNote(pageUid: string): string | null {
  const affected = reliedOnBy(pageUid);
  if (affected.length === 0) return null;
  const names = affected.slice(0, 4).map((a) => `"${a.title}" (${a.planTitle})`).join(', ');
  const more = affected.length > 4 ? ` and ${affected.length - 4} more` : '';
  return `${reliedOnWords(affected)}: ${names}${more}. The edit is saved; to change a spec others rely on, propose_spec_change lets their agents weigh in and a person decide first.`;
}

// --- B7.3: addressed, once -------------------------------------------------

const where = (p: SpecProposal): string =>
  `${p.section ? `§ ${p.sectionTitle ?? p.section} of ` : ''}"${p.pageTitle}"`;

/** This session's tasks that rely on the proposal's page or section now. */
function heldBy(sessionId: string, p: SpecProposal): RelianceIn[] {
  const relying = reliedOnBy(p.pageUid, p.section || undefined);
  if (relying.length === 0) return [];
  const mine = new Set(rows(
    `SELECT uid FROM plan_items WHERE assignee_session = ? AND uid IN (${relying.map(() => '?').join(',')})`,
    [sessionId, ...relying.map((r) => r.itemUid)],
  ).map((r) => r[0] as string));
  return relying.filter((r) => mine.has(r.itemUid));
}

const quoted = (text: string, max = 20): string[] => {
  const lines = text.replace(/\n+$/, '').split('\n');
  const shown = lines.slice(0, max).map((l) => `> ${l}`);
  if (lines.length > max) shown.push(`> … ${lines.length - max} more lines (list_spec_proposals has it all)`);
  return shown;
};

function noticeText(p: SpecProposal, mine: RelianceIn[]): string {
  const tasks = mine.map((t) => `"${t.title}" (${t.planTitle})`).join(', ');
  const ev = [
    p.evidence.tests?.length ? `tests ${p.evidence.tests.join(', ')}` : null,
    p.evidence.files?.length ? `files ${p.evidence.files.join(', ')}` : null,
    p.evidence.commits?.length ? `commits ${p.evidence.commits.join(', ')}` : null,
    p.evidence.note ? p.evidence.note : null,
  ].filter(Boolean).join('; ');
  return [
    `${p.author} proposes a change to ${where(p)}. Your ${mine.length === 1 ? 'task' : 'tasks'} ${tasks} ${mine.length === 1 ? 'relies' : 'rely'} on it.`,
    `Why: ${p.why}`,
    ...(ev ? [`Evidence: ${ev}`] : []),
    'Now:',
    ...quoted(p.beforeText || '(empty)'),
    'Proposed:',
    ...quoted(p.proposedText),
    `Nothing changes until a person decides. Say what it would mean for your work: reply_to_spec_proposal("${p.uid}", impact: "none" | "changes", words).`,
  ].join('\n');
}

/**
 * What this session should be told about spec proposals, as one text, or
 * null: open proposals to pages its tasks rely on (never its own; B7.3),
 * specs its tasks rely on that changed by an accepted proposal, and how its
 * own proposals were decided (B7.4). Marks what it delivers as read, so each
 * reaches each session once. Never throws: a notice must not break the tool
 * call it rides on.
 */
export function proposalNoticeFor(
  sessionId: string,
  agentType: string | null,
  now = Date.now(),
  /** The tasks whose agent was just told their spec changed, so the window can say so at once. */
  onTold?: (itemUids: string[]) => void,
): string | null {
  try {
    const changed = specChangedNotice(sessionId, now);
    if (changed && changed.items.length > 0) onTold?.(changed.items);
    const later = [changed?.text ?? null, outcomeNotice(sessionId, now)].filter((x): x is string => !!x);
    const holds = rows('SELECT 1 FROM plan_items WHERE assignee_session = ? LIMIT 1', [sessionId]).length > 0;
    const unread = !holds ? [] : rows(
      `SELECT uid FROM spec_proposals s WHERE s.status = 'open' AND (s.session_id IS NULL OR s.session_id != ?)
         AND NOT EXISTS (SELECT 1 FROM spec_proposal_reads d WHERE d.proposal_uid = s.uid AND d.session_id = ?)
       ORDER BY s.created_at`,
      [sessionId, sessionId],
    ).map((r) => r[0] as string);
    const told: string[] = [];
    for (const uid of unread) {
      const p = getProposal(uid);
      if (!p) continue;
      const mine = heldBy(sessionId, p);
      if (mine.length === 0) continue;
      told.push(noticeText(p, mine));
      getDb().run(
        'INSERT OR IGNORE INTO spec_proposal_reads (proposal_uid, session_id, agent_type, read_at) VALUES (?, ?, ?, ?)',
        [uid, sessionId, agentType, now],
      );
    }
    const notices = [...(told.length ? [[`── CodeTrellis: spec change proposed ──`, told.join('\n\n')].join('\n')] : []), ...later];
    if (notices.length === 0) return null;
    markDirty();
    return notices.join('\n\n');
  } catch (err) {
    console.warn('[Spec] proposal notice failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Sessions told of a proposal, oldest first. */
export function proposalReads(uid: string): Array<{ sessionId: string; agentType: string | null; readAt: number }> {
  return rows('SELECT session_id, agent_type, read_at FROM spec_proposal_reads WHERE proposal_uid = ? ORDER BY read_at', [uid])
    .map((r) => ({ sessionId: r[0] as string, agentType: (r[1] as string | null) ?? null, readAt: r[2] as number }));
}

export interface ImpactInput {
  uid: string;
  impact: ImpactKind;
  words?: string;
  tasks?: number;
}

/** Why an impact cannot be recorded, in a sentence; null when it can. */
export function impactProblem(input: ImpactInput): string | null {
  const p = getProposal(input.uid);
  if (!p) return `No proposal ${input.uid}.`;
  if (p.status !== 'open') return `The proposal to change ${where(p)} was ${p.status}; there is nothing left to weigh in on.`;
  if (input.impact === 'changes' && !input.words?.trim()) return 'Say in a sentence what it would change for your work.';
  if (input.tasks !== undefined && (!Number.isInteger(input.tasks) || input.tasks < 0)) return 'tasks is how many of your tasks it would change: a whole number.';
  return null;
}

/**
 * Record what a proposal would mean for the replying agent's work, and post
 * it as a weigh-in in the proposer's plan (the plan of the task the
 * proposing session holds, else the page's own). Checked by `impactProblem`.
 */
export function replyToProposal(
  input: ImpactInput,
  by: { author: string; authorType: string; sessionId?: string | null },
  now = Date.now(),
): { impact: ProposalImpact; event: ChannelEvent } {
  const p = getProposal(input.uid)!;
  const task = by.sessionId ? heldBy(by.sessionId, p)[0] ?? null : null;
  const words = input.words?.trim() ?? '';
  getDb().run(
    `INSERT INTO spec_proposal_impacts (proposal_uid, impact, words, tasks, item_uid, plan_uid, author, author_type, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.uid, input.impact, words, input.tasks ?? null, task?.itemUid ?? null, task?.planUid ?? null,
      by.author, by.authorType, by.sessionId ?? null, now],
  );
  markDirty();
  const impact = impactsOf(p.uid).at(-1)!;

  const proposerTask = p.sessionId
    ? rows('SELECT uid, plan_uid FROM plan_items WHERE assignee_session = ? ORDER BY updated_at DESC LIMIT 1', [p.sessionId])[0]
    : undefined;
  const from = task ? `"${task.title}" (${task.planTitle})` : by.author;
  const said = input.impact === 'none'
    ? `no impact on ${from}.`
    : `${from} would change${input.tasks !== undefined ? ` (${input.tasks} ${input.tasks === 1 ? 'task' : 'tasks'})` : ''}: ${words}`;
  const event = postChannelEvent({
    planUid: (proposerTask?.[1] as string | undefined) ?? p.planUid,
    itemUid: (proposerTask?.[0] as string | undefined) ?? null,
    eventType: 'weigh-in',
    payload: {
      message: `On the proposed change to ${where(p)}: ${said}`,
      references: { items: [p.pageUid, ...(task ? [task.itemUid] : [])] },
    },
    author: by.author,
    authorType: by.authorType,
  });
  return { impact, event };
}

// --- B7.4: the decision is a person's ----------------------------------------

export type ProposalDecision = 'accept' | 'amend' | 'reject';

export interface DecideInput {
  uid: string;
  decision: ProposalDecision;
  /** The amended text, for amend: the page, or the section with its heading line. */
  text?: string;
  /** Why, in the person's words; the proposer reads it. */
  note?: string;
}

/** The page as it would read with this text, or null when the section is no longer on it. */
function pageWith(p: SpecProposal, text: string): string | null {
  const page = getItem(p.pageUid);
  if (!page) return null;
  return withSectionText(page.body ?? '', p.section || null, text) ?? null;
}

/** Why a decision cannot be made, in a sentence; null when it can. */
export function decisionProblem(input: DecideInput): string | null {
  const p = getProposal(input.uid);
  if (!p) return `No proposal ${input.uid}.`;
  if (p.status !== 'open') return `The proposal to change ${where(p)} was already ${p.status}.`;
  if (!['accept', 'amend', 'reject'].includes(input.decision)) return 'decision is accept, amend or reject.';
  if (input.decision === 'amend' && !input.text?.trim()) return 'Amend needs the text as it should read.';
  if (input.decision !== 'reject') {
    if (!getItem(p.pageUid)) return 'The page no longer exists.';
    const text = input.decision === 'amend' ? input.text! : p.proposedText;
    if (pageWith(p, text) === null) return `"${p.pageTitle}" no longer has the heading "${p.section}". Reject this and ask for a new proposal.`;
  }
  return null;
}

export interface Decided {
  proposal: SpecProposal;
  /** The tasks flagged "spec changed", on accept. */
  flagged: RelianceIn[];
}

/**
 * Decide a proposal, as a person. Checked by `decisionProblem`. Accept and
 * amend write the page's new version (author: the person; the change
 * summary names the proposal), then flag every task relying on the page or
 * section with a `spec_changed` plan event. Reject leaves the page.
 * Either answers the inbox entry, so `await_decision` returns.
 */
export function decideProposal(input: DecideInput, by: { author: string; authorType: string }, now = Date.now()): Decided {
  const p = getProposal(input.uid)!;
  const note = input.note?.trim() || null;
  const accept = input.decision !== 'reject';
  const text = input.decision === 'amend' ? input.text! : p.proposedText;
  let flagged: RelianceIn[] = [];
  if (accept) {
    updateItem(p.pageUid, {
      body: pageWith(p, text)!,
      changeSummary: `Accepted spec proposal ${p.uid.slice(0, 8)}${input.decision === 'amend' ? ', amended' : ''}: ${p.why}`,
      author: by.author,
      authorType: by.authorType,
    } as never);
    flagged = reliedOnBy(p.pageUid, p.section || undefined);
    for (const t of flagged) {
      getDb().run('INSERT OR IGNORE INTO spec_change_flags (item_uid, proposal_uid, created_at) VALUES (?, ?, ?)', [t.itemUid, p.uid, now]);
      appendPlanEvent({
        planUid: t.planUid,
        itemUid: t.itemUid,
        eventType: 'spec_changed',
        afterState: { proposalUid: p.uid, pageUid: p.pageUid, section: p.section },
        summary: `The spec "${t.title}" relies on changed: ${where(p)}`,
        author: by.author,
        authorType: by.authorType,
        createdAt: now,
      });
    }
  }
  getDb().run(
    `UPDATE spec_proposals SET status = ?, decided_at = ?, decided_by = ?, decided_by_type = ?, decision_note = ?, decided_text = ?
     WHERE uid = ? AND status = 'open'`,
    [accept ? 'accepted' : 'rejected', now, by.author, by.authorType, note, input.decision === 'amend' ? text : null, p.uid],
  );
  if (p.hitRef) {
    answerHit({ ref: p.hitRef, decision: accept ? 'continue' : 'stop', note: note ?? (input.decision === 'amend' ? 'Accepted with changes.' : null), by: by.author, byType: by.authorType, now });
    getDb().run(`UPDATE breakpoints SET cleared_at = ?, cleared_by = ?, cleared_by_type = ? WHERE kind = 'proposal' AND target = ? AND cleared_at IS NULL`, [now, by.author, by.authorType, p.uid]);
  }
  markDirty();
  return { proposal: getProposal(p.uid)!, flagged };
}

/** A task's "spec changed" flags, newest first: which proposal, and whether its agent has been told. */
export function specChangedFor(itemUid: string): Array<{ proposalUid: string; pageUid: string; pageTitle: string; section: string; sectionTitle: string | null; at: number; toldAt: number | null }> {
  return rows('SELECT proposal_uid, created_at, read_at FROM spec_change_flags WHERE item_uid = ? ORDER BY created_at DESC', [itemUid])
    .flatMap((r) => {
      const p = getProposal(r[0] as string);
      return p ? [{ proposalUid: p.uid, pageUid: p.pageUid, pageTitle: p.pageTitle, section: p.section, sectionTitle: p.sectionTitle, at: r[1] as number, toldAt: (r[2] as number | null) ?? null }] : [];
    });
}

/** "Spec changed" notices for the tasks this session holds, marked told, with which tasks. */
function specChangedNotice(sessionId: string, now: number): { text: string; items: string[] } | null {
  const flags = rows(
    `SELECT f.item_uid, f.proposal_uid, i.title FROM spec_change_flags f JOIN plan_items i ON i.uid = f.item_uid
      WHERE f.read_at IS NULL AND i.assignee_session = ? ORDER BY f.created_at`,
    [sessionId],
  );
  if (flags.length === 0) return null;
  const items = [...new Set(flags.map((f) => f[0] as string))];
  const parts = flags.map(([itemUid, proposalUid, title]) => {
    getDb().run('UPDATE spec_change_flags SET read_at = ?, read_by_session = ? WHERE item_uid = ? AND proposal_uid = ?', [now, sessionId, itemUid, proposalUid]);
    const p = getProposal(proposalUid as string);
    if (!p) return null;
    return [
      `${where(p)} changed: a person accepted ${p.author}'s proposal${p.decidedText ? ', with changes' : ''}. Your task "${title as string}" relies on it.`,
      ...(p.decisionNote ? [`Their note: ${p.decisionNote}`] : []),
      'It now reads:',
      ...quoted(p.decidedText ?? p.proposedText),
      'Work to the new text; get_spec_links shows the page.',
    ].join('\n');
  }).filter((x): x is string => !!x);
  return parts.length ? { text: ['── CodeTrellis: spec changed ──', parts.join('\n\n')].join('\n'), items } : null;
}

/** The proposing session told how its proposals were decided, once each. */
function outcomeNotice(sessionId: string, now: number): string | null {
  const decided = rows(
    `SELECT uid FROM spec_proposals s WHERE s.session_id = ? AND s.status IN ('accepted', 'rejected')
       AND NOT EXISTS (SELECT 1 FROM spec_proposal_outcome_reads o WHERE o.proposal_uid = s.uid AND o.session_id = ?)
     ORDER BY s.decided_at`,
    [sessionId, sessionId],
  ).map((r) => r[0] as string);
  if (decided.length === 0) return null;
  const parts = decided.map((uid) => {
    getDb().run('INSERT OR IGNORE INTO spec_proposal_outcome_reads (proposal_uid, session_id, read_at) VALUES (?, ?, ?)', [uid, sessionId, now]);
    const p = getProposal(uid)!;
    const note = p.decisionNote ? ` Their note: ${p.decisionNote}` : '';
    return p.status === 'rejected'
      ? `Your proposal to change ${where(p)} was not accepted.${note} The page is as it was; carry on with the spec as it is.`
      : `Your proposal to change ${where(p)} was accepted${p.decidedText ? ', with changes' : ''}; the page has its new version.${note}`;
  });
  return ['── CodeTrellis: spec proposal decided ──', parts.join('\n')].join('\n');
}
