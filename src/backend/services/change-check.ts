/**
 * The check of a change (Phase 32 A7.3 / D1.4; Phase 33 R2–R4, C1, C3, C7,
 * C8): the one `check_changes` runs for an agent and `codetrellis check` for
 * the pipeline, and since G9 the Checks view for a person. Judged by the
 * base's rules; what the change does to the rulebook is its own finding;
 * every check is kept as a run, with where it ran and by whom.
 */

import { execFileSync } from 'node:child_process';
import { checkChanges } from './conformity-gate';
import { ruleImports } from './workstream-imports';
import { rulesAt } from './rules-at';
import { changeWords, diffRules, type RuleChange } from './rule-changes';
import { approvalFor, approvalsHere, keysAt } from './rule-approvals';
import { inScope, parseScope, scopeRules, scopeWords } from './rule-scope';
import { baselineAt, ratchet, readBaseline, type RatchetFinding } from './rule-baseline';
import { edgesIfLoaded, rulesOf } from './architecture-rules';
import { getDependencyEdges } from './database';
import { isSafeGitRef } from './git-safety';
import { recordCheckRun } from './check-runs';
import { codeAt } from './task-records/test-runs';
import { writerId, writerName } from './task-records/shared-state';
import { findingLine } from '../../shared/lib/check-words';
import type { CriterionChecker } from './conformity-gate';

export interface ChangeCheckInput {
  root: string;
  /** The changed files, relative to the repository root. */
  paths: readonly string[];
  /** The commit the change started from; its rules judge it. */
  base?: string;
  strict?: boolean;
  /** C1: part of the rulebook. */
  scope: { suite?: unknown; rule?: unknown; path?: unknown };
  by: { author: string; authorType: string };
  /** Where it ran, in words, for the run's record. */
  ranIn: string;
  /** The project whose graph is loaded here. */
  activeProject: string | null;
  checkCriterion: CriterionChecker;
}

