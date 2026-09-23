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
  /**
   * For an approval: the hash of every file it was taken on, at that
   * moment. A file whose hash no longer matches makes the criterion stale.
   */
  evidenceHashes?: Record<string, string | null>;
  /**
   * For a send-back taken from the exact place (§8.2): the file and the
   * locator the note is about.
   */
  anchor?: { attachmentUid: string; locator: unknown } | null;
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

// ── Phase 31 §8 — the loops ────────────────────────────────────────────

/**
 * One mechanical check. `unverified` means we could not tell — a format we
 * cannot read yet, a file past the size cap — and never refuses anything:
 * only `fail` does.
 */
export interface CheckFinding {
  status: 'pass' | 'fail' | 'unverified';
  /** Said in words, naming the file and the place (§8.1). */
  message: string;
  /** The attachment the finding is about, when there is one. */
  attachmentUid?: string | null;
}

export interface CriterionCheck {
  criterionUid: string;
  itemUid: string;
  /** False when any finding failed. A criterion with nothing mechanical to check is ok. */
  ok: boolean;
  findings: CheckFinding[];
}

export type CheckRunTrigger = 'manual' | 'material_changed' | 'scheduled';

/** One criterion's line in a check run (§8.3). */
export interface CheckRunOutcome {
  criterionUid: string;
  itemUid: string;
  text: string;
  state: CriterionState;
  ok: boolean;
  /** The failed findings' messages. */
  failures: string[];
  /** For a stale criterion: the evidence files that changed since approval. */
  changedFiles: string[];
}

export interface CheckRun {
  uid: string;
  planUid: string;
  trigger: CheckRunTrigger;
  by: string;
  byType: string;
  startedAt: number;
  finishedAt: number;
  outcomes: CheckRunOutcome[];
  /** Against the plan's previous run, in words: "2 went stale — Q3-sales.xlsx changed". */
  sinceLast: string[];
}

/** What an agent owes on a plan, in the order it should work (§8.2). */
export interface WorklistEntry {
  reason: 'sent_back' | 'stale' | 'failing' | 'open';
  criterionUid: string;
  itemUid: string;
  itemTitle: string;
  /** A reference the agent can quote back, e.g. `task 9f2c41ab`. */
  itemRef: string;
  text: string;
  kind: CriterionKind;
  policy: CriterionPolicy;
  /** The person's note, for sent_back. */
  note: string | null;
  /** Where the note points: the evidence it was taken on, with its locator. */
  anchors: Array<{ attachmentUid: string | null; path: string | null; locator: unknown }>;
  /** For stale: which files changed. For failing: what the check said. */
  details: string[];
}
