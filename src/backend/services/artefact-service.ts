/**
 * Phase 31 §4.2 / §4.4 — artefacts: attachments with a role and a hash.
 *
 * An artefact is a pointer to a file that already exists in the project —
 * a spreadsheet an analyst was given, the report an agent wrote, a
 * screenshot that proves something. We record, hash and watch it. We do
 * not copy, store or version it ("files stay where they are", §2).
 *
 * Rules that make a recorded path safe to show:
 *  - it resolves only inside the project that owns the item, whose root
 *    comes from the item's plan and is checked against the opened
 *    projects — never from the request;
 *  - links are refused, at recording and at every read (confined-fs);
 *  - the type comes from the extension allowlist (§7.2), never the caller.
 *
 * The hash is what lets a decision notice a change. It is re-taken
 * whenever the file's size or mtime moves: at read time (authoritative —
 * files change while the app is closed) and from the watcher (prompt).
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import { resolveWithin, isInside, canonicalRoot, ConfinementError } from './confined-fs';
import { resolveTrustedProjectRoot } from './trusted-roots';
import { sha256FileWithin } from '../lib/sha256-file';

export type ArtefactRole = 'material' | 'output' | 'evidence';
export const ARTEFACT_ROLES: readonly ArtefactRole[] = ['material', 'output', 'evidence'];

/** §7.2 — what the viewer can show. Anything else is not recorded. */
export const ARTEFACT_EXTS = new Set([
  'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'mp4', 'webm', 'mov',
  'xlsx', 'xls', 'xlsm', 'csv',
  'docx', 'pptx',
  'md', 'txt', 'json', 'log',
  'xml', // JUnit reports — the evidence a `test` criterion reads (§8.1)
  'html', 'htm',
]);

export class ArtefactError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface Artefact {
  uid: string;
  itemUid: string;
  path: string;
  role: ArtefactRole;
  sha256: string | null;
  size: number | null;
  mtime: number | null;
  label: string | null;
  recordedBy: string;
  recordedByType: string;
  createdAt: number;
}

type Row = unknown[];
const rows = (sql: string, params: unknown[] = []): Row[] =>
  (getDb().exec(sql, params)[0]?.values ?? []) as Row[];

const ARTEFACT_COLS =
  'uid, target_uid, value, role, sha256, size, mtime, label, recorded_by, recorded_by_type, created_at';

function toArtefact(r: Row): Artefact {
  return {
    uid: r[0] as string,
    itemUid: r[1] as string,
    path: r[2] as string,
    role: r[3] as ArtefactRole,
    sha256: (r[4] as string | null) ?? null,
    size: (r[5] as number | null) ?? null,
    mtime: (r[6] as number | null) ?? null,
    label: (r[7] as string | null) ?? null,
    recordedBy: (r[8] as string | null) ?? '',
    recordedByType: (r[9] as string | null) ?? '',
    createdAt: r[10] as number,
  };
}

export function listArtefacts(itemUid: string): Artefact[] {
  return rows(
    `SELECT ${ARTEFACT_COLS} FROM attachments
     WHERE target_type = 'item' AND target_uid = ? AND role IS NOT NULL ORDER BY created_at`,
    [itemUid],
  ).map(toArtefact);
}

export function getArtefact(uid: string): Artefact | null {
  const r = rows(`SELECT ${ARTEFACT_COLS} FROM attachments WHERE uid = ? AND role IS NOT NULL`, [uid])[0];
  return r ? toArtefact(r) : null;
}

/** The current stored hash of each attachment named — null when unknown or gone. */
export function currentHashes(attachmentUids: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const uid of attachmentUids) {
    const r = rows(`SELECT sha256 FROM attachments WHERE uid = ?`, [uid])[0];
    out[uid] = (r?.[0] as string | null) ?? null;
  }
  return out;
}

/** The trusted root of the project that owns an item — from its plan, never a request. */
export function projectRootForItem(itemUid: string): string {
  const projectPath = rows(
    `SELECT p.project_path FROM plan_items i JOIN plans p ON p.uid = i.plan_uid WHERE i.uid = ?`,
    [itemUid],
  )[0]?.[0] as string | undefined;
  if (!projectPath) throw new ArtefactError('Item not found, or its plan has no project', 404);
  try {
    return resolveTrustedProjectRoot(projectPath, 'artefact project');
  } catch {
    throw new ArtefactError('This item\'s project is not open in CodeTrellis — open it first', 409);
  }
}

/**
 * A caller's path, as a project-relative one. An absolute path is
 * accepted only when it lies inside the project, and is stored relative:
 * agents often hold absolute paths, and the stored form must not depend
 * on where the project lives on this machine.
 */
function toProjectRelative(root: string, input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new ArtefactError('path is required');
  const canonRoot = canonicalRoot(root);
  let resolved: string;
  try {
    resolved = resolveWithin(canonRoot, input.trim(), 'artefact');
  } catch (err) {
    if (err instanceof ConfinementError) {
      throw new ArtefactError('The path must be a file inside this item\'s project, reached without a symbolic link');
    }
    throw err;
  }
  if (!isInside(canonRoot, resolved) || resolved === canonRoot) {
    throw new ArtefactError('The path must be a file inside this item\'s project');
  }
  return path.relative(canonRoot, resolved).split(path.sep).join('/');
}

