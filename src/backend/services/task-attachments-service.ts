/**
 * Task / plan-doc attachments service — Phase 14 §A.
 *
 * URLs, image refs, file refs, code blocks, and transcripts pinned to
 * a task or to a plan-doc. Backed by the `attachments` table (single
 * table for both target_types so the UI can render both rails
 * uniformly).
 *
 * Image attachments support a separate disk path: when the caller
 * passes raw image bytes via `dataBase64` + `contentType`, we write
 * them to `<projectRoot>/.codetrellis/attachments/<task-uid>/<uid>.<ext>`
 * and store the project-relative path as `value`. URLs and other kinds
 * are stored inline.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from './database';
import { markDirty } from './persistence';
import { getSettings } from './settings-service';
import type { TaskAttachment, AttachmentKind, PlanDocAttachment } from '../../shared/types';

/**
 * Phase 15 §15.D — resolve where image/video bytes land based on the
 * `plans.attachmentLocation` setting. The DB column `value` stores
 * the path WHERE the attachment can be read from on the user's
 * machine — for `'project'` it's project-relative; for `'user'`
 * it's an absolute `userdata://` URI we resolve back at read time.
 *
 * The REST endpoint `/api/attachments/file/:itemUid/:filename`
 * resolves either form back to a real path so the frontend can
 * `<img src>` it.
 */
function resolveAttachmentDir(targetUid: string, projectRoot: string | undefined): {
  absDir: string;
  storedValuePrefix: string;
} {
  const location = getSettings().plans.attachmentLocation ?? 'project';
  if (location === 'user' || !projectRoot) {
    // User-data: lives under <userDataDir>/codetrellis/attachments/<item-uid>/
    // Stored as `userdata://attachments/<item-uid>/<file>` so the REST
    // resolver can route it back. Independent of any project.
    const userDataDir = process.env.CODETRELLIS_DATA_DIR ?? path.join(os.homedir(), '.codetrellis');
    const absDir = path.join(userDataDir, 'attachments', targetUid);
    return {
      absDir,
      storedValuePrefix: `userdata://attachments/${targetUid}/`,
    };
  }
  // Project-tracked: lives under <projectRoot>/.codetrellis/attachments/<item-uid>/
  const absDir = path.join(projectRoot, '.codetrellis', 'attachments', targetUid);
  return {
    absDir,
    storedValuePrefix: path.join('.codetrellis', 'attachments', targetUid) + path.sep,
  };
}

/**
 * Resolve a stored attachment `value` back to an absolute path on
 * disk. Used by the file-serving REST endpoint. Returns null for
 * non-file kinds (URLs, file_ref pointing at project files, etc).
 */
