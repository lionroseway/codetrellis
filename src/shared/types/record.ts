/**
 * The record (Phase 32 B10.1): the agent event log as a hash chain, and
 * what walking it found.
 */

export type RecordProblemKind = 'changed' | 'removed' | 'relinked' | 'unlinked';

export interface RecordProblem {
  /** The link number, or null for an event with no link. */
  seq: number | null;
  eventId: string;
  kind: RecordProblemKind;
  /** When the event says it happened, where it is still there. */
  at: number | null;
  type: string | null;
  agentType: string | null;
}

export interface RecordCheck {
  ok: boolean;
  /** Links checked. */
  entries: number;
  /** When the first kept link was written, or null with none. */
  since: number | null;
  /** Links up to this number were trimmed by retention (0: none). */
  trimmedThrough: number;
  head: { seq: number; hash: string };
  problems: RecordProblem[];
  /** One sentence for a person. */
  words: string;
}
