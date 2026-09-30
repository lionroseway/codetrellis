/**
 * Tracks filesystem paths we just wrote ourselves, so the file watcher
 * can skip re-importing them as if they were external edits.
 *
 * Shared between plan-file-service and channel-event-file-service —
 * both write into `<projectRoot>/.codetrellis/plans/<slug>/`, and both
 * need their own writes ignored by the same chokidar watcher.
 *
 * A write is recognised by its content, not only by how recently it
 * happened (Phase 32, found in B7.4). The stamp keeps a hash of the file
 * as we left it, and for as long as the file still reads that way an event
 * on it is ours, however late it arrives. A time window alone (1 second)
 * lost on a busy machine: chokidar's write-finish polling reported our own
 * export after the window had closed, the plan was re-imported from that
 * export, and whatever had changed in the database since — an agent's
 * claim — was overwritten with the older state on disk. An edit by anyone
 * else changes the content, so it is still imported.
 *
 * A path with no content to compare (a deletion, a move's old path) falls
 * back to the time window.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

interface Stamp { at: number; hash: string | null }

const recentSelfWrites = new Map<string, Stamp>();
const SELF_WRITE_TTL_MS = 1000;
/** Stamps kept by content; the oldest go first past this many. */
const MAX_STAMPS = 5000;

function hashOf(filePath: string): string | null {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null; // gone, or never written: only the time window applies
  }
}

export function stampSelfWrite(filePath: string): void {
  recentSelfWrites.delete(filePath); // re-inserted last, so eviction takes the oldest
  recentSelfWrites.set(filePath, { at: Date.now(), hash: hashOf(filePath) });
  if (recentSelfWrites.size > MAX_STAMPS) {
    const oldest = recentSelfWrites.keys().next().value;
    if (oldest !== undefined) recentSelfWrites.delete(oldest);
  }
}

export function wasJustWrittenByUs(filePath: string): boolean {
  const t = recentSelfWrites.get(filePath);
  if (!t) return false;
  if (t.hash) {
    const now = hashOf(filePath);
    if (now === t.hash) return true; // still exactly what we wrote
    if (now !== null) {
      recentSelfWrites.delete(filePath); // someone else has changed it since
      return false;
    }
    // Gone since: a deletion, which the time window covers.
  }
  if (Date.now() - t.at > SELF_WRITE_TTL_MS) {
    recentSelfWrites.delete(filePath);
    return false;
  }
  return true;
}
