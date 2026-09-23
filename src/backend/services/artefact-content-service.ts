/**
 * Phase 31 §7.1 — one resolver for an attachment's bytes, two transports.
 *
 *  - dev / web: `GET /api/artefacts/:uid/content` (and the older
 *    `/api/attachments/:uid/file`), behind the capability-token middleware;
 *  - packaged: the `ct-artefact://<uid>` scheme, handled in Electron main.
 *
 * The packaged renderer is a `file://` document whose `fetch` is shimmed
 * over IPC as UTF-8, and whose `<img>` / `<video>` never reach the shim at
 * all — so until this existed, images and video could not load there.
 *
 * Everything that makes a served file safe is decided here, from the
 * attachment uid alone:
 *  - the project root comes from the item's plan and is re-checked against
 *    the projects this app has opened, never from the request;
 *  - the path is confined to that root (or the item's own upload folder)
 *    and opened ONCE with O_NOFOLLOW — the stream reads the descriptor that
 *    was checked, so a link cannot be swapped in between;
 *  - the type comes from the extension allowlist, never the stored
 *    content type; anything that could run in this origin (HTML, SVG as a
 *    document) is sent so it cannot — HTML as plain text, SVG only ever
 *    shown through `<img>`, and a sandbox CSP on every response;
 *  - no error carries a path.
 */

import path from 'node:path';
import type { ReadStream } from 'node:fs';
import { getDb } from './database';
import { openReadStreamWithin, resolveWithin } from './confined-fs';
import { resolveTrustedProjectRoot } from './trusted-roots';
import { resolveAttachmentLocation } from './task-attachments-service';
import { refreshArtefactHashes } from './artefact-service';

/**
 * What the viewer can be sent (§7.2), by extension. Formats parsed in the
 * renderer go as bytes; text goes as text; HTML goes as TEXT — it is a
 * program, and gets its own sandboxed view, never this origin.
 */
const VIEW_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  md: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  json: 'text/plain; charset=utf-8', xml: 'text/plain; charset=utf-8',
  html: 'text/plain; charset=utf-8', htm: 'text/plain; charset=utf-8',
  xlsx: 'application/octet-stream', xls: 'application/octet-stream', xlsm: 'application/octet-stream',
  docx: 'application/octet-stream', pptx: 'application/octet-stream',
};

export function viewContentType(rel: string): string | null {
  return VIEW_TYPES[path.extname(rel).slice(1).toLowerCase()] ?? null;
}

export interface ServableFile {
  root: string;
  rel: string;
  contentType: string;
  /** The item the attachment belongs to. */
  itemUid: string;
}

/** Attachment uids are ours (randomUUID); anything else is not looked up. */
export function isAttachmentUid(uid: unknown): uid is string {
  return typeof uid === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(uid);
}

/**
 * The file behind an attachment, or null when it is not a file this app
 * will show. Re-takes a recorded artefact's hash first when its size or
 * mtime moved, so a read is also the authoritative change check (§4.4).
 */
export async function resolveServable(uid: unknown): Promise<ServableFile | null> {
  if (!isAttachmentUid(uid)) return null;
  const db = getDb();
  const row = db.exec(`SELECT value, target_uid, role FROM attachments WHERE uid = ?`, [uid])[0]?.values[0];
  if (!row) return null;
  const value = row[0] as string;
  const itemUid = row[1] as string;

  let trustedRoot: string | null = null;
  const projectPath = db.exec(
    `SELECT p.project_path FROM plan_items i JOIN plans p ON p.uid = i.plan_uid WHERE i.uid = ?`,
    [itemUid],
  )[0]?.values[0]?.[0] as string | undefined;
  if (projectPath) {
    try { trustedRoot = resolveTrustedProjectRoot(projectPath, 'attachment project'); } catch { trustedRoot = null; }
  }

  const location = resolveAttachmentLocation(value, itemUid, trustedRoot);
  const contentType = location ? viewContentType(location.rel) : null;
  if (!location || !contentType) return null;
  if (row[2]) await refreshArtefactHashes(itemUid).catch(() => []);
  return { root: location.root, rel: location.rel, contentType, itemUid };
}

/** The absolute path, confined — for "Show in Finder", never for opening. */
export function absolutePathOf(file: ServableFile): string {
  return resolveWithin(file.root, file.rel, 'attachment');
}

export interface ServedResponse {
  status: number;
  headers: Record<string, string>;
  stream: ReadStream | null;
  /** For a non-2xx, a sentence without a path. */
  error?: string;
}

/**
 * Open the file for a response: a single inclusive byte range when asked
 * (so video can seek), and the headers every transport must send.
 */
export function serveFile(file: ServableFile, rangeHeader?: string | null): ServedResponse {
  let range: { start: number; end?: number } | undefined;
  const m = (rangeHeader ?? '').match(/^bytes=(\d+)-(\d*)$/);
  if (m) range = { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined };

  let opened: ReturnType<typeof openReadStreamWithin>;
  try {
    opened = openReadStreamWithin(file.root, file.rel, range ?? {}, 'attachment');
  } catch {
    return { status: 404, headers: {}, stream: null, error: 'The file is not there, or is not a regular file in the project' };
  }
  const { stream, size } = opened;
  const headers: Record<string, string> = {
    'Content-Type': file.contentType,
    'X-Content-Type-Options': 'nosniff',
    // Files change (a recorded output is edited), so nothing is cached.
    'Cache-Control': 'no-store',
    // Harmless for <img>/<video>; stops a file opened directly from running
    // script in this origin.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Accept-Ranges': 'bytes',
  };
  if (!range) {
    headers['Content-Length'] = String(size);
    return { status: 200, headers, stream };
  }
  const end = Math.min(range.end ?? size - 1, size - 1);
  if (range.start > end) {
    stream.destroy();
    return { status: 416, headers: { 'Content-Range': `bytes */${size}` }, stream: null, error: 'Range not satisfiable' };
  }
  headers['Content-Range'] = `bytes ${range.start}-${end}/${size}`;
  headers['Content-Length'] = String(end - range.start + 1);
  return { status: 206, headers, stream };
}
