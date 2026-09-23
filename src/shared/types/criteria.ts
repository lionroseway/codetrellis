/**
 * Phase 31 §4.1–4.3 — acceptance criteria, the evidence offered against
 * them, and the decisions taken on them.
 */

/** What evidence satisfies a criterion. */
export type CriterionKind = 'manual' | 'artefact' | 'citation' | 'code' | 'test';

/**
 * Who may mark a criterion met.
 *  - `agent`   — an agent's submission marks it met (a machine checked it).
 *  - `propose` — an agent's submission waits for a person.
 *  - `human`   — only a person marks it met.
 */
export type CriterionPolicy = 'agent' | 'propose' | 'human';

/**
 * Derived, never stored. `stale` arrives with 31.2, when evidence carries
 * a hash that can stop matching.
 */
export type CriterionState = 'open' | 'submitted' | 'met' | 'sent_back' | 'stale';

export type SignoffDecision = 'approved' | 'sent_back';
export type SignoffChannel = 'desktop' | 'phone' | 'mcp';

export interface CriterionEvidence {
  uid: string;
  submissionUid: string;
  attachmentUid: string | null;
  locator: unknown;
  note: string | null;
  sha256AtSubmit: string | null;
  submittedBy: string;
  submittedByType: string;
  submittedAt: number;
}

export interface CriterionSignoff {
  uid: string;
  criterionUid: string;
  decision: SignoffDecision;
  actor: string;
  actorType: string;
  channel: SignoffChannel;
  note: string | null;
  createdAt: number;
}

export interface ItemCriterion {
  uid: string;
  itemUid: string;
  sortOrder: number;
  /** Verbatim — the requester's wording, never reworded. */
  text: string;
  kind: CriterionKind;
  policy: CriterionPolicy;
  /** How the row came to exist: 'migrated' | 'gate' | 'import' | null. */
  source: string | null;
  author: string;
  authorType: string;
  createdAt: number;
  updatedAt: number;
  state: CriterionState;
  /** The most recent submission's evidence rows, oldest first. */
  latestSubmission: CriterionEvidence[];
  /** The most recent decision, if any. */
  latestSignoff: CriterionSignoff | null;
}
