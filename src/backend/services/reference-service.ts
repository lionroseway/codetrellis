/**
 * Resolve `task 9f2c41ab` — or a bare prefix — to the full uid it names.
 *
 * See `shared/lib/references.ts` for the format and why it exists. This is
 * the lookup half: which row does a prefix name, and what is it.
 *
 * A reference is NOT a capability. Resolving one grants nothing: the tool it
 * is handed to still checks its own capability and project scope. And a
 * prefix only ever expands to a uid that already exists, which the caller
 * could have named in full.
 */

import { getDb } from './database';
import type { ReferenceKind, ParsedReference } from '../../shared/lib/references';
import { formatReference, parseReference } from '../../shared/lib/references';

export interface ReferenceMatch {
  kind: ReferenceKind;
  uid: string;
  title: string;
}

/**
 * Where each kind lives. `plan_items` holds both tasks (`action`) and pages
 * (`object`), so it is queried once and split on `kind`.
 */
const LOOKUPS: Array<{
  kinds: ReferenceKind[];
  sql: string;
  toMatch: (row: unknown[]) => ReferenceMatch;
}> = [
  {
    kinds: ['plan'],
    sql: `SELECT uid, title FROM plans WHERE REPLACE(uid, '-', '') LIKE ? LIMIT 6`,
    toMatch: (r) => ({ kind: 'plan', uid: String(r[0]), title: String(r[1] ?? '') }),
  },
  {
    kinds: ['task', 'page'],
    sql: `SELECT uid, title, kind FROM plan_items WHERE REPLACE(uid, '-', '') LIKE ? LIMIT 6`,
    toMatch: (r) => ({ kind: r[2] === 'object' ? 'page' : 'task', uid: String(r[0]), title: String(r[1] ?? '') }),
  },
  {
    kinds: ['comment'],
    sql: `SELECT uid, body FROM comments WHERE REPLACE(uid, '-', '') LIKE ? LIMIT 6`,
    toMatch: (r) => ({ kind: 'comment', uid: String(r[0]), title: String(r[1] ?? '').slice(0, 80) }),
  },
  {
    kinds: ['attachment'],
    sql: `SELECT uid, COALESCE(label, value) FROM attachments WHERE REPLACE(uid, '-', '') LIKE ? LIMIT 6`,
    toMatch: (r) => ({ kind: 'attachment', uid: String(r[0]), title: String(r[1] ?? '') }),
  },
];

/** Every row a reference could mean. Empty: nothing. More than one: ambiguous. */
export function findReferenceMatches(ref: ParsedReference): ReferenceMatch[] {
  const db = getDb();
  const out: ReferenceMatch[] = [];
  for (const lookup of LOOKUPS) {
    if (ref.kind && !lookup.kinds.includes(ref.kind)) continue;
    const rows = db.exec(lookup.sql, [`${ref.prefix}%`])[0]?.values ?? [];
    for (const row of rows) {
      const match = lookup.toMatch(row);
      if (!ref.kind || match.kind === ref.kind) out.push(match);
    }
  }
  return out;
}

export class AmbiguousReferenceError extends Error {
  constructor(readonly raw: string, readonly candidates: ReferenceMatch[]) {
    super(
      `"${raw}" matches ${candidates.length} things: `
      + candidates
        .slice(0, 5)
        .map((c) => `${formatReference(c.kind, c.uid)} (${c.uid})${c.title ? ` "${c.title}"` : ''}`)
        .join('; ')
      + '. Pass the full uid, or a longer prefix.',
    );
    this.name = 'AmbiguousReferenceError';
  }
}

export interface ReferenceNote {
  reference: string;
  author: string;
  authorType: string;
  body: string;
  createdAt: number;
}

export interface ReferenceDescription {
  reference: string;
  kind: ReferenceKind;
  uid: string;
  title: string;
  status?: string;
  plan?: { reference: string; uid: string; title: string };
  /** For a comment or attachment: what it is on. */
  on?: { reference: string; uid: string; title: string } | null;
  body?: string;
  /** Newest first — what a person said about it. The reason it was pointed at. */
  notes: ReferenceNote[];
}

const NOTE_LIMIT = 5;

/** Comments on a target, or replies to a comment (`by: 'parent_uid'`). */
function notesOn(uid: string, by: 'target_uid' | 'parent_uid' = 'target_uid'): ReferenceNote[] {
  const rows = getDb().exec(
    `SELECT uid, author, author_type, body, created_at FROM comments
      WHERE ${by} = ? ORDER BY created_at DESC LIMIT ${NOTE_LIMIT}`,
    [uid],
  )[0]?.values ?? [];
  return rows.map((r) => ({
    reference: formatReference('comment', String(r[0])),
    author: String(r[1]),
    authorType: String(r[2]),
    body: String(r[3]),
    createdAt: Number(r[4]),
  }));
}