/**
 * Record a file that matters to an item: something it read (material),
 * produced (output) or captured to prove a point (evidence).
 *
 * Recording the same path on the same item again updates its role and
 * hash rather than adding a second row.
 */
export async function recordArtefact(input: {
  itemUid: string;
  path: string;
  role: unknown;
  note?: string | null;
  actor: { author: string; authorType: string };
}): Promise<Artefact> {
  if (!(ARTEFACT_ROLES as readonly unknown[]).includes(input.role)) {
    throw new ArtefactError(`role must be one of: ${ARTEFACT_ROLES.join(', ')}`);
  }
  const role = input.role as ArtefactRole;
  const root = projectRootForItem(input.itemUid);
  const rel = toProjectRelative(root, input.path);

  const ext = path.extname(rel).slice(1).toLowerCase();
  if (!ARTEFACT_EXTS.has(ext)) {
    throw new ArtefactError(
      `.${ext || '(none)'} files cannot be recorded as artefacts — the viewer shows ${[...ARTEFACT_EXTS].join(', ')}`,
    );
  }

  let hashed;
  try {
    hashed = await sha256FileWithin(root, rel);
  } catch (err) {
    if (err instanceof ConfinementError) throw new ArtefactError('The path must be a regular file inside this item\'s project, not a link or folder');
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new ArtefactError(`No file at ${rel}`, 404);
    throw err;
  }

  const db = getDb();
  const existing = rows(
    `SELECT uid FROM attachments WHERE target_type = 'item' AND target_uid = ? AND value = ? AND kind = 'file_ref'`,
    [input.itemUid, rel],
  )[0];
  const label = input.note?.trim() || path.basename(rel);
  let uid: string;
  if (existing) {
    uid = existing[0] as string;
    db.run(
      `UPDATE attachments SET role = ?, sha256 = ?, size = ?, mtime = ?, label = ?,
         recorded_by = ?, recorded_by_type = ? WHERE uid = ?`,
      [role, hashed.sha256, hashed.size, Math.round(hashed.mtimeMs), label,
       input.actor.author, input.actor.authorType, uid],
    );
  } else {
    uid = randomUUID();
    db.run(
      `INSERT INTO attachments
         (uid, target_type, target_uid, kind, value, label, content_type, author, author_type, created_at,
          role, sha256, size, mtime, recorded_by, recorded_by_type)
       VALUES (?, 'item', ?, 'file_ref', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid, input.itemUid, rel, label, input.actor.author, input.actor.authorType, Date.now(),
       role, hashed.sha256, hashed.size, Math.round(hashed.mtimeMs), input.actor.author, input.actor.authorType],
    );
  }
  markDirty();
  return getArtefact(uid)!;
}

/**
 * Re-take the hash of every artefact on an item whose size or mtime has
 * moved since it was last taken — the authoritative check (§4.4). A file
 * that has gone, or become a link, has no current hash.
 *
 * Returns the uids whose hash changed.
 */
export async function refreshArtefactHashes(itemUid: string): Promise<string[]> {
  const artefacts = listArtefacts(itemUid);
  if (artefacts.length === 0) return [];
  let root: string;
  try {
    root = projectRootForItem(itemUid);
  } catch {
    return []; // project not open: nothing trustworthy to compare against
  }
  const changed: string[] = [];
  for (const a of artefacts) {
    let next: { sha256: string | null; size: number | null; mtime: number | null };
    try {
      const abs = resolveWithin(root, a.path, 'artefact');
      const st = fs.lstatSync(abs);
      if (!st.isFile()) throw new ConfinementError('not a file');
      if (st.size === a.size && Math.round(st.mtimeMs) === a.mtime && a.sha256) continue;
      const h = await sha256FileWithin(root, a.path);
      next = { sha256: h.sha256, size: h.size, mtime: Math.round(h.mtimeMs) };
    } catch {
      next = { sha256: null, size: null, mtime: null };
    }
    if (next.sha256 !== a.sha256 || next.size !== a.size || next.mtime !== a.mtime) {
      getDb().run(`UPDATE attachments SET sha256 = ?, size = ?, mtime = ? WHERE uid = ?`,
        [next.sha256, next.size, next.mtime, a.uid]);
      if (next.sha256 !== a.sha256) changed.push(a.uid);
    }
  }
  if (changed.length) markDirty();
  return changed;
}

/** Every item with an artefact at `rel` in the project at `root` (for the watcher). */
export function itemsWithArtefactAt(projectPath: string, rel: string): string[] {
  return rows(
    `SELECT DISTINCT a.target_uid FROM attachments a
       JOIN plan_items i ON i.uid = a.target_uid
       JOIN plans p ON p.uid = i.plan_uid
     WHERE a.role IS NOT NULL AND a.value = ? AND p.project_path = ?`,
    [rel, projectPath],
  ).map((r) => r[0] as string);
}

/** Recorded artefact paths for a project, relative to it (for the watcher). */
export function artefactPathsForProject(projectPath: string): string[] {
  return rows(
    `SELECT DISTINCT a.value FROM attachments a
       JOIN plan_items i ON i.uid = a.target_uid
       JOIN plans p ON p.uid = i.plan_uid
     WHERE a.role IS NOT NULL AND p.project_path = ?`,
    [projectPath],
  ).map((r) => r[0] as string);
}
