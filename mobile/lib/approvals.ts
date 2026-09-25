/**
 * Approving from the phone (Phase 31 §12) — the calls, and their shapes.
 *
 * Mirrors `src/backend/services/mobile-approvals.ts` on the desktop. A
 * decision made here is recorded as the person's, on the phone channel,
 * and only for a pairing confirmed on the desktop; the desktop enforces
 * that, and says so in the error when it refuses.
 */

import { rpc } from './rpc';
import { PreviewTransfers, newTransferId } from './preview-transfer';

export type CriterionState = 'open' | 'submitted' | 'met' | 'sent_back' | 'stale';

export interface PhoneEvidence {
  attachmentUid: string | null;
  name: string | null;
  ext: string | null;
  locator: unknown;
  /** The locator in words: "Regional!C14", "page 3", "lines 4–6". */
  where: string;
  note: string | null;
  submittedBy: string;
  submittedAt: number;
}

export interface PhoneCriterion {
  uid: string;
  itemUid: string;
  text: string;
  kind: string;
  policy: 'agent' | 'propose' | 'human';
  state: CriterionState;
  evidence: PhoneEvidence[];
  lastDecision: { decision: 'approved' | 'sent_back'; actor: string; channel: string; note: string | null; at: number } | null;
  changedFiles: string[];
  canApprove: boolean;
  canSendBack: boolean;
}

export interface AwaitingEntry extends PhoneCriterion {
  itemTitle: string;
  planUid: string;
  planTitle: string;
}

export type PhonePreview =
  | { kind: 'image'; name: string; mime: string; base64: string; scaled: boolean }
  | {
    kind: 'text';
    name: string;
    format: 'csv' | 'markdown' | 'text';
    where: string | null;
    outline: string;
    sections: Array<{ heading: string; body: string }>;
    notes: string[];
    /** For a sheet: where the cells shown start, and the cells cited, to mark. */
    grid?: {
      firstRow: number;
      firstCol: number;
      cited: { from: { col: number; row: number }; to: { col: number; row: number } } | null;
    };
  }
  | { kind: 'unavailable'; name: string | null; reason: string };

export async function listAwaiting(): Promise<AwaitingEntry[]> {
  const { entries } = await rpc<{ entries: AwaitingEntry[] }>('criteria.awaiting', {});
  return Array.isArray(entries) ? entries : [];
}

export function listItemCriteria(itemUid: string): Promise<{
  item: { uid: string; title: string; planUid: string };
  criteria: PhoneCriterion[];
}> {
  return rpc('criteria.list', { itemUid });
}

export async function decide(
  criterionUid: string,
  decision: 'approved' | 'sent_back',
  opts: { note?: string; anchor?: { attachmentUid: string; locator: unknown } | null } = {},
): Promise<PhoneCriterion> {
  const { criterion } = await rpc<{ criterion: PhoneCriterion }>('criterion.decide', {
    criterionUid,
    decision,
    ...(opts.note ? { note: opts.note } : {}),
    ...(opts.anchor ? { anchor: opts.anchor } : {}),
  });
  return criterion;
}

/** Collects `preview.chunk` messages; fed by the connection's control handler. */
export const previewTransfers = new PreviewTransfers();

/** Previews already fetched this session, by attachment and place. */
const cache = new Map<string, PhonePreview>();
const MAX_CACHED = 12;

/**
 * The cited place in one piece of evidence. The desktop reads it through
 * its confined reader and streams it back under an id chosen here.
 */
export async function fetchPreview(attachmentUid: string, locator: unknown): Promise<PhonePreview> {
  const key = `${attachmentUid}|${JSON.stringify(locator ?? null)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const transferId = newTransferId();
  const body = previewTransfers.expect(transferId);
  body.catch(() => undefined); // handled below; this only stops an early failure going unobserved
  try {
    // Longer than an ordinary call: a sheet or a scaled image is read
    // and streamed before the answer comes back.
    await rpc('artefact.preview', { attachmentUid, locator: locator ?? null, transferId }, 90_000);
  } catch (err) {
    previewTransfers.cancel(transferId, err instanceof Error ? err.message : String(err));
    await body.catch(() => undefined);
    throw err;
  }
  const preview = JSON.parse(await body) as PhonePreview;
  if (preview.kind !== 'unavailable') {
    cache.set(key, preview);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  }
  return preview;
}

/** Drop cached previews — after a decision the files may be looked at afresh. */
export function clearPreviewCache(): void {
  cache.clear();
}

/** A state in the words the phone shows. */
export function stateLabel(state: CriterionState): string {
  switch (state) {
    case 'submitted': return 'Waiting for you';
    case 'stale': return 'Changed since approved';
    case 'met': return 'Approved';
    case 'sent_back': return 'Sent back';
    default: return 'Not started';
  }
}

export function stateColour(state: CriterionState): string {
  switch (state) {
    case 'submitted': return '#3b82f6';
    case 'stale': return '#f59e0b';
    case 'met': return '#22c55e';
    case 'sent_back': return '#ef4444';
    default: return '#71717a';
  }
}
