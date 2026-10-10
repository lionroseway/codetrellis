/**
 * Phase 33 V2 — review in order of risk (AGENT-CHECKS-AND-REVIEW §2.2).
 *
 * The files of a change, ordered by what a mistake there would cost, each
 * with one line saying why it is where it is. "Review these three first" is
 * the most useful thing a large agent-written change can say.
 *
 * What counts, and how much (the order is the sum, then the path):
 *  - its tests fail (40) or are older than the code (15);
 *  - it is in the scope of a rule at block (30), or at warn (10): it is a
 *    file the rule judges, or one the rule protects;
 *  - another line of work changes it too (20 each);
 *  - files depend on it (1 each, up to 50).
 * Nothing counts a file that has none of these; it keeps its place by path.
 */

import path from 'node:path';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { inPattern } from './architecture-rule';

export interface RiskInputs {
  /** Files that import this one. */
  dependents: number;
  tests: 'failing' | 'stale' | 'passing' | 'untested' | null;
  /** Rules whose scope holds the file, with their strength. */
  rules: Array<{ id: string; strength: string }>;
  /** Other lines of work that change it too. */
  otherWork: string[];
}

export interface FileRisk {
  path: string;
  score: number;
  /** "imported by 12 files · its tests fail · in the scope of web-not-db (block) · also changed in billing-v2", or why it is low. */
  why: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One file's place and its reason. Pure. */
export function riskOf(file: string, i: RiskInputs): FileRisk {
  let score = 0;
  const why: string[] = [];
  if (i.tests === 'failing') { score += 40; why.push('its tests fail'); }
  else if (i.tests === 'stale') { score += 15; why.push('its tests are older than the code'); }
  const block = i.rules.filter((r) => r.strength === 'block');
  const warn = i.rules.filter((r) => r.strength === 'warn');
  if (block.length) { score += 30 * block.length; why.push(`in the scope of ${block.map((r) => r.id).join(', ')} (block)`); }
  if (warn.length) { score += 10 * warn.length; why.push(`in the scope of ${warn.map((r) => r.id).join(', ')} (warn)`); }
  if (i.otherWork.length) { score += 20 * i.otherWork.length; why.push(`also changed in ${i.otherWork.join(', ')}`); }
  if (i.dependents > 0) { score += Math.min(i.dependents, 50); why.push(`imported by ${plural(i.dependents, 'file')}`); }
  // The dependents read first when they are the most of it: a reviewer's first question is "who uses this?".
  if (i.dependents >= 10 && why.length > 1) why.unshift(why.pop()!);
  return { path: file, score, why: why.length ? why.join(' · ') : 'nothing depends on it, no rule holds it, and no other work touches it' };
}

/** The files in order of risk: highest first, then by path, so the order is stable. Pure. */
export function riskOrder(files: readonly string[], inputs: (file: string) => RiskInputs): FileRisk[] {
  return [...new Set(files)].map((f) => riskOf(f, inputs(f))).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

/** The rules whose scope holds a file: as one they judge (`from`) or one they protect (`mayNotImport`). Guides judge nothing. */
export function rulesHolding(file: string, rules: readonly ArchitectureRule[]): Array<{ id: string; strength: string }> {
  return rules
    .filter((r) => r.strength !== 'guide' && (inPattern(r.from, file) || inPattern(r.mayNotImport, file)))
    .map((r) => ({ id: r.id, strength: r.strength }));
}

/** A project-relative path, forward slashes. */
export const relPath = (root: string, p: string) => (path.isAbsolute(p) ? path.relative(root, p) : p).split(path.sep).join('/').replace(/^\.\//, '');

/**
 * The inputs for a change's files, from what the app knows now: the graph
 * of the project loaded, the tests reported, the rules, and the other lines
 * of work. `head` is the branch under review, so it is not "other work".
 */
export async function riskInputs(projectRoot: string, files: readonly string[], head: string | null): Promise<(file: string) => RiskInputs> {
  const { getFileDependencies } = await import('./database');
  const { groundingOf } = await import('./tests/grounding');
  const { rulesOf } = await import('./architecture-rules');
  const { listWorkstreams } = await import('./workstream-service');
  const rules = rulesOf(projectRoot);
  const others = new Map<string, string[]>();
  try {
    for (const w of await listWorkstreams(projectRoot)) {
      if (w.main || (head && (w.branch === head || w.root === `branch:${head}` || w.branch?.endsWith(`/${head}`)))) continue;
      const label = w.branch ?? path.basename(w.root);
      for (const f of w.changes.files) {
        if (!files.includes(f.path)) continue;
        others.set(f.path, [...(others.get(f.path) ?? []), label]);
      }
    }
  } catch { /* awareness is optional: no other work is said */ }
  return (file) => {
    let dependents = 0;
    try { dependents = getFileDependencies(file).importedBy.length; } catch { dependents = 0; }
    let tests: RiskInputs['tests'] = null;
    try { tests = groundingOf(projectRoot, file).state as RiskInputs['tests']; } catch { tests = null; }
    return { dependents, tests, rules: rulesHolding(file, rules), otherWork: [...new Set(others.get(file) ?? [])] };
  };
}

/** The order as markdown: the first files to read, each with why. */
export function riskMarkdown(order: readonly FileRisk[], limit = 10): string {
  const lines = ['### Review in this order', ''];
  order.slice(0, limit).forEach((r, n) => lines.push(`${n + 1}. \`${r.path}\` — ${r.why}`));
  if (order.length > limit) lines.push('', `…and ${order.length - limit} more, nothing to single out.`);
  return lines.join('\n');
}