function planSummary(planUid: string): ReferenceDescription['plan'] {
  const row = getDb().exec(`SELECT uid, title FROM plans WHERE uid = ?`, [planUid])[0]?.values?.[0];
  if (!row) return undefined;
  return { reference: formatReference('plan', String(row[0])), uid: String(row[0]), title: String(row[1] ?? '') };
}

/** Whatever a target uid is, as a short summary — for "a comment on …". */
function targetSummary(uid: string): ReferenceDescription['on'] {
  const matches = findReferenceMatches({ kind: null, prefix: uid.replace(/-/g, '').toLowerCase() })
    .filter((m) => m.uid === uid);
  const m = matches[0];
  return m ? { reference: formatReference(m.kind, m.uid), uid: m.uid, title: m.title } : null;
}

/** Everything an agent needs to act on "task 9f2c41ab isn't right". */
export function describeReference(m: ReferenceMatch): ReferenceDescription {
  const db = getDb();
  const base: ReferenceDescription = {
    reference: formatReference(m.kind, m.uid),
    kind: m.kind,
    uid: m.uid,
    title: m.title,
    notes: [],
  };

  if (m.kind === 'plan') {
    const row = db.exec(`SELECT status FROM plans WHERE uid = ?`, [m.uid])[0]?.values?.[0];
    return { ...base, status: row ? String(row[0]) : undefined, notes: notesOn(m.uid) };
  }
  if (m.kind === 'task' || m.kind === 'page') {
    const row = db.exec(`SELECT plan_uid, status FROM plan_items WHERE uid = ?`, [m.uid])[0]?.values?.[0];
    return {
      ...base,
      status: row ? String(row[1]) : undefined,
      plan: row ? planSummary(String(row[0])) : undefined,
      notes: notesOn(m.uid),
    };
  }
  if (m.kind === 'comment') {
    const row = db.exec(`SELECT target_uid, body FROM comments WHERE uid = ?`, [m.uid])[0]?.values?.[0];
    return {
      ...base,
      body: row ? String(row[1]) : undefined,
      on: row ? targetSummary(String(row[0])) : null,
      notes: notesOn(m.uid, 'parent_uid'), // replies
    };
  }
  const row = db.exec(`SELECT target_uid FROM attachments WHERE uid = ?`, [m.uid])[0]?.values?.[0];
  return { ...base, on: row ? targetSummary(String(row[0])) : null };
}

/** What an argument's name says it holds — narrows a bare prefix. */
function kindsForArg(key: string): ReferenceKind[] | null {
  if (/(^|_)plan_uids?$/.test(key)) return ['plan'];
  if (/comment_uid$/.test(key)) return ['comment'];
  if (/attachment_uid$/.test(key)) return ['attachment'];
  if (/(^|_)(item|parent|new_parent)_uid$/.test(key)) return ['task', 'page'];
  return null;
}

/** Arguments that carry uids: `uid`, `plan_uid`, `allowed_plan_uids`, … */
const UID_ARG = /^(?!_)(?:[a-z_]*_)?uids?$/;

/**
 * Replace every reference in a tool's top-level uid arguments with the full
 * uid it names. Called once per tool call, at the single interception in
 * `mcp/server.ts`, so every tool accepts references without knowing they
 * exist — including tools added later.
 *
 * The argument's name narrows a bare prefix (`plan_uid` only looks at
 * plans); a kind the caller wrote (`task 9f2c41ab`) always wins.
 */
export function resolveReferenceArgs<T>(args: T): T {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  let changed = false;
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };

  const one = (key: string, value: unknown): unknown => {
    const ref = parseReference(value);
    if (!ref) return value;
    const kinds = ref.kind ? [ref.kind] : kindsForArg(key);
    const matches = findReferenceMatches({ ...ref, kind: null })
      .filter((m) => !kinds || kinds.includes(m.kind));
    if (matches.length > 1) throw new AmbiguousReferenceError(String(value), matches);
    if (matches.length === 0) return value;
    changed = true;
    return matches[0].uid;
  };

  for (const [key, value] of Object.entries(out)) {
    if (!UID_ARG.test(key)) continue;
    out[key] = Array.isArray(value) ? value.map((v) => one(key, v)) : one(key, value);
  }
  return changed ? (out as T) : args;
}
