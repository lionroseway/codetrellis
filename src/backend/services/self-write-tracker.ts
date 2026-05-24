/**
 * Tracks filesystem paths we just wrote ourselves, so the file watcher
 * can skip re-importing them as if they were external edits.
 *
 * Shared between plan-file-service and channel-event-file-service —
 * both write into `<projectRoot>/.codetrellis/plans/<slug>/`, and both
 * need their own writes ignored by the same chokidar watcher.
 *
 * Entries TTL out after 1 second to cover any filesystem rename /
 * fsync delay; the watcher fires within tens of milliseconds in
 * practice.
 */

const recentSelfWrites = new Map<string, number>();
const SELF_WRITE_TTL_MS = 1000;

export function stampSelfWrite(filePath: string): void {
  recentSelfWrites.set(filePath, Date.now());
}

export function wasJustWrittenByUs(filePath: string): boolean {
  const t = recentSelfWrites.get(filePath);
  if (!t) return false;
  if (Date.now() - t > SELF_WRITE_TTL_MS) {
    recentSelfWrites.delete(filePath);
    return false;
  }
  return true;
}
