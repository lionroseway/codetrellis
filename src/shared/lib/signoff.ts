/**
 * Phase 31 §13 — a criterion's sign-off, as the PR draft, the review panel
 * and the sign-off pack all show it. The rows are built on the backend
 * (services/signoff-rows.ts); the words are here so every surface says the
 * same thing about the same row.
 */

import type { CriterionKind, CriterionPolicy, CriterionState } from '../types';

export interface SignoffEvidence {
  /** Project-relative path of the file, or null for a note with no file. */
  path: string | null;
  /** The place cited, as stored — what the viewer opens at. */
  locator: unknown;
  /** The place cited, in words: "Regional!C14", "page 3". */
  where: string;
  /** The hash when the evidence was offered. */
  sha256AtSubmit: string | null;
  /** The hash now — what a reader re-checks against. */
  sha256Now: string | null;
  attachmentUid: string | null;
}

export interface SignoffRow {
  itemUid: string;
  itemTitle: string;
  /** A reference an agent can act on: `task 9f2c41ab`. */
  itemRef: string;
  criterionUid: string;
  /** Verbatim — the requester's words. */
  text: string;
  kind: CriterionKind;
  policy: CriterionPolicy;
  state: CriterionState;
  evidence: SignoffEvidence[];
  /** What the agent said when it offered the evidence. */
  submissionNote: string | null;
  submittedBy: string | null;
  decision: {
    decision: 'approved' | 'sent_back';
    actor: string;
    actorType: string;
    channel: string;
    note: string | null;
    at: number;
    /** The hashes the approval was taken on — what the pack is checked against. */
    evidenceHashes: Record<string, string | null>;
    /** The paired device a person decided on, by its alias; null on the desktop. */
    device: string | null;
  } | null;
  /**
   * Approved by the agent itself, under an `agent` policy — never a
   * person. Listed apart in the pack.
   */
  selfApproved: boolean;
  /** For a stale criterion: the files that changed after it was approved. */
  changedFiles: string[];
}

export function stateWords(row: Pick<SignoffRow, 'state' | 'selfApproved'>): string {
  switch (row.state) {
    case 'met': return row.selfApproved ? 'met (agent-checked)' : 'met';
    case 'submitted': return 'waiting for sign-off';
    case 'sent_back': return 'sent back';
    case 'stale': return 'changed since approved';
    default: return 'not started';
  }
}

const date = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** "saif@… on the phone, 2026-09-25 09:40 UTC", or who self-approved. */
export function decisionWords(row: SignoffRow): string {
  const d = row.decision;
  if (!d) return '—';
  const verb = d.decision === 'approved' ? (row.selfApproved ? 'self-approved by' : 'approved by') : 'sent back by';
  const how = d.channel === 'mcp' ? 'over MCP' : `on the ${d.channel}${d.device ? ` (${d.device})` : ''}`;
  return `${verb} ${d.actor} ${how}, ${date(d.at)}`;
}

export function evidenceWords(row: SignoffRow): string {
  if (row.evidence.length === 0) return '—';
  return row.evidence
    .map((e) => (e.path ? `${e.path.split('/').pop()}${e.where ? ` (${e.where})` : ''}` : 'note'))
    .join('; ');
}

