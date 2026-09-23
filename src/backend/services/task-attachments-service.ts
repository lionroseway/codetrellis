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
import { writeFileWithin } from './confined-fs';
import { resolveTrustedProjectRoot } from './trusted-roots';

/**
 * Largest inline attachment we will decode and store (Phase 19, finding 6).
 *
 * The upload arrives base64 in a JSON body. Without a cap, a caller decides
 * how much of the user's disk to consume and how much memory the decode
 * takes, and both happen before anything else validates the request.
 */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Content types we will persist as bytes. */
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime',
]);
import os from 'node:os';
import path from 'node:path';
import { getDb } from './database';
import { markDirty } from './persistence';
import { getSettings } from './settings-service';
import { getEffectiveAttachmentLocation } from './project-config-service';
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
  // Effective resolution: per-project override > per-user default.
  // When projectRoot is undefined we have no per-project layer to read,
  // so fall straight back to the per-user setting.
  const location = projectRoot
    ? getEffectiveAttachmentLocation(projectRoot)
    : (getSettings().plans.attachmentLocation ?? 'project');
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
 * Where a stored attachment `value` may be read from: a containment root
 * and a path relative to it, for `openReadStreamWithin`. Null when the
 * value is not something this app will read.
 *
 * Phase 31 §4.2 — the rules that make a recorded path safe to show:
 *
 *  - `userdata://attachments/<item-uid>/<file>` — bytes this app wrote for
 *    THIS item. Contained in `<dataDir>/attachments/<item-uid>`, never the
 *    wider data directory (which holds the capability token and database).
 *  - a relative path — inside the project that owns the item, whose root
 *    the caller has derived from the stored plan and checked against the
 *    opened projects. Never taken from a request.
 *  - an absolute path — refused. A reference to a file outside the project
 *    is text to show, not bytes to serve: it is how a shared plan file would
 *    otherwise point a teammate's app at their own home directory.
 */
export function resolveAttachmentLocation(
  value: string,
  targetUid: string,
  trustedProjectRoot: string | null,
): { root: string; rel: string } | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.startsWith('userdata://')) {
    const prefix = `userdata://attachments/${targetUid}/`;
    if (!value.startsWith(prefix)) return null;
    const userDataDir = process.env.CODETRELLIS_DATA_DIR ?? path.join(os.homedir(), '.codetrellis');
    return { root: path.join(userDataDir, 'attachments', targetUid), rel: value.slice(prefix.length) };
  }
  if (path.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (!trustedProjectRoot) return null;
  return { root: trustedProjectRoot, rel: value };
}

/**
 * The type a served attachment is sent as — from its extension, never
 * from the stored `content_type`, which is whatever the caller (or a plan
 * file) said it was.
 */
const SERVED_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};

