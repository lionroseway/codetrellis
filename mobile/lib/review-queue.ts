/**
 * The review queue, on the phone (Phase 32 A5.6, over A5.4's `review.queue`).
 *
 * The desktop computes it: every line of work with plan items, reviewed
 * against the main checkout's branch, and a suggested merge order with the
 * reason for each place. The phone shows it and opens a line to its review.
 */

import { rpc } from './rpc';

export type QueueStatus = 'ready' | 'held' | 'waiting' | 'in-progress' | 'unavailable';

export interface QueueLine {
  planUid: string;
  planTitle: string;
  branch: string;
  workstream: string;
  items: number;
  criteria: { total: number; met: number; waiting: number; sentBack: number };
  filesChanged: number;
  blastRadius: number;
  unplannedEdges: number;
  openSignals: number;
  openHigh: number;
  ready: boolean;
  status: QueueStatus;
  statusWords: string;
  position: number;
  reason: string;
  error?: string;
}

export interface Queue {
  base: string | null;
  lines: QueueLine[];
}

export async function getReviewQueue(): Promise<Queue> {
  return rpc<Queue>('review.queue', {});
}

/** The same labels and colours as the desktop's Review tab. */
export const QUEUE_STATUS: Record<QueueStatus, { label: string; colour: string }> = {
  ready: { label: 'Ready', colour: '#22c55e' },
  held: { label: 'Held', colour: '#ef4444' },
  waiting: { label: 'Waiting for sign-off', colour: '#f59e0b' },
  'in-progress': { label: 'In progress', colour: '#a1a1aa' },
  unavailable: { label: 'Not reviewed', colour: '#71717a' },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A line's facts in a sentence, leaving out what is zero. */
export function lineFacts(l: QueueLine): string {
  return [
    l.criteria.total ? `${l.criteria.met}/${l.criteria.total} criteria met` : null,
    plural(l.filesChanged, 'file changed', 'files changed'),
    l.blastRadius ? plural(l.blastRadius, 'file affected', 'files affected') : null,
    l.unplannedEdges ? plural(l.unplannedEdges, 'unplanned dependency', 'unplanned dependencies') : null,
    l.openSignals ? plural(l.openSignals, 'open overlap', 'open overlaps') : null,
  ].filter(Boolean).join(' · ');
}
