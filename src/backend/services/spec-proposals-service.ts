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
 */
import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import { getItem } from './plan-item-service';
import { getPlan } from './plan-service';
import { postChannelEvent } from './channel-event-service';
import { reliedOnBy, reliedOnWords, type RelianceIn } from './spec-links-service';
import type { ChannelEvent } from '../../shared/types';
import { findSection, sectionText } from '../../shared/lib/spec-sections';

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
  };
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
  author, author_type, session_id, status, created_at, decided_at, decided_by, decided_by_type, decision_note`;

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
  markDirty();
  return getProposal(uid)!;
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
 * The open proposals this session has not been told of and holds a task
 * relying on, as one notice, or null. Never the proposer's own session.
 * Marks what it delivers as read, so each reaches each session once. Never
 * throws: a notice must not break the tool call it rides on.
 */
export function proposalNoticeFor(sessionId: string, agentType: string | null, now = Date.now()): string | null {
  try {
    if (rows('SELECT 1 FROM plan_items WHERE assignee_session = ? LIMIT 1', [sessionId]).length === 0) return null;
    const unread = rows(
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
    if (told.length === 0) return null;
    markDirty();
    return [`── CodeTrellis: spec change proposed ──`, told.join('\n\n')].join('\n');
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
