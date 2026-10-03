/**
 * Awareness on the phone (Phase 32 A4.2, awareness spec §8).
 *
 * The approvals flow is the template: the list and a signal's detail are
 * pulled over RPC, and only a count (`openSignals`) rides in the live
 * snapshot. The words are the desktop's: the digest's lines
 * (`awareness-digest.ts`), and each side in plain words (`signal-words.ts`),
 * named as the strip names them.
 *
 * Answering (acknowledge, intended, dismiss, back to open) and replying to
 * the agents are the person's decisions: they need a pairing confirmed on
 * the desktop, as approving a criterion does, and are audited. The author is
 * the person on the phone (`phoneActor()`, passed in by the router), never a
 * name from the request. A reply goes the desktop's own way
 * (`replyToSignalAsPerson`, A4.1), passed in so this file imports no server.
 */

import { listSignals, setSignalState } from './awareness-service';
import { withTold } from './awareness-notices';
import { withReplies, cleanReply, MAX_REPLY } from './awareness-replies';
import { listWorkstreams } from './workstream-service';
import { getPairedDevice } from './paired-device-service';
import { PeerAuthorizationError } from './peer-capabilities';
import { recordPeerAudit } from './peer-audit-service';
import { buildDigest } from '../../shared/lib/awareness-digest';
import { kindWords, sideWords, type SideWords } from '../../shared/lib/signal-words';
import { sideLabel } from '../../shared/lib/workstream-words';
import { SETTABLE_SIGNAL_STATES } from '../../shared/types';
import type { PeerContext } from './mobile-approvals';
import type { AwarenessSignal, SettableSignalState, SignalReply, SignalStateBy, Workstream } from '../../shared/types';

export const AWARENESS_METHODS = ['awareness.needsYou', 'awareness.signal', 'awareness.answer', 'awareness.reply'] as const;

/** A signal in the phone's list: words first, then the id that opens it. */
export interface PhoneSignal {
  id: string;
  kind: AwarenessSignal['kind'];
  severity: AwarenessSignal['severity'];
  state: AwarenessSignal['state'];
  /** "Changed signature", "Same function". */
  heading: string;
  summary: string;
  /** The sides by name, in order. */
  sides: string[];
  /** A task's material the signal is about (A6.4): its sides are tasks, and it has no direction. */
  material?: string;
  firstSeen: number;
  lastSeen: number;
}

/** One signal in full, for the detail screen. */
export interface PhoneSignalDetail extends PhoneSignal {
  /** Each side and what it is doing. */
  sideWords: SideWords[];
  /** The files it is about. */
  files: string[];
  /** The agents told, and what each said with acknowledge_signal. */
  told: Array<{ agentType: string; toldAt: number | null; note?: string }>;
  replies: SignalReply[];
  /** Who last answered it, and when. */
  stateBy?: SignalStateBy;
  stateAt?: number;
  /** It had been answered and came back when it changed shape. */
  reopened?: AwarenessSignal['reopened'];
}

export interface PhoneNeedsYou {
  /** The opened project, or null: nothing to say without one. */
  projectRoot: string | null;
  digest: { needsYou: number; low: number; moreLines: number; lines: Array<{ text: string; question: string; told: boolean; signalIds: string[] }> };
  /** High and medium signals still in play: open first, then seen. Set-aside ones are left to the desktop. */
  signals: PhoneSignal[];
}

export interface PhoneAwarenessContext {
  /** Who is answering: the person on the phone (`phoneActor()`). */
  who: SignalStateBy;
  projectRoot: string | null;
  /** The desktop's reply path (`replyToSignalAsPerson`). */
  reply: (projectRoot: string, signalId: string, message: string, by: SignalStateBy) => (SignalReply & { signalId: string; steers: string[] }) | null;
}

