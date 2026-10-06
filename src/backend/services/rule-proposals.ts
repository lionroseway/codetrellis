/**
 * Phase 33 R3 — an agent proposes a change to an architecture rule; a person
 * decides (design §4.2).
 *
 * Agents never write the rule files through CodeTrellis. `propose_rule`
 * keeps the change an agent wants, with why and what it would do against the
 * code (the same preview a person sees before changing a rule in the app),
 * and the person accepts or rejects it in the app. Accepting is the person's
 * change: it is made, and a loosening signed, exactly as if they had made it
 * themselves. An agent that edits the files directly is caught by the check
 * (R2).
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';

export type RuleProposalStatus = 'open' | 'accepted' | 'rejected';

export interface RuleProposal {
  uid: string;
  projectRoot: string;
  ruleId: string;
  /** The rule's fields as proposed, or null for stopping the rule. */
  body: Record<string, unknown> | null;
  why: string;
  /** What it would do when proposed: loosens, tightens, reworded, or null for no change to how code is judged. */
  effect: string | null;
  words: string;
  author: string;
  authorType: string;
  sessionId: string | null;
  status: RuleProposalStatus;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  decidedByType: string | null;
  decisionNote: string | null;
}

const COLS = 'uid, project_root, rule_id, body, why, effect, words, author, author_type, session_id, status, created_at, decided_at, decided_by, decided_by_type, decision_note';

function fromRow(r: unknown[]): RuleProposal {
  let body: Record<string, unknown> | null = null;
  try { body = r[3] == null ? null : JSON.parse(String(r[3])) as Record<string, unknown>; } catch { body = null; }
  return {
    uid: String(r[0]), projectRoot: String(r[1]), ruleId: String(r[2]), body, why: String(r[4]),
    effect: r[5] == null ? null : String(r[5]), words: String(r[6]), author: String(r[7]), authorType: String(r[8]),
    sessionId: r[9] == null ? null : String(r[9]), status: String(r[10]) as RuleProposalStatus, createdAt: Number(r[11]),
    decidedAt: r[12] == null ? null : Number(r[12]), decidedBy: r[13] == null ? null : String(r[13]),
    decidedByType: r[14] == null ? null : String(r[14]), decisionNote: r[15] == null ? null : String(r[15]),
  };
}

export function addRuleProposal(input: {
  projectRoot: string; ruleId: string; body: Record<string, unknown> | null; why: string; effect: string | null; words: string;
  author: string; authorType: string; sessionId: string | null;
}, now = Date.now()): RuleProposal {
  const uid = randomUUID();
  getDb().run(
    `INSERT INTO rule_proposals (uid, project_root, rule_id, body, why, effect, words, author, author_type, session_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    [uid, input.projectRoot, input.ruleId, input.body ? JSON.stringify(input.body) : null, input.why, input.effect, input.words,
      input.author, input.authorType, input.sessionId, now],
  );
  markDirty();
  return getRuleProposal(uid)!;
}

export function getRuleProposal(uid: string): RuleProposal | null {
  const r = getDb().exec(`SELECT ${COLS} FROM rule_proposals WHERE uid = ?`, [uid])[0]?.values[0];
  return r ? fromRow(r) : null;
}

/** A project's proposals, open ones first, newest first within each. */
export function listRuleProposals(projectRoot: string, status?: RuleProposalStatus): RuleProposal[] {
  const where = status ? 'AND status = ?' : '';
  const rows = getDb().exec(
    `SELECT ${COLS} FROM rule_proposals WHERE project_root = ? ${where} ORDER BY (status = 'open') DESC, created_at DESC LIMIT 200`,
    status ? [projectRoot, status] : [projectRoot],
  )[0]?.values ?? [];
  return rows.map(fromRow);
}

export function decideRuleProposal(uid: string, status: 'accepted' | 'rejected', by: { author: string; authorType: string }, note: string | null, now = Date.now()): RuleProposal | null {
  getDb().run(
    `UPDATE rule_proposals SET status = ?, decided_at = ?, decided_by = ?, decided_by_type = ?, decision_note = ? WHERE uid = ? AND status = 'open'`,
    [status, now, by.author, by.authorType, note, uid],
  );
  markDirty();
  return getRuleProposal(uid);
}
