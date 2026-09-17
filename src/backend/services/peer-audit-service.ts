/**
 * What paired devices actually did.
 *
 * Phase 19, finding 15.
 *
 * WHY THIS EXISTS
 *
 * The capability matrix decides what a device MAY do. It cannot tell the user
 * what a device DID. Those are different questions, and the second is the one
 * asked after the fact: a phone was lost, a pairing was made on a shared
 * network, someone wants to know whether terminal output left the machine.
 *
 * Without a record the honest answer is "no idea", and console logs do not
 * count — they rotate, they are not addressable from the UI, and on a packaged
 * desktop app nobody is reading them.
 *
 * WHAT IS RECORDED, AND WHAT IS DELIBERATELY NOT
 *
 * Recorded:
 *   - every REFUSED call, with the capability that was missing;
 *   - every call that carries terminal data off the machine — the inventory,
 *     scrollback and live output the review names specifically;
 *   - every change to what a device is allowed to do, including who made it.
 *
 * Not recorded: ordinary reads. A line per `plan.list` would bury the entries
 * that matter under polling traffic, and the log would become the thing nobody
 * reads for the same reason the console is.
 *
 * NOT recorded either: the terminal output itself. This says a device read
 * scrollback from terminal N at a time; it does not keep a second copy of what
 * was in it. An audit trail that duplicates the sensitive data is a second
 * place to steal it from.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getSettingsDir } from './persistence';

/** Kinds of event worth keeping. */
export type PeerAuditKind =
  | 'refused'          // an RPC the device was not allowed to make
  | 'terminal-access'  // terminal inventory / scrollback / live output / input
  | 'capability-change'; // the user granted or revoked something

export interface PeerAuditEntry {
  /** ISO timestamp. */
  at: string;
  kind: PeerAuditKind;
  /** Device fingerprint — full, so entries can be filtered per device. */
  fingerprint: string;
  /** Alias at the time of the event; a later rename must not rewrite history. */
  alias: string;
  /** RPC method, or the settings action for a capability change. */
  method: string;
  /** Short human-readable detail. Never contains terminal content. */
  detail?: string;
}

/**
 * How many entries are kept.
 *
 * A bounded file rather than an unbounded one: this is written from a path a
 * networked peer can drive, so it must not be a way to fill the disk. 2000 is
 * weeks of ordinary use and a few minutes of someone hammering it — and when
 * someone IS hammering it, the recent entries are the interesting ones anyway.
 */
const MAX_ENTRIES = 2000;

let entries: PeerAuditEntry[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function auditPath(): string {
  return path.join(getSettingsDir(), 'peer-audit.json');
}

function ensureLoaded(): PeerAuditEntry[] {
  if (entries) return entries;
  try {
    const raw = JSON.parse(fs.readFileSync(auditPath(), 'utf-8'));
    entries = Array.isArray(raw) ? (raw as PeerAuditEntry[]).slice(-MAX_ENTRIES) : [];
  } catch {
    // Missing or corrupt: an unreadable audit log must not stop the app, but
    // it also must not be silently treated as "nothing happened" — so start
    // fresh and say so.
    entries = [];
  }
  return entries;
}

/**
 * Persist soon, not now.
 *
 * Writes are coalesced because a peer streaming terminal output produces a
 * burst of entries, and a synchronous write per entry would turn the audit
 * trail into a throughput problem. The window is short enough that a crash
 * loses at most a second of history.
 */
function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushAudit();
  }, 1000);
  // Do not hold the process open for the audit log alone.
  if (typeof flushTimer === 'object' && flushTimer && 'unref' in flushTimer) {
    (flushTimer as unknown as { unref: () => void }).unref();
  }
}

/** Write pending entries to disk immediately. */
export function flushAudit(): void {
  if (!entries) return;
  try {
    const dir = path.dirname(auditPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(auditPath(), JSON.stringify(entries, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[PeerAudit] Failed to persist:', err);
  }
}

/** Record one event. */
export function recordPeerAudit(entry: Omit<PeerAuditEntry, 'at'>): void {
  const all = ensureLoaded();
  all.push({ at: new Date().toISOString(), ...entry });
  if (all.length > MAX_ENTRIES) all.splice(0, all.length - MAX_ENTRIES);
  scheduleFlush();
}

/**
 * Read the trail, newest first.
 *
 * @param fingerprint  Limit to one device.
 * @param limit        Cap the number returned.
 */
export function listPeerAudit(opts: { fingerprint?: string; limit?: number } = {}): PeerAuditEntry[] {
  const all = ensureLoaded();
  const filtered = opts.fingerprint
    ? all.filter((e) => e.fingerprint === opts.fingerprint)
    : all;
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), MAX_ENTRIES);
  return filtered.slice(-limit).reverse();
}

/**
 * Which terminal an audited call touched, if the params say so.
 *
 * Deliberately narrow — an id or an index, and nothing else. `terminal.write`
 * params carry keystrokes and `terminal.read` results carry command output; a
 * detail field that took whatever it was handed would end up recording exactly
 * what the user would least like recorded, in a file kept for months.
 *
 * Anything unrecognised produces no detail rather than a best guess.
 */
export function terminalAuditDetail(params: Record<string, unknown>): string | undefined {
  const id = params.terminalId ?? params.id;
  if (typeof id === 'string' && id) return `terminal ${sanitiseId(id)}`;
  if (typeof params.index === 'number' && Number.isFinite(params.index)) {
    return `terminal #${params.index}`;
  }
  return undefined;
}

/** Terminal ids are opaque handles; anything else in the field is not one. */
function sanitiseId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/** Test seam: drop the cache so the next read comes off disk. */
export function _resetAuditCache(): void {
  entries = null;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