export async function handleAwarenessMethod(
  method: string,
  params: Record<string, unknown>,
  peer: PeerContext,
  ctx: PhoneAwarenessContext,
): Promise<unknown> {
  switch (method) {
    case 'awareness.needsYou':
      return phoneNeedsYou(ctx.projectRoot);
    case 'awareness.signal':
      return { signal: await phoneSignal(ctx.projectRoot, idOf(params)) };
    case 'awareness.answer':
      return answer(params, peer, ctx);
    case 'awareness.reply':
      return reply(params, peer, ctx);
    default:
      throw new Error(`Unknown awareness method: ${method}`);
  }
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

/** What needs the person, in the digest's words, and the signals to open. */
export async function phoneNeedsYou(projectRoot: string | null): Promise<PhoneNeedsYou> {
  const empty: PhoneNeedsYou = { projectRoot, digest: { needsYou: 0, low: 0, moreLines: 0, lines: [] }, signals: [] };
  if (!projectRoot) return empty;
  // The stored signals, as the snapshot's count reads them: the folder and ref
  // watchers keep them current (scheduleSignalRefresh), window open or not.
  const workstreams = await workstreamsOf(projectRoot);
  const label = (root: string) => sideLabel(root, workstreams);
  const signals = withTold(listSignals(projectRoot));
  const d = buildDigest(signals, label);
  const inPlay = signals
    .filter((s) => s.severity !== 'low' && (s.state === 'open' || s.state === 'acknowledged'))
    .sort((a, b) => Number(a.state !== 'open') - Number(b.state !== 'open') || RANK[a.severity] - RANK[b.severity] || b.lastSeen - a.lastSeen);
  return {
    projectRoot,
    digest: {
      needsYou: d.needsYou,
      low: d.low,
      moreLines: d.moreLines,
      lines: d.lines.map((l) => ({ text: l.text, question: l.question, told: l.told, signalIds: l.signalIds })),
    },
    signals: inPlay.map((s) => toPhoneSignal(s, label)),
  };
}

/** One live signal of the opened project, in full. */
export async function phoneSignal(projectRoot: string | null, id: string): Promise<PhoneSignalDetail> {
  if (!projectRoot) throw new Error('No project is open on the desktop');
  // The labels first: the signal is read after, so it is as current as the answer.
  const workstreams = await workstreamsOf(projectRoot);
  const s = withReplies(withTold(listSignals(projectRoot))).find((x) => x.id === id);
  if (!s) throw new Error('No such open signal in this project');
  const label = (root: string) => sideLabel(root, workstreams);
  return {
    ...toPhoneSignal(s, label),
    sideWords: sideWords(s, label),
    files: filesOf(s),
    told: (s.told ?? []).map((t) => ({ agentType: t.agentType, toldAt: t.toldAt, ...(t.note ? { note: t.note } : {}) })),
    replies: s.replies ?? [],
    ...(s.stateBy ? { stateBy: s.stateBy, stateAt: s.stateAt } : {}),
    ...(s.reopened ? { reopened: s.reopened } : {}),
  };
}

function toPhoneSignal(s: AwarenessSignal, label: (root: string) => string): PhoneSignal {
  return {
    id: s.id,
    kind: s.kind,
    severity: s.severity,
    state: s.state,
    heading: kindWords(s),
    summary: s.summary,
    sides: sideWords(s, label).map((x) => x.name),
    ...(s.subject.material ? { material: s.subject.material } : {}),
    firstSeen: s.firstSeen,
    lastSeen: s.lastSeen,
  };
}

function filesOf(s: AwarenessSignal): string[] {
  const files = new Set<string>();
  if (s.subject.material) files.add(s.subject.material); // a task's material (A6.4)
  if (s.subject.file) files.add(s.subject.file);
  for (const f of s.subject.files ?? []) files.add(f);
  for (const f of s.subject.importers ?? []) files.add(f);
  return [...files];
}

function idOf(params: Record<string, unknown>): string {
  const id = params.id;
  if (typeof id !== 'string' || !id) throw new Error('id is required');
  return id;
}

/** A decision from the phone: a pairing confirmed on the desktop, or nothing. */
function confirmedDevice(peer: PeerContext, what: string) {
  const device = getPairedDevice(peer.fingerprint);
  if (!device?.confirmedAt) throw new PeerAuthorizationError(`${what} needs a pairing confirmed on the desktop`);
  return device;
}

async function answer(params: Record<string, unknown>, peer: PeerContext, ctx: PhoneAwarenessContext): Promise<{ signal: PhoneSignalDetail }> {
  const id = idOf(params);
  const state = params.state as SettableSignalState;
  if (!(SETTABLE_SIGNAL_STATES as readonly unknown[]).includes(state)) throw new Error(`state must be one of ${SETTABLE_SIGNAL_STATES.join(', ')}`);
  const device = confirmedDevice(peer, 'Answering a signal');
  if (!ctx.projectRoot) throw new Error('No project is open on the desktop');
  const updated = setSignalState(ctx.projectRoot, id, state, ctx.who);
  if (!updated) throw new Error('No such open signal in this project');
  recordPeerAudit({ kind: 'decision', fingerprint: peer.fingerprint, alias: device.alias, method: 'awareness.answer', detail: `${state} on signal ${id}` });
  // The window's tab and strip refresh on this, as for an answer given there.
  peer.broadcast?.('awareness-changed', { projectRoot: ctx.projectRoot });
  return { signal: await phoneSignal(ctx.projectRoot, id) };
}

async function reply(params: Record<string, unknown>, peer: PeerContext, ctx: PhoneAwarenessContext): Promise<{ reply: SignalReply; steers: number; signal: PhoneSignalDetail }> {
  const id = idOf(params);
  const message = cleanReply(params.message);
  if (!message) throw new Error(`message must be 1–${MAX_REPLY} characters`);
  const device = confirmedDevice(peer, 'Replying to the agents');
  if (!ctx.projectRoot) throw new Error('No project is open on the desktop');
  const sent = ctx.reply(ctx.projectRoot, id, message, ctx.who);
  if (!sent) throw new Error('No such open signal in this project');
  recordPeerAudit({ kind: 'decision', fingerprint: peer.fingerprint, alias: device.alias, method: 'awareness.reply', detail: `reply on signal ${id}` });
  const { signalId: _s, steers, ...kept } = sent;
  return { reply: kept, steers: steers.length, signal: await phoneSignal(ctx.projectRoot, id) };
}

async function workstreamsOf(projectRoot: string): Promise<Workstream[]> {
  try { return await listWorkstreams(projectRoot, { includeIdle: true }); } catch { return []; }
}
