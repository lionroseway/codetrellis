/**
 * Phase 31 §12 — approving work from the phone.
 *
 * The phone is the second of the two routes a person's decision arrives by
 * (human-decision.ts): the peer identity comes from DTLS (Phase 19), the
 * capability matrix has already admitted the method by the time anything
 * here runs, and a decision is issued as a `HumanDecision` on the `phone`
 * channel — never from anything the request says about who is asking.
 *
 * Four methods, all reached through `mobile-rpc-service`'s router:
 *
 *   criteria.awaiting   what is waiting on a person, across every plan
 *   criteria.list       one item's criteria, with each piece of evidence
 *                       described well enough to open it
 *   criterion.decide    approve, or send back with a note
 *   artefact.preview    the cited place in a piece of evidence, streamed
 *
 * A preview is streamed rather than returned. One control-channel message
 * is capped (64 KB by the phone's SDP), and an image or a sheet does not
 * fit, so the reply goes out as `preview.chunk` messages to the device
 * that asked — only to it — under an id the phone chose and is waiting
 * for. The RPC answer says how many chunks to expect.
 *
 * What the phone sees is what `read_material` reads (§5.1): the same
 * confined, capped read in a throwaway process, focused on the evidence's
 * locator — a sheet's cells, a document's page, a deck's slide, lines of
 * a file — and images as themselves, scaled down where the desktop can.
 */

import path from 'node:path';
import * as criteriaService from './criteria-service';
import { refreshArtefactHashes, getArtefact } from './artefact-service';
import { getItem } from './plan-item-service';
import { issueHumanDecision } from './human-decision';
import { getAuthorKey } from './settings-service';
import { getPairedDevice } from './paired-device-service';
import { PeerAuthorizationError } from './peer-capabilities';
import { recordPeerAudit } from './peer-audit-service';
import { readMaterial, type MaterialRead } from './material-reader/reader-host';
import type { MaterialLocator } from './material-reader/read';
import { describeLocator } from '../../shared/lib/locator';
import type { CriterionEvidence, ItemCriterion } from '../../shared/types';

// ── Shapes the phone receives ─────────────────────────────────────────

export interface PhoneEvidence {
  attachmentUid: string | null;
  /** The file's name, for the label — null for a note with no file. */
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
  kind: ItemCriterion['kind'];
  policy: ItemCriterion['policy'];
  state: ItemCriterion['state'];
  evidence: PhoneEvidence[];
  /** The latest decision, if any, in words the phone shows as they are. */
  lastDecision: { decision: 'approved' | 'sent_back'; actor: string; channel: string; note: string | null; at: number } | null;
  /** For a stale criterion: the files that changed since it was approved. */
  changedFiles: string[];
  /** What a person may do with it now — the desktop's CriteriaBlock rule. */
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
  }
  | { kind: 'unavailable'; name: string | null; reason: string };

// ── Limits ────────────────────────────────────────────────────────────

/** Characters of text a preview carries — a phone screen, not a report. */
export const PREVIEW_TEXT_CHARS = 40_000;
/** An image sent as it is, where nothing on this build can scale it. */
export const PREVIEW_IMAGE_BYTES = 3 * 1024 * 1024;
/** Characters per `preview.chunk` — well under the phone's 64 KB message cap. */
export const PREVIEW_CHUNK_CHARS = 16_000;
/** The phone chose it; it is echoed back and never looked up. */
const TRANSFER_ID = /^[A-Za-z0-9-]{8,64}$/;

// ── Scaling images down (Electron) ─────────────────────────────────────

export type ImageScaler = (bytes: Buffer, mime: string) => { bytes: Buffer; mime: string } | null;
let scaler: ImageScaler | null = null;

/**
 * The desktop shell sets this to scale an image for a phone screen (a
 * JPEG a phone can show without holding the original). Where it is not set
 * — the backend under plain Node — an image goes as it is, up to a cap.
 */
export function setPreviewImageScaler(fn: ImageScaler | null): void {
  scaler = fn;
}

// ── The methods ──────────────────────────────────────────────────────

export const APPROVAL_METHODS = ['criteria.awaiting', 'criteria.list', 'criterion.decide', 'artefact.preview'] as const;

export interface PeerContext {
  fingerprint: string;
  /** Sends one control message to THIS peer only. */
  send: (message: Record<string, unknown>) => void;
  /** Tells every open desktop window what changed (the server's broadcast). */
  broadcast?: (type: string, data: unknown) => void;
}

