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
 */
import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import { getItem } from './plan-item-service';
import { reliedOnBy, reliedOnWords, type RelianceIn } from './spec-links-service';
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
  };
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
