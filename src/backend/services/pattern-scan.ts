/**
 * Phase 33 B4 — a scan sees a change to the project's patterns.
 *
 * An incremental scan parses only the files whose content changed, and a
 * pattern is not content. When the patterns differ from the ones the last
 * scan read (or this is the first scan since the app started, and something
 * says patterns are in use), every other file's pattern finds are redone:
 * each file is read and matched again, with no parse, and only what patterns
 * found is replaced.
 */
import fs from 'node:fs';
import { hasPatternCallsites, replacePatternCallsites } from './database';
import { patternCallsitesFor, patternStamp } from './patterns';

const MAX_BYTES = 2 * 1024 * 1024;
const lastStamp = new Map<string, string>();

/** Redo what the patterns find in `files` (absolute) when they changed since the last scan of this project. Returns how many callsites were written, or null when nothing needed redoing. */
export function refreshPatternFinds(projectRoot: string, files: readonly string[]): number | null {
  const stamp = patternStamp(projectRoot);
  const was = lastStamp.get(projectRoot);
  lastStamp.set(projectRoot, stamp);
  if (was === stamp) return null;
  // First scan since the app started: redo only if patterns are, or were, in use.
  if (was === undefined && stamp === '' && !hasPatternCallsites()) return null;
  const found: Array<{ path: string; callsites: ReturnType<typeof patternCallsitesFor> }> = [];
  for (const file of files) {
    let content: string;
    try {
      if (fs.statSync(file).size > MAX_BYTES || file.toLowerCase().endsWith('.sql')) continue;
      content = fs.readFileSync(file, 'utf-8');
    } catch { continue; }
    found.push({ path: file, callsites: patternCallsitesFor(file, content) });
  }
  return replacePatternCallsites(found);
}

/** A scan that parsed every file read the patterns as they are now. */
export function notePatternsRead(projectRoot: string): void {
  lastStamp.set(projectRoot, patternStamp(projectRoot));
}
