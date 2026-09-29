/**
 * The review queue (Phase 32 A5.4), shared by the backend that builds it and
 * the desktop tab and the phone that show it.
 */

export interface ReviewCriteriaSummary {
  total: number;
  met: number;
  /** Submitted, waiting for a person. */
  waiting: number;
  sentBack: number;
}

export type ReviewQueueStatus = 'ready' | 'held' | 'waiting' | 'in-progress' | 'unavailable';

export interface ReviewQueueLine {
  planUid: string;
  planTitle: string;
  branch: string;
  /** The line of work, as signals name it: its folder, or `branch:<name>`. */
  workstream: string;
  items: number;
  criteria: ReviewCriteriaSummary;
  filesChanged: number;
  blastRadius: number;
  unplannedEdges: number;
  openSignals: number;
  openHigh: number;
  ready: boolean;
  status: ReviewQueueStatus;
  /** Why it has that status, in a sentence. */
  statusWords: string;
  /** 1-based suggested place. */
  position: number;
  /** Why it goes there. */
  reason: string;
  /** Set when the branch could not be reviewed. */
  error?: string;
}

export interface ReviewQueue {
  /** What each line is reviewed against: the main checkout's branch. */
  base: string | null;
  lines: ReviewQueueLine[];
}