export async function handleApprovalMethod(
  method: string,
  params: Record<string, unknown>,
  peer: PeerContext,
): Promise<unknown> {
  switch (method) {
    case 'criteria.awaiting':
      return awaiting(params);
    case 'criteria.list':
      return criteriaForItem(requireUid(params, 'itemUid'));
    case 'criterion.decide':
      return decide(requireUid(params, 'criterionUid'), params, peer);
    case 'artefact.preview':
      return preview(params, peer);
    default:
      throw new Error(`Unknown approval method: ${method}`);
  }
}

function awaiting(params: Record<string, unknown>): { entries: AwaitingEntry[] } {
  const limit = typeof params.limit === 'number' && params.limit > 0 ? Math.min(params.limit, 200) : 100;
  return {
    entries: criteriaService.listAwaitingPerson(limit).map((a) => ({
      ...toPhone(a.criterion),
      itemTitle: a.itemTitle,
      planUid: a.planUid,
      planTitle: a.planTitle,
    })),
  };
}

async function criteriaForItem(itemUid: string): Promise<{
  item: { uid: string; title: string; planUid: string };
  criteria: PhoneCriterion[];
}> {
  const item = getItem(itemUid);
  if (!item) throw new Error('Item not found');
  // The authoritative check (§4.4): the files may have changed while no
  // watcher was looking, and the person is about to judge them.
  await refreshArtefactHashes(itemUid).catch(() => []);
  return {
    item: { uid: item.uid, title: item.title, planUid: item.planUid },
    criteria: criteriaService.listCriteria(itemUid).map(toPhone),
  };
}

async function decide(
  criterionUid: string,
  params: Record<string, unknown>,
  peer: PeerContext,
): Promise<{ criterion: PhoneCriterion }> {
  // A decision is recorded as a PERSON'S. The capability matrix admits
  // `write` for any paired device; a sign-off additionally needs the
  // pairing to have been confirmed on the desktop, so a device the person
  // never confirmed cannot put their name to anything.
  const device = getPairedDevice(peer.fingerprint);
  if (!device?.confirmedAt) {
    throw new PeerAuthorizationError('Approving needs a pairing confirmed on the desktop');
  }
  const before = criteriaService.getCriterion(criterionUid);
  if (!before) throw new criteriaService.CriterionError('Criterion not found', 404);
  // A decision records the hashes of what it was taken on — take them fresh.
  await refreshArtefactHashes(before.itemUid).catch(() => []);

  const criterion = criteriaService.decideCriterion(
    criterionUid,
    { decision: params.decision, note: params.note, anchor: params.anchor },
    issueHumanDecision('phone', getAuthorKey('human')),
  );

  // The sign-off says a person decided, on the phone. Which phone is
  // the device's business, and the audit is where that is kept.
  recordPeerAudit({
    kind: 'decision',
    fingerprint: peer.fingerprint,
    alias: device.alias,
    method: 'criterion.decide',
    detail: `${params.decision === 'approved' ? 'approved' : 'sent back'} criterion ${criterionUid}`,
  });
  peer.broadcast?.('plan-item-criteria-changed', { planUid: getItem(criterion.itemUid)?.planUid ?? null, itemUid: criterion.itemUid });
  return { criterion: toPhone(criterion) };
}

/**
 * Stream a preview of one piece of evidence to the peer that asked.
 *
 * The attachment is resolved by uid under its own item's trusted project
 * root (artefact-content-service); nothing about a location comes from
 * the request. The locator only narrows what is read.
 */
async function preview(
  params: Record<string, unknown>,
  peer: PeerContext,
): Promise<{ transferId: string; total: number; chars: number; kind: PhonePreview['kind'] }> {
  const transferId = params.transferId;
  if (typeof transferId !== 'string' || !TRANSFER_ID.test(transferId)) {
    throw new Error('transferId must be 8–64 letters, digits or dashes');
  }
  const attachmentUid = requireUid(params, 'attachmentUid');
  const artefact = getArtefact(attachmentUid);
  if (!artefact) throw new Error('No evidence file with that uid');

  const built = await buildPreview(attachmentUid, sanitiseLocator(params.locator));
  const body = JSON.stringify(built);
  const total = Math.max(1, Math.ceil(body.length / PREVIEW_CHUNK_CHARS));
  for (let seq = 0; seq < total; seq++) {
    peer.send({
      mcp: true,
      cmd: 'preview.chunk',
      id: transferId,
      seq,
      total,
      data: body.slice(seq * PREVIEW_CHUNK_CHARS, (seq + 1) * PREVIEW_CHUNK_CHARS),
    });
  }
  return { transferId, total, chars: body.length, kind: built.kind };
}

