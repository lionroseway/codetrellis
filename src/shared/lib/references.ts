/**
 * Short references — `task 9f2c41ab` — that a person can paste to any agent.
 *
 * Steering an agent means pointing at things: "task 9f2c41ab isn't done
 * right, I've left notes". A 36-character uid is unreadable aloud and easy to
 * mangle; the title is ambiguous. So every plan, task, page, comment and
 * attachment has a reference made of its kind and the first eight hex
 * characters of its uid, and every MCP tool that takes a uid accepts one
 * (resolved once, in `mcp/server.ts`).
 *
 * Shared by the frontend (the copy chip) and the backend (the resolver), so
 * the two can never disagree about what a reference looks like. No Node or
 * DOM APIs here.
 */

export type ReferenceKind = 'plan' | 'task' | 'page' | 'comment' | 'attachment';

export const REFERENCE_KINDS: readonly ReferenceKind[] = ['plan', 'task', 'page', 'comment', 'attachment'];

/** Hex characters kept from the uid. Four billion values — see §9 of Phase 31. */
export const SHORT_ID_LENGTH = 8;

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first eight hex characters of a uid, dashes ignored. */
export function shortId(uid: string): string {
  return uid.replace(/-/g, '').slice(0, SHORT_ID_LENGTH).toLowerCase();
}

/** `task 9f2c41ab` */
export function formatReference(kind: ReferenceKind, uid: string): string {
  return `${kind} ${shortId(uid)}`;
}

/**
 * What the copy button puts on the clipboard: a reference an agent can act
 * on, plus just enough context for a person reading the chat to know what it
 * is. `task 9f2c41ab "Q3 revenue summary" (plan "Board pack")`
 */
export function formatReferenceLine(input: {
  kind: ReferenceKind;
  uid: string;
  title?: string | null;
  /** The containing object, e.g. the plan a task is in, or the task a comment is on. */
  within?: { kind: ReferenceKind; uid: string; title?: string | null } | null;
}): string {
  const quote = (t: string) => `"${t.replace(/\s+/g, ' ').trim().slice(0, 80)}"`;
  let line = formatReference(input.kind, input.uid);
  if (input.title && input.title.trim()) line += ` ${quote(input.title)}`;
  if (input.within) {
    const w = input.within;
    if (input.kind === 'comment' || input.kind === 'attachment') {
      line += ` on ${formatReference(w.kind, w.uid)}`;
      if (w.title && w.title.trim()) line += ` ${quote(w.title)}`;
    } else if (w.title && w.title.trim()) {
      line += ` (${w.kind} ${quote(w.title)})`;
    } else {
      line += ` (${formatReference(w.kind, w.uid)})`;
    }
  }
  return line;
}

export interface ParsedReference {
  /** Null when the caller gave a bare prefix. */
  kind: ReferenceKind | null;
  /** Lower-case hex, dashes removed. */
  prefix: string;
}

/**
 * Read a reference out of what an agent passed as a uid.
 *
 * Accepts `task 9f2c41ab`, `task:9f2c41ab`, `#9f2c41ab`, `9f2c41ab` and any
 * longer hex prefix (dashes allowed). Returns null for anything else —
 * including a FULL uid, which needs no resolving — so callers can pass every
 * uid-shaped argument through this and act only on a non-null result.
 */
export function parseReference(raw: unknown): ParsedReference | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (FULL_UUID.test(text)) return null;

  const m = /^(?:(plan|task|page|comment|attachment)\s*[:\s]\s*|#)?([0-9a-f-]+)$/i.exec(text);
  if (!m) return null;
  const prefix = m[2].replace(/-/g, '').toLowerCase();
  if (prefix.length < SHORT_ID_LENGTH || prefix.length >= 32) return null;
  return { kind: (m[1]?.toLowerCase() as ReferenceKind | undefined) ?? null, prefix };
}