export function servedContentType(rel: string): string | null {
  return SERVED_TYPES[path.extname(rel).slice(1).toLowerCase()] ?? null;
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
    // EVERYTHING IS VALIDATED BEFORE ANYTHING IS WRITTEN (Phase 19, finding 6).
    //
    // The old order wrote the file first and validated afterwards, so a
    // request that was going to be rejected had already put bytes on disk —
    // at a location derived from a caller-supplied `projectRoot`. The
    // reviewer reproduced exactly that: marker bytes landed under an
    // external root before the database operation failed.

    // 1. Media type. Refusing unknown types stops the store being used as a
    //    general-purpose drop for arbitrary content.
    if (input.contentType && !ALLOWED_ATTACHMENT_TYPES.has(input.contentType.toLowerCase())) {
      throw new Error(`Unsupported attachment content type: ${input.contentType}`);
    }

    // 2. Size, checked on the ENCODED length first so an oversized payload
    //    is refused without allocating the decoded buffer.
    const approxBytes = Math.floor((input.dataBase64!.length * 3) / 4);
    if (approxBytes > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachment exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`,
      );
    }
    const buf = Buffer.from(input.dataBase64!, 'base64');
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachment exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`,
      );
    }

    // 3. The root is NOT taken from the request (Gate 2.2). A caller may
    //    name a project, but only one this app has actually opened.
    const trustedRoot = input.projectRoot
      ? resolveTrustedProjectRoot(input.projectRoot, 'addAttachment(projectRoot)')
      : undefined;

    const ext = guessExtensionFromContentType(input.contentType) || guessExtensionFromValue(input.value) || (input.kind === 'video' ? 'mp4' : 'png');
    const { absDir, storedValuePrefix } = resolveAttachmentDir(input.targetUid, trustedRoot);
    const filename = `${uid}.${ext}`;

    // 4. The write itself goes through the boundary: atomic, O_EXCL, no
    //    following a link at the destination, containment re-checked
    //    immediately before the write rather than trusted from above.
    const containmentRoot = trustedRoot
      ? path.join(trustedRoot, '.codetrellis', 'attachments')
      : path.dirname(absDir);
    writeFileWithin(containmentRoot, path.join(absDir, filename), buf, 'attachment');
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
    `SELECT uid, target_uid, kind, value, label, content_type, author, author_type, created_at, role, sha256
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
    role: (r[9] as TaskAttachment['role']) ?? null,
    sha256: (r[10] as string | null) ?? null,
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
const ATTACHMENT_KINDS: readonly AttachmentKind[] = ['url', 'image', 'video', 'file_ref', 'code_block', 'transcript'];

/**
 * An attachment read from a plan file, validated exactly as if an agent had
 * submitted it (Phase 31 §4.2). A plan file is untrusted input: it arrives
 * through `git pull` from anyone who can push to the repository.
 *
 * Returns the values to store, or the reason it was refused.
 */
export function validateImportedAttachment(
  raw: { kind?: unknown; value?: unknown; contentType?: unknown },
  targetUid: string,
): { kind: AttachmentKind; value: string; contentType: string | null } | { refused: string } {
  const kind = raw.kind as AttachmentKind;
  if (!(ATTACHMENT_KINDS as readonly unknown[]).includes(kind)) return { refused: `unknown kind ${String(raw.kind)}` };
  if (typeof raw.value !== 'string' || raw.value.length === 0) return { refused: 'no value' };
  const value = raw.value;
  if (value.includes('\0')) return { refused: 'value contains a NUL byte' };

  if (kind === 'url') {
    // Rendered as a link; anything but http(s) is a script URL waiting to be clicked.
    if (!/^https?:\/\//i.test(value)) return { refused: 'a url must be http(s)' };
  } else if (kind === 'image' || kind === 'video' || kind === 'file_ref') {
    if (value.startsWith('userdata://')) {
      // Only this item's own upload folder: bytes this app wrote for it.
      if (!value.startsWith(`userdata://attachments/${targetUid}/`) || value.includes('..')) {
        return { refused: 'points into the data directory outside this item\'s uploads' };
      }
    } else if (path.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
      return { refused: 'absolute paths and URLs are not file references; use a path inside the project' };
    } else if (path.normalize(value).split(/[\\/]/).includes('..')) {
      return { refused: 'path leaves the project' };
    }
  }

  const ct = typeof raw.contentType === 'string' ? raw.contentType.toLowerCase() : null;
  return { kind, value, contentType: ct && ALLOWED_ATTACHMENT_TYPES.has(ct) ? ct : null };
}

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
}): boolean {
  const db = getDb();
  const exists = db.exec(`SELECT target_type, target_uid FROM attachments WHERE uid = ?`, [input.uid])[0]?.values[0];
  if (exists) {
    // An upsert never moves an attachment between items: a uid in one
    // plan file must not rewrite an attachment another item owns.
    if (exists[0] !== input.targetType || exists[1] !== input.targetUid) return false;
    db.run(
      `UPDATE attachments SET kind = ?, value = ?, label = ?, content_type = ?, author = ?, author_type = ?, created_at = ? WHERE uid = ?`,
      [input.kind, input.value,
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
  return true;
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