export async function buildPreview(
  attachmentUid: string,
  locator: MaterialLocator | null,
  read: typeof readMaterial = readMaterial,
): Promise<PhonePreview> {
  const artefact = getArtefact(attachmentUid);
  const ext = artefact ? path.extname(artefact.path).slice(1).toLowerCase() : '';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
  // An image is read whole; a locator on one is refused by the reader.
  const result: MaterialRead = await read(attachmentUid, isImage ? null : locator);
  if (!result.ok) return { kind: 'unavailable', name: result.name ?? null, reason: result.reason };

  if (result.kind === 'image') {
    const original = Buffer.from(result.base64, 'base64');
    const scaled = scaler ? safeScale(original, result.mimeType) : null;
    if (scaled) return { kind: 'image', name: result.name, mime: scaled.mime, base64: scaled.bytes.toString('base64'), scaled: true };
    if (original.length > PREVIEW_IMAGE_BYTES) {
      return {
        kind: 'unavailable',
        name: result.name,
        reason: `${result.name} is larger than the ${PREVIEW_IMAGE_BYTES / 1024 / 1024} MB the phone is sent — open it on the desktop`,
      };
    }
    return { kind: 'image', name: result.name, mime: result.mimeType, base64: result.base64, scaled: false };
  }

  const { reply } = result;
  const notes = [...reply.notes];
  let budget = PREVIEW_TEXT_CHARS;
  const sections: Array<{ heading: string; body: string }> = [];
  for (const s of reply.sections) {
    if (budget <= 0) break;
    if (s.body.length > budget) {
      sections.push({ heading: s.heading, body: s.body.slice(0, budget) });
      notes.push('Cut short for the phone — the whole of it is on the desktop.');
      budget = 0;
      break;
    }
    sections.push(s);
    budget -= s.body.length;
  }
  if (sections.length < reply.sections.length && !notes.some((n) => n.startsWith('Cut short'))) {
    notes.push('Cut short for the phone — the whole of it is on the desktop.');
  }
  return {
    kind: 'text', name: result.name, format: reply.format, where: reply.where, outline: reply.outline, sections, notes,
  };
}

function safeScale(bytes: Buffer, mime: string): { bytes: Buffer; mime: string } | null {
  try {
    return scaler?.(bytes, mime) ?? null;
  } catch (err) {
    console.warn('[Approvals] Could not scale an image for the phone:', err);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function requireUid(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(v)) throw new Error(`${key} is required`);
  return v;
}

/** Only the fields the reader narrows by, each of the type it takes. */
export function sanitiseLocator(raw: unknown): MaterialLocator | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const l = raw as Record<string, unknown>;
  const out: MaterialLocator = {};
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : undefined);
  const span = (v: unknown): number | string | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number')) return `${v[0]}-${v[1]}`;
    return str(v);
  };
  out.sheet = str(l.sheet);
  out.range = str(l.range);
  out.page = span(l.page);
  out.lines = span(l.lines);
  out.text = str(l.text);
  for (const k of Object.keys(out) as Array<keyof MaterialLocator>) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length > 0 ? out : null;
}

function toEvidence(e: CriterionEvidence): PhoneEvidence {
  const artefact = e.attachmentUid ? getArtefact(e.attachmentUid) : null;
  const name = artefact ? path.basename(artefact.path) : null;
  return {
    attachmentUid: e.attachmentUid,
    name,
    ext: name ? path.extname(name).slice(1).toLowerCase() || null : null,
    locator: e.locator,
    where: describeLocator(e.locator),
    note: e.note,
    submittedBy: e.submittedBy,
    submittedAt: e.submittedAt,
  };
}

export function toPhone(c: ItemCriterion): PhoneCriterion {
  const signoff = c.latestSignoff;
  let changedFiles: string[] = [];
  if (c.state === 'stale' && signoff?.evidenceHashes) {
    const recorded = signoff.evidenceHashes;
    changedFiles = Object.keys(recorded)
      .filter((uid) => (getArtefact(uid)?.sha256 ?? null) !== recorded[uid])
      .map((uid) => getArtefact(uid)?.path ?? uid);
  }
  return {
    uid: c.uid,
    itemUid: c.itemUid,
    text: c.text,
    kind: c.kind,
    policy: c.policy,
    state: c.state,
    evidence: c.latestSubmission.map(toEvidence),
    lastDecision: signoff
      ? { decision: signoff.decision, actor: signoff.actor, channel: signoff.channel, note: signoff.note, at: signoff.createdAt }
      : null,
    changedFiles,
    // The desktop's rule, the same here (CriteriaBlock): approve anything
    // not already met; send back what was submitted, or take back an
    // approval.
    canApprove: c.state !== 'met',
    canSendBack: c.state === 'submitted' || c.state === 'met',
  };
}
