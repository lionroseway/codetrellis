/**
 * Phase 33 G10 — a task's rules, for its brief (AGENT-CHECKS-AND-REVIEW §3.4).
 *
 * The brief tells the agent doing a task, and the person reading it, which
 * rules judge the files the task changes, and what the latest check run said
 * about those files. An agent that reads its brief first learns that only the
 * wrapper may import Stripe before it writes the import, rather than from the
 * gate afterwards.
 *
 * The task's files are its file specs, as the plan names them. A task that
 * names none has no rules in scope, and says so.
 */

import path from 'node:path';
import type { PlanItem } from '../../shared/types';
import { rulesOf } from './architecture-rules';
import { inPattern, ruleStatement } from './architecture-rule';
import { listCheckRuns } from './check-runs';
import { openFindings } from '../../shared/lib/open-findings';
import { ruleCovers } from '../../shared/lib/rule-pattern';

export interface TaskRules {
  /** The task's files, project-relative. */
  files: string[];
  in_scope: Array<{ rule: string; suite: string; strength: string; words: string; because: string }>;
  /** What the latest check run found in the task's files, or null when no check has run. */
  latest_run: {
    id: string; who: string; ran_in: string; at: string;
    findings: Array<{ rule: string; path: string; imports: string; failing: boolean; words: string; fix: string | null }>;
  } | null;
  says: string;
}

/** A task's files, project-relative, from its file specs. Folders and paths outside the project are left out. */
export function taskFiles(item: Pick<PlanItem, 'fileSpecs' | 'scopePath'>, projectRoot: string | null): string[] {
  const out = new Set<string>();
  for (const spec of item.fileSpecs ?? []) {
    if (!spec?.path || spec.isDir) continue;
    let rel = spec.path.replace(/\\/g, '/');
    if (path.posix.isAbsolute(rel)) {
      if (!projectRoot || !rel.startsWith(`${projectRoot.replace(/\\/g, '/')}/`)) continue;
      rel = rel.slice(projectRoot.length + 1);
    } else if (item.scopePath) {
      rel = path.posix.join(item.scopePath.replace(/\\/g, '/'), rel);
    }
    rel = path.posix.normalize(rel).replace(/^\.\//, '');
    if (rel.startsWith('../') || rel === '..') continue;
    out.add(rel);
    if (spec.action === 'move' && spec.moveTo) out.add(path.posix.normalize(spec.moveTo).replace(/^\.\//, ''));
  }
  return [...out];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The rules that judge a task's files, and the latest run over them. */
export function taskRules(item: Pick<PlanItem, 'fileSpecs' | 'scopePath'>, projectRoot: string | null): TaskRules {
  const files = taskFiles(item, projectRoot);
  if (!projectRoot || files.length === 0) {
    return { files, in_scope: [], latest_run: null, says: 'This task names no files, so no rule is known to judge it.' };
  }
  const in_scope = rulesOf(projectRoot)
    // The rules that judge its files: an imports rule over them; a package or
    // symbol rule over the files of its own language (npm:stripe is not about a .py file).
    .filter((r) => files.some((f) => inPattern(r.from, f) && (r.kind !== 'package' && r.kind !== 'symbol' && r.kind !== 'calls' ? true : ruleCovers(r, f))))
    .map((r) => ({ rule: r.id, suite: r.suite ?? 'architecture', strength: r.strength, words: ruleStatement(r), because: r.because }));
  const open = openFindings(listCheckRuns(projectRoot), files);
  const latest_run = open && {
    id: open.run.id, who: open.run.who, ran_in: open.run.ranIn, at: new Date(open.run.at).toISOString(),
    findings: open.findings.map((f) => ({ rule: f.rule, path: f.path, imports: f.imports, failing: f.failing, words: f.words, fix: f.fix })),
  };
  const rulesWords = in_scope.length === 0
    ? 'No rule is about this task\'s files.'
    : `${plural(in_scope.length, 'rule')} ${in_scope.length === 1 ? 'judges' : 'judge'} this task's files.`;
  const runWords = !open
    ? ' No check has run yet.'
    : open.findings.length === 0
      ? ` The latest check (${open.run.who} in ${open.run.ranIn}) found nothing in them.`
      : ` The latest check (${open.run.who} in ${open.run.ranIn}) found ${plural(open.findings.length, 'import')} in them that ${open.findings.length === 1 ? 'breaks a rule' : 'break rules'}.`;
  return { files, in_scope, latest_run, says: rulesWords + runWords };
}
