/**
 * Which projects' last scan failed, and why.
 *
 * "This project's imports are not loaded here" means two different things. Nobody
 * has opened the project: a note is the honest answer, and opening it fixes it.
 * Or a scan was tried and failed: the graph holds nothing to judge by, or holds
 * rows a rescan had already cleared, and a gate that passed would be vouching for
 * code it never read. This is what tells them apart. Its own module because the
 * services that ask cannot import the server that scans.
 *
 * Kept in memory: a new process scans again before it answers.
 */
import fs from 'node:fs';
import path from 'node:path';

const failed = new Map<string, string>();

const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

export function noteScanFailed(projectRoot: string, why: string): void {
  failed.set(real(projectRoot), why.split('\n')[0].slice(0, 200));
}

export function noteScanSucceeded(projectRoot: string): void {
  failed.delete(real(projectRoot));
}

/** Why this project's last scan failed, or null when it did not. */
export function scanFailureOf(projectRoot: string): string | null {
  return failed.get(real(projectRoot)) ?? null;
}
