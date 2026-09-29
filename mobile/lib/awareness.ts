/**
 * What overlaps, on the phone (Phase 32 A4.5b, over A4.2 and A4.3's RPC).
 *
 * The desktop holds the words: the digest's lines, each side in a sentence
 * (`src/shared/lib/signal-words.ts`), the Timeline's turns. The phone shows
 * them. A decision (acknowledge, intended, a reply) needs a pairing confirmed
 * on the desktop, and is recorded as the person, from the phone.
 */

import { rpc } from './rpc';

export type SignalKind = 'collision' | 'contract' | 'drift' | 'stale-base';
export type SignalSeverity = 'high' | 'medium' | 'low';
export type SignalState = 'open' | 'acknowledged' | 'intended' | 'dismissed' | 'resolved';

export interface PhoneSignal {
  id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  state: SignalState;
  /** "Changed signature", "Same function". */
  heading: string;
  summary: string;
  sides: string[];
  firstSeen: number;
  lastSeen: number;
}

export interface SignalReply {
  id: number;
  message: string;
  by: { actor: string; actorType: 'human' | 'unverified'; channel: 'desktop' | 'local-api' | 'phone' };
  at: number;
  readBy: Array<{ sessionId: string; agentType: string; readAt: number }>;
}

export interface PhoneSignalDetail extends PhoneSignal {
  sideWords: Array<{ root: string; name: string; words: string }>;
  files: string[];
  told: Array<{ agentType: string; toldAt: number | null; note?: string }>;
  replies: SignalReply[];
  stateBy?: { actor: string; actorType: string; channel: string };
  stateAt?: number;
  reopened?: { from: 'acknowledged' | 'intended'; at: number };
}

export interface DigestLine { text: string; question: string; told: boolean; signalIds: string[] }

export interface PhoneNeedsYou {
  projectRoot: string | null;
  digest: { needsYou: number; low: number; moreLines: number; lines: DigestLine[] };
  signals: PhoneSignal[];
}

export interface PhoneWorkstream {
  id: string;
  name: string;
  branch: string | null;
  shape: 'worktree' | 'shared' | 'branch' | 'clone';
  main: boolean;
  agents: Array<{ agentType: string; model: string | null; source: 'mcp' | 'claude-log'; lastSeen: number | null }>;
  tasks: Array<{ uid: string; title: string; planUid: string; status: string }>;
  changedFiles: number;
  signals: number;
  needsYou: number;
}

export interface PhoneTurn {
  sessionId: string | null;
  agentType: string | null;
  startedAt: number;
  endedAt: number;
  summary: string;
  calls: number;
  files: string[];
  hasError: boolean;
  mutating: boolean;
}

export interface PhoneWorkstreamDetail extends PhoneWorkstream {
  files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; added?: number; removed?: number }>;
  truncated: boolean;
  ahead?: number;
  behind?: number;
  turns: PhoneTurn[];
}

export async function getNeedsYou(): Promise<PhoneNeedsYou> {
  return rpc<PhoneNeedsYou>('awareness.needsYou', {});
}

export async function getSignal(id: string): Promise<PhoneSignalDetail> {
  return (await rpc<{ signal: PhoneSignalDetail }>('awareness.signal', { id })).signal;
}

export async function answerSignal(id: string, state: 'acknowledged' | 'intended' | 'dismissed' | 'open'): Promise<PhoneSignalDetail> {
  return (await rpc<{ signal: PhoneSignalDetail }>('awareness.answer', { id, state })).signal;
}

export async function replyToSignal(id: string, message: string): Promise<PhoneSignalDetail> {
  return (await rpc<{ signal: PhoneSignalDetail }>('awareness.reply', { id, message })).signal;
}

export async function listWorkstreams(): Promise<PhoneWorkstream[]> {
  return (await rpc<{ workstreams: PhoneWorkstream[] }>('workstreams.list', {})).workstreams;
}

export async function getWorkstream(id: string): Promise<PhoneWorkstreamDetail> {
  return (await rpc<{ workstream: PhoneWorkstreamDetail }>('workstreams.detail', { id })).workstream;
}

/** The edge colour of a signal, by severity: the desktop's red, amber and grey. */
export function severityColour(s: SignalSeverity): string {
  return s === 'high' ? '#ef4444' : s === 'medium' ? '#f59e0b' : '#71717a';
}

/** "4 min", "2 h", "3 d". */
export function ago(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
}

/** One name per agent: the same agent seen over MCP and in its own log is one agent. */
export function agentNames(agents: PhoneWorkstream['agents']): string {
  return [...new Set(agents.map((a) => a.agentType + (a.model ? ` (${a.model})` : '')))].join(', ');
}

/** Where a person's message to the agents stands. */
export function replyReadWords(r: Pick<SignalReply, 'readBy'>): string {
  if (r.readBy.length === 0) return 'Not read yet: each agent in this work reads it on its next step';
  const names = [...new Set(r.readBy.map((x) => x.agentType))];
  return `Read by ${names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`}`;
}