export function resolveAttachmentAbsPath(value: string, projectRoot?: string): string | null {
  if (value.startsWith('userdata://')) {
    const userDataDir = process.env.CODETRELLIS_DATA_DIR ?? path.join(os.homedir(), '.codetrellis');
    const rel = value.replace(/^userdata:\/\//, '');
    const abs = path.resolve(userDataDir, rel);
    // Sanity — abs must still live under userDataDir (no `..` escape).
    if (!abs.startsWith(path.resolve(userDataDir) + path.sep)) return null;
    return abs;
  }
  // Project-relative paths — `.codetrellis/...` (the bytes-uploaded
  // attachment dir) AND any other path inside the project (file_ref
  // attachments that just reference an existing project file).
  if (projectRoot && !path.isAbsolute(value)) {
    const abs = path.resolve(projectRoot, value);
    // Boundary check: prevent `..` traversal escaping the project.
    const normRoot = path.resolve(projectRoot);
    if (!abs.startsWith(normRoot + path.sep) && abs !== normRoot) return null;
    return abs;
  }
  // Absolute paths: only serve if under the user's home dir (loose
  // boundary so external-but-user-owned files like ~/Desktop work).
  // No project-root override — outside-project absolute references
  // are user-explicit.
  if (path.isAbsolute(value)) {
    const home = os.homedir();
    if (value.startsWith(home + path.sep)) return value;
    return null;
  }
  return null;
}

/**
 * Phase 15 §C — `'item'` joins the targetType union as the unified
 * attachment target for `plan_items`. Old paths (`'task'` and
 * `'plan_doc'`, retargeted by the 15.B migrator) keep working
 * unchanged.
 */
export type AttachmentTargetType = 'task' | 'plan_doc' | 'item';

export interface AddAttachmentInput {
  targetType: AttachmentTargetType;
  targetUid: string;
  kind: AttachmentKind;
  /**
   * Inline payload depending on kind:
   *   - url        → URL string
   *   - file_ref   → path relative to project root
   *   - code_block → raw snippet
   *   - transcript → markdown body
   *   - image      → if `dataBase64` is also supplied, this can be a
   *                  display label / filename hint; otherwise the
   *                  stored value is whatever path was passed in.
   */
  value: string;
  /**
   * Optional base64-encoded image payload. When set, we decode and
   * persist it to disk; `value` is rewritten to the project-relative
   * path. Requires `projectRoot`.
   */
  dataBase64?: string;
  contentType?: string;
  label?: string;
  author: string;
  authorType: string;
  /** Required when `dataBase64` is set so we can build the on-disk path. */
  projectRoot?: string;
}

export function addAttachment(input: AddAttachmentInput): TaskAttachment | PlanDocAttachment {
  const uid = randomUUID();
  const now = Date.now();

  let value = input.value;

  // Image / video with bytes — write to disk in the location the user
  // configured (`plans.attachmentLocation`), rewrite `value` to either
  // a project-relative path (`.codetrellis/attachments/...`) or a
  // `userdata://...` URI the file-serving REST endpoint resolves back.
  const isInlineByteUpload = (input.kind === 'image' || input.kind === 'video') && input.dataBase64;
  if (isInlineByteUpload) {
    const ext = guessExtensionFromContentType(input.contentType) || guessExtensionFromValue(input.value) || (input.kind === 'video' ? 'mp4' : 'png');
    const { absDir, storedValuePrefix } = resolveAttachmentDir(input.targetUid, input.projectRoot);
    fs.mkdirSync(absDir, { recursive: true });
    const filename = `${uid}.${ext}`;
    const absPath = path.join(absDir, filename);
    const buf = Buffer.from(input.dataBase64!, 'base64');
    fs.writeFileSync(absPath, buf);
    value = storedValuePrefix + filename;
  }

  getDb().run(
    `INSERT INTO attachments (uid, target_type, target_uid, kind, value, label, content_type, author, author_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, input.targetType, input.targetUid, input.kind, value,
     input.label ?? null, input.contentType ?? null,
     input.author, input.authorType, now],
  );
  markDirty();

  if (input.targetType === 'task' || input.targetType === 'item') {
    // Phase 15 §C — items use the same TaskAttachment shape; the
    // `taskUid` field name is a back-compat hangover that the new
    // unified surface aliases to "itemUid" at the MCP / REST layer.
    return {
      uid, taskUid: input.targetUid, kind: input.kind, value,
      label: input.label, contentType: input.contentType,
      author: input.author, authorType: input.authorType, createdAt: now,
    };
  }
  return {
    uid, docUid: input.targetUid, kind: input.kind, value,
    label: input.label, contentType: input.contentType,
    author: input.author, authorType: input.authorType, createdAt: now,
  };
}

export function listTaskAttachments(taskUid: string): TaskAttachment[] {
  const result = getDb().exec(
    `SELECT uid, target_uid, kind, value, label, content_type, author, author_type, created_at
     FROM attachments WHERE target_type = 'task' AND target_uid = ? ORDER BY created_at ASC`,
    [taskUid],
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]): TaskAttachment => ({
    uid: r[0] as string,
    taskUid: r[1] as string,
    kind: r[2] as AttachmentKind,
    value: r[3] as string,
    label: (r[4] as string | null) ?? undefined,
    contentType: (r[5] as string | null) ?? undefined,
    author: r[6] as string,
    authorType: r[7] as string,
    createdAt: r[8] as number,
  }));
}

/**
 * Phase 15 §C — list attachments belonging to a `plan_items` row.
 * Reads any of `'item'` (native) / `'task'` / `'plan_doc'` (legacy
 * — pre-migration rows whose target_type still names the old table)
 * so the unified surface keeps showing attachments throughout the
 * cutover. Once the migrator runs, only `'item'` is in use.
 */
export function listItemAttachments(itemUid: string): TaskAttachment[] {
  const result = getDb().exec(
    `SELECT uid, target_uid, kind, value, label, content_type, author, author_type, created_at
     FROM attachments
     WHERE target_uid = ? AND target_type IN ('item', 'task', 'plan_doc')
     ORDER BY created_at ASC`,
    [itemUid],
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]): TaskAttachment => ({
    uid: r[0] as string,
    taskUid: r[1] as string,
    kind: r[2] as AttachmentKind,
    value: r[3] as string,
    label: (r[4] as string | null) ?? undefined,
    contentType: (r[5] as string | null) ?? undefined,
    author: r[6] as string,
    authorType: r[7] as string,
    createdAt: r[8] as number,
  }));
}

export function listPlanDocAttachments(docUid: string): PlanDocAttachment[] {
  const result = getDb().exec(
    `SELECT uid, target_uid, kind, value, label, content_type, author, author_type, created_at
     FROM attachments WHERE target_type = 'plan_doc' AND target_uid = ? ORDER BY created_at ASC`,
    [docUid],
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]): PlanDocAttachment => ({
    uid: r[0] as string,
    docUid: r[1] as string,
    kind: r[2] as AttachmentKind,
    value: r[3] as string,
    label: (r[4] as string | null) ?? undefined,
    contentType: (r[5] as string | null) ?? undefined,
    author: r[6] as string,
    authorType: r[7] as string,
    createdAt: r[8] as number,
  }));
}

export function deleteAttachment(uid: string): boolean {
  const db = getDb();
  const before = db.exec(`SELECT uid FROM attachments WHERE uid = ?`, [uid]);
  if (!before[0]?.values[0]) return false;
  db.run(`DELETE FROM attachments WHERE uid = ?`, [uid]);
  markDirty();
  return true;
}

/**
 * Bulk import — used by plan-file-service when restoring a plan from
 * disk. Preserves the original uid + createdAt.
 */
export function upsertAttachment(input: {
  uid: string;
  targetType: AttachmentTargetType;
  targetUid: string;
  kind: AttachmentKind;
  value: string;
  label?: string | null;
  contentType?: string | null;
  author: string;
  authorType: string;
  createdAt: number;
}): void {
  const db = getDb();
  const exists = db.exec(`SELECT uid FROM attachments WHERE uid = ?`, [input.uid]);
  if (exists[0]?.values[0]) {
    db.run(
      `UPDATE attachments SET target_type = ?, target_uid = ?, kind = ?, value = ?, label = ?, content_type = ?, author = ?, author_type = ?, created_at = ? WHERE uid = ?`,
      [input.targetType, input.targetUid, input.kind, input.value,
       input.label ?? null, input.contentType ?? null,
       input.author, input.authorType, input.createdAt, input.uid],
    );
  } else {
    db.run(
      `INSERT INTO attachments (uid, target_type, target_uid, kind, value, label, content_type, author, author_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.uid, input.targetType, input.targetUid, input.kind, input.value,
       input.label ?? null, input.contentType ?? null,
       input.author, input.authorType, input.createdAt],
    );
  }
  markDirty();
}

function guessExtensionFromContentType(contentType?: string): string | null {
  if (!contentType) return null;
  // image/* and video/* both follow the same MIME-subtype shape.
  const m = contentType.match(/^(?:image|video)\/([a-z0-9+.-]+)/i);
  if (!m) return null;
  const sub = m[1].toLowerCase();
  if (sub === 'jpeg') return 'jpg';
  if (sub === 'svg+xml') return 'svg';
  if (sub === 'quicktime') return 'mov';
  if (sub === 'x-matroska') return 'mkv';
  return sub;
}

function guessExtensionFromValue(value: string): string | null {
  const m = value.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : null;
}