/** The check's answer, as `check_changes` returns it (with the run's id), or why it could not run. */
export async function checkTheChange(input: ChangeCheckInput): Promise<{ error: string } | { result: { ok: boolean; says: string[]; files: number; run: string } & Record<string, unknown> }> {
  const { root, paths, base, strict, by, ranIn } = input;
  const scope = parseScope(input.scope);
  // The rules (A7.3) compare against a commit, by its id.
  const ref = base ?? 'HEAD';
  let since: string | null = null;
  if (isSafeGitRef(ref)) {
    try { since = execFileSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { since = null; }
  }
  if (base !== undefined && !since) {
    return { error: `${base} is not a commit in this repository (a shallow clone? fetch the base first).` };
  }
  // Phase 33 R2: judged by the base's rules, so a change cannot loosen the
  // rule it breaks; what it does to the rulebook is its own finding.
  let judgeBy: ReturnType<typeof rulesOf> | undefined;
  let rulebook: RuleChange[] = [];
  const notes: string[] = [];
  if (since) {
    const atBase = await rulesAt(root, since);
    if (atBase) {
      judgeBy = scopeRules(atBase.rules, scope);
      // C1: only the scope's rules, on either side: a rule moved out of the scope is still its change.
      rulebook = diffRules(atBase.rules, rulesOf(root), edgesIfLoaded(root, input.activeProject, getDependencyEdges, undefined, atBase.rules) ?? [])
        .filter((c) => !scope || (c.before && inScope(c.before, scope)) || (c.after && inScope(c.after, scope)));
      // R3: a loosening passes only with a person's signed approval, checked against the base's keys.
      if (rulebook.some((c) => c.effect === 'loosens')) {
        const approvals = approvalsHere(root);
        const keys = keysAt(root, since);
        try {
          for (const c of rulebook) if (c.effect === 'loosens') c.approval = approvalFor(root, c, approvals, keys, since);
        } finally { keys.done(); }
      }
    } else {
      notes.push(`⚠ The rules at ${since.slice(0, 7)} could not be read, so this change was judged by its own rules. Fetch the base with its history.`);
    }
  }
  // C3: with a baseline on the base, the whole tree is judged against it, by the base's rules.
  let ratchetFound: Array<RatchetFinding & { strength: string }> = [];
  const baseBaseline = since ? baselineAt(root, since) : null;
  const headBaseline = readBaseline(root);
  if (baseBaseline || headBaseline) {
    const judged = judgeBy ?? scopeRules(rulesOf(root), scope);
    const edges = edgesIfLoaded(root, input.activeProject, getDependencyEdges);
    if (edges) {
      const strengthOf = new Map(judged.map((r) => [r.id, r.strength]));
      const ids = new Set(judged.map((r) => r.id));
      ratchetFound = ratchet(baseBaseline, headBaseline, judged, edges)
        .filter((f) => ids.has(f.rule) || f.kind === 'grew')
        .map((f) => ({ ...f, strength: strengthOf.get(f.rule) ?? 'block' }));
    } else {
      notes.push('⚠ The rules\' baseline was not checked: this project\'s imports are not loaded here.');
    }
  }
  const c = await checkChanges(root, paths, input.checkCriterion, (files) => ruleImports(root, files, since, judgeBy ?? (scope ? scopeRules(rulesOf(root), scope) : undefined)), rulebook, notes, strict === true, scope !== null, ratchetFound);
  // C7: every check is a run, kept with where it ran and by whom; shared where task state is.
  const failing = new Set(c.says);
  const code = codeAt(root);
  const findings = c.rules.map((r) => ({
    rule: r.rule, suite: r.suite ?? 'architecture', path: r.path, imports: r.imports, strength: r.strength,
    failing: failing.has(`✗ ${findingLine(r)}`), words: r.words, fix: r.fix ?? null,
  }));
  const runId = recordCheckRun({
    projectRoot: root, at: Date.now(), by, ranIn,
    commit: code.commit, dirty: code.dirty, base: base ?? null, rulebook: judgeBy ? since : null,
    scope: scope ? scopeWords(scope) : null, strict: strict === true,
    outcome: { ok: c.ok, files: c.files.length, blocks: c.says.length, warns: findings.filter((f) => !f.failing).length },
    says: c.says.slice(0, 200), findings: findings.slice(0, 1000),
  }, { writer: writerId(), name: writerName(root) });
  return { result: {
      ok: c.ok, says: c.says, files: c.files.length, run: runId,
      breakpoints: c.breakpoints, tests: c.tests,
      criteria: c.criteria.map((x) => ({ item_uid: x.itemUid, task: x.task, criterion: x.criterion, findings: x.findings })),
      docs: c.docs.map((d) => ({ uid: d.uid, title: d.title, slug: d.slug, verified_at: d.verifiedAt, files: d.files })),
      rules: c.rules.map((r) => ({ path: r.path, imports: r.imports, rule: r.rule, words: r.words, because: r.because, strength: r.strength, suite: r.suite ?? 'architecture', fix: r.fix ?? null })),
      // C8: the rules judged by, so a suite can say how many hold.
      checked: (judgeBy ?? scopeRules(rulesOf(root), scope)).map((r) => ({ rule: r.id, suite: r.suite ?? 'architecture', strength: r.strength })),
      rulebook: c.rulebook.map((r) => ({ rule: r.rule, change: r.change, effect: r.effect, allowed: r.allowed, forbidden: r.forbidden, words: changeWords(r), ...(r.approval ? { approval: r.approval } : {}) })),
      notes: c.notes,
      ...(c.ratchet.length ? { ratchet: c.ratchet } : {}),
      ...(scope ? { scope: scopeWords(scope) } : {}),
      ...(c.rulesChecked ? {} : { rules_note: 'The architecture rules were not checked: this project\'s imports are not loaded here. Open the project, or run `codetrellis start` in it.' }),
  } };
}
