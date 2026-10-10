/**
 * Phase 33 G10 — findings where the code is (AGENT-CHECKS-AND-REVIEW §3.4).
 *
 * A finding is kept in a check run (C7). The graph, the code, the inspector,
 * a task's brief and the phone each show the findings that are still open
 * where they are, and each says which run they come from, so the reader can
 * open it. "Open" is what the latest run says: a later run that no longer
 * finds an import has fixed it, whoever ran it, and a finding is never kept
 * alive by an older run.
 *
 * Pure: runs in, findings out.
 */

import { importLine } from './import-line';

export interface RunFinding {
  rule: string;
  suite: string;
  path: string;
  imports: string;
  strength: string;
  failing: boolean;
  words: string;
  fix: string | null;
}

export interface RunLike {
  id: string;
  at: number;
  who: string;
  ranIn: string;
  scope: string | null;
  outcome: { ok: boolean; blocks: number; warns: number };
  findings: RunFinding[];
}

/** The newest run, or null. */
export function latestRun<R extends RunLike>(runs: readonly R[]): R | null {
  let best: R | null = null;
  for (const r of runs) if (!best || r.at > best.at) best = r;
  return best;
}

/** What the latest run found in these files, and which run that is. Null when nothing has run. */
export function openFindings<R extends RunLike>(runs: readonly R[], files: readonly string[]): { run: R; findings: RunFinding[] } | null {
  const run = latestRun(runs);
  if (!run) return null;
  const here = new Set(files);
  return { run, findings: run.findings.filter((f) => here.has(f.path)) };
}

/** A finding placed on a line of the text being shown. */
export interface PlacedFinding extends RunFinding {
  /** 1-based, in the file (the text's first line is `startLine`). */
  line: number;
  runId: string;
}

/**
 * The findings on one file, each on the line that imports it in `text`. A
 * finding whose import is no longer in the text is left off: the gutter marks
 * what is there, and the inspector still lists it.
 */
export function placeFindings(findings: readonly RunFinding[], runId: string, text: string, startLine = 1): PlacedFinding[] {
  const out: PlacedFinding[] = [];
  for (const f of findings) {
    const at = importLine(text, f.imports);
    if (at !== null) out.push({ ...f, line: at + startLine - 1, runId });
  }
  return out;
}

/** "✗ only payments.ts may import npm:stripe → use payments.ts instead" — a finding in a line, for a tooltip. */
export function findingHover(f: Pick<RunFinding, 'failing' | 'words' | 'fix' | 'rule' | 'strength'>): string {
  return `${f.failing ? '✗' : '⚠'} ${f.rule} (${f.strength}): ${f.words}${f.fix ? ` → ${f.fix}` : ''}`;
}

/**
 * The runs that need the person, for the phone's Needs you: the latest run
 * from each place (who, where, and what it checked) when that run blocks.
 * A place whose latest run passes needs nobody, however its earlier runs went.
 */
export function blockingRuns<R extends RunLike>(runs: readonly R[], max = 5): R[] {
  const latest = new Map<string, R>();
  for (const r of runs) {
    const key = `${r.who}\n${r.ranIn}\n${r.scope ?? ''}`;
    const had = latest.get(key);
    if (!had || r.at > had.at) latest.set(key, r);
  }
  return [...latest.values()].filter((r) => !r.outcome.ok).sort((a, b) => b.at - a.at).slice(0, max);
}
