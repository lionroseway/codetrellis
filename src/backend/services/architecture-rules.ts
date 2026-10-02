/**
 * Phase 32 A7.1 — architecture rules (awareness spec M7).
 *
 * A rule lives in the committed `.codetrellis/config.json` so every laptop,
 * agent and pipeline reads the same one. Setting one is the person's (the
 * route checks); this module validates, keeps and checks them. A breach is an
 * import edge from the resolver's graph, never a text match.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ArchitectureRule, RuleView } from '../../shared/types/architecture-rules';
import { getProjectConfig, updateProjectConfig } from './project-config-service';
import { checkEdges, parseArchitectureRule, ruleWords } from './architecture-rule';

export { breachWords, breaks, checkEdges, inPattern, parseArchitectureRule, ruleWords } from './architecture-rule';

export class RuleError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function rulesOf(projectRoot: string): ArchitectureRule[] {
  return getProjectConfig(projectRoot).rules ?? [];
}

function ruleOf(projectRoot: string, id: string): ArchitectureRule {
  const rule = rulesOf(projectRoot).find((r) => r.id === id);
  if (!rule) throw new RuleError(`No architecture rule "${id}" in this project`, 404);
  return rule;
}

/** Set (or replace) a rule, keeping when it was first set. */
export function setRule(projectRoot: string, raw: Record<string, unknown>, by: string, now = Date.now()): ArchitectureRule {
  const existing = rulesOf(projectRoot).find((r) => r.id === raw.id);
  const { rule, problems } = parseArchitectureRule({ ...raw, since: existing?.since ?? new Date(now).toISOString(), by });
  if (!rule) throw new RuleError(problems.join('; '));
  const rules = rulesOf(projectRoot).filter((r) => r.id !== rule.id).concat(rule);
  updateProjectConfig(projectRoot, { rules });
  return rule;
}

export function removeRule(projectRoot: string, id: string): void {
  ruleOf(projectRoot, id);
  updateProjectConfig(projectRoot, { rules: rulesOf(projectRoot).filter((r) => r.id !== id) });
}

/**
 * The rules, each with the imports that break it now. `edges` is the
 * project's import graph, project-relative, or null when the graph loaded is
 * another project's (it is said, not guessed).
 */
export function rulesView(projectRoot: string, edges: Array<{ from: string; to: string }> | null): RuleView[] {
  return rulesOf(projectRoot).map((rule) => {
    const breaches = edges ? checkEdges([rule], edges) : null;
    return {
      rule,
      words: ruleWords(rule),
      breaches,
      breachWords: breaches === null
        ? 'Open this project to see what breaks it today'
        : breaches.length === 0 ? 'Nothing breaks this today' : `${breaches.length} ${breaches.length === 1 ? 'import breaks' : 'imports break'} this today`,
    };
  });
}

/**
 * The project's import graph, project-relative, when the graph loaded is
 * this project's; null otherwise. The backend holds one project's graph at a
 * time (the last scanned), so another project's rules cannot be checked
 * against it without saying so.
 */
export function edgesIfLoaded(
  projectRoot: string,
  loadedRoot: string | null,
  edges: () => Array<{ sourceRelative: string; targetRelative: string }>,
): Array<{ from: string; to: string }> | null {
  if (!loadedRoot) return null;
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  if (real(loadedRoot) !== real(projectRoot)) return null;
  return edges().map((e) => ({ from: e.sourceRelative, to: e.targetRelative }));
}
