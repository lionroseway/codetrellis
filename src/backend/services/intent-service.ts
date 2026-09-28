/**
 * Declared intent (Phase 32 A2.4, awareness spec §4.2 and §6.1): what an
 * agent says it is about to change, before it changes anything.
 *
 * One intent per MCP session, replaced when it declares again, gone when the
 * session ends. It is held in memory: a restart ends every MCP session, and
 * an intent outliving its agent would be a claim nobody is making.
 *
 * The intent joins the footprint of the workstream the session is in, so an
 * overlap with other work is seen before a file changes. The agent's own
 * summary is kept for the person to read and for the agent itself, but it is
 * never passed to another agent (awareness principle 5): other agents see
 * which paths and symbols are claimed, not what was written.
 */

import path from 'node:path';
import type { WorkstreamIntent } from '../../shared/types';

export const MAX_INTENT_PATHS = 50;
export const MAX_INTENT_SYMBOLS = 50;
export const MAX_INTENT_SUMMARY = 500;

const intents = new Map<string, WorkstreamIntent>();

/**
 * A declared path as the footprint names files: relative to the repository
 * root, `/`-separated. An absolute path is accepted inside one of `roots`
 * (the caller's workstream and the opened project). Anything that climbs out
 * is refused. Nothing is read: these are names, not files.
 */
export function normaliseIntentPath(raw: string, roots: readonly string[]): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  let rel = trimmed;
  if (path.isAbsolute(trimmed)) {
    const inside = roots.map((r) => path.relative(r, trimmed)).find((r) => r && !r.startsWith('..') && !path.isAbsolute(r));
    if (!inside) return null;
    rel = inside;
  }
  const norm = path.posix.normalize(rel.split(path.sep).join('/')).replace(/^\.\//, '');
  if (!norm || norm === '.' || norm.startsWith('../') || norm === '..' || norm.startsWith('/')) return null;
  return norm;
}

/**
 * A declared symbol: `path#name` pins it to a file, a bare name applies to
 * every declared path. Names are identifiers, optionally qualified
 * (`Session.renew`). Returns null for anything else.
 */
export function parseIntentSymbol(raw: string, roots: readonly string[]): { path: string | null; name: string } | null {
  const at = raw.lastIndexOf('#');
  const name = (at >= 0 ? raw.slice(at + 1) : raw).trim();
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name)) return null;
  if (at < 0) return { path: null, name };
  const p = normaliseIntentPath(raw.slice(0, at), roots);
  return p ? { path: p, name } : null;
}

/**
 * The files an intent claims, each with the symbols claimed in it (empty:
 * the whole file). Pure. A pinned symbol's file is claimed even if it was
 * not listed among the paths; a bare name applies to every listed path.
 */
export function intentFiles(intent: Pick<WorkstreamIntent, 'paths' | 'symbols'>): Array<{ path: string; symbols: string[] }> {
  const bare = intent.symbols.filter((s) => !s.includes('#'));
  const files = new Map<string, Set<string>>();
  for (const p of intent.paths) files.set(p, new Set(bare));
  for (const s of intent.symbols) {
    const at = s.lastIndexOf('#');
    if (at < 0) continue;
    const p = s.slice(0, at);
    if (!files.has(p)) files.set(p, new Set());
    files.get(p)!.add(s.slice(at + 1));
  }
  return [...files].map(([p, names]) => ({ path: p, symbols: [...names].sort() })).sort((a, b) => a.path.localeCompare(b.path));
}

/** Declare, replacing the session's previous intent. */
export function declareIntent(intent: WorkstreamIntent): void {
  intents.set(intent.sessionId, intent);
}

export function getIntent(sessionId: string): WorkstreamIntent | null {
  return intents.get(sessionId) ?? null;
}

/** The session ended or withdrew its intent. Returns whether it had one. */
export function clearIntent(sessionId: string): boolean {
  return intents.delete(sessionId);
}

/** Forget every intent. For tests. */
export function clearAllIntents(): void {
  intents.clear();
}
