/**
 * Folders an agent reported that CodeTrellis has not opened (Phase 32 A1.7c).
 *
 * An agent connected through the stdio connector says which folder it works
 * in (A1.1). When that folder is none of the roots the person trusts, it may
 * be a clone of the opened repository — or anything else on the machine.
 * Deciding which means running git in it, and a repository's own config can
 * make git run commands, so nothing is read from it until the person says to
 * (log, Decisions, 2026-09-28). It becomes a pending request the app shows;
 * including it is a grant, and only the app window grants.
 *
 * Asked once per folder: "not now" is remembered, and several agents in one
 * folder make one request.
 */

import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';

export interface FolderRequest {
  /** Server-held: the include/dismiss routes take this, never a path. */
  id: string;
  folder: string;
  agentType: string;
  /** Sessions that reported it, to bind once it is included. */
  sessionIds: string[];
  reportedAt: number;
}

const pending = new Map<string, FolderRequest>();

let onChanged: () => void = () => {};

/** Told when the pending list changes. The server broadcasts `folder-requests-changed`. */
export function setFolderRequestsListener(listener: () => void): void {
  onChanged = listener;
}

/**
 * The folder as a person would read it, or null when it cannot be one: not
 * absolute, a NUL, or absurdly long. Lexical only — nothing is read.
 */
export function normaliseReportedFolder(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096 || raw.includes('\0') || !path.isAbsolute(raw)) return null;
  return path.resolve(raw);
}

function isDismissed(folder: string): boolean {
  try {
    return !!getDb().exec(`SELECT 1 FROM folder_request_dismissals WHERE folder = ?`, [folder])[0]?.values[0];
  } catch {
    return false;
  }
}

/**
 * An agent reported a folder no trusted root covers. Returns the request it
 * joined or opened, or null when there is nothing to ask (not a folder, or
 * already declined).
 */
export function recordFolderRequest(input: { folder: unknown; sessionId: string; agentType: string }, now = Date.now()): FolderRequest | null {
  const folder = normaliseReportedFolder(input.folder);
  if (!folder || isDismissed(folder)) return null;
  const existing = [...pending.values()].find((r) => r.folder === folder);
  if (existing) {
    if (!existing.sessionIds.includes(input.sessionId)) existing.sessionIds.push(input.sessionId);
    return existing;
  }
  const req: FolderRequest = {
    id: randomBytes(8).toString('hex'),
    folder,
    agentType: input.agentType,
    sessionIds: [input.sessionId],
    reportedAt: now,
  };
  pending.set(req.id, req);
  onChanged();
  return req;
}

/** Pending requests, oldest first. */
export function listFolderRequests(): FolderRequest[] {
  return [...pending.values()].sort((a, b) => a.reportedAt - b.reportedAt);
}

/** Remove a request to act on it. Null when there is no such request. */
export function takeFolderRequest(id: string): FolderRequest | null {
  const req = pending.get(id) ?? null;
  if (req) {
    pending.delete(id);
    onChanged();
  }
  return req;
}

/** "Not now": forget the request and do not ask about this folder again. */
export function dismissFolderRequest(id: string, now = Date.now()): boolean {
  const req = takeFolderRequest(id);
  if (!req) return false;
  rememberDismissal(req.folder, now);
  return true;
}

export function rememberDismissal(folder: string, now = Date.now()): void {
  getDb().run(
    `INSERT INTO folder_request_dismissals (folder, dismissed_at) VALUES (?, ?)
     ON CONFLICT(folder) DO UPDATE SET dismissed_at = excluded.dismissed_at`,
    [folder, now],
  );
  markDirty();
}

/** For tests. */
export function clearFolderRequests(): void {
  pending.clear();
}
