/**
 * Phase 33 C1 — check part of the rulebook: one suite, one rule, or the
 * rules about a path (design §5.1). Pure.
 *
 *     codetrellis check --suite payments
 *     codetrellis check --rule stripe-via-wrapper
 *     codetrellis check --path src/payments/
 *
 * Each takes a comma-separated list; scopes given together all apply (a rule
 * in the payments suite AND about src/payments/). A rule still in
 * `.codetrellis/config.json` belongs to no suite, so `--suite` never selects
 * it.
 */

import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { inPattern } from './architecture-rule';

export interface RuleScope {
  suites?: string[];
  rules?: string[];
  paths?: string[];
}

/** A scope from comma-separated text, as flags and query strings carry it; null when nothing is given. */
export function parseScope(raw: { suite?: unknown; rule?: unknown; path?: unknown }): RuleScope | null {
  const list = (v: unknown): string[] | undefined => {
    const items = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
      .filter((x): x is string => typeof x === 'string').map((x) => x.trim().replace(/^\.\/+/, '')).filter(Boolean);
    return items.length ? [...new Set(items)].slice(0, 50) : undefined;
  };
  const scope: RuleScope = { suites: list(raw.suite), rules: list(raw.rule), paths: list(raw.path) };
  return scope.suites || scope.rules || scope.paths ? scope : null;
}

/**
 * Whether a rule is about a path: the path is in the rule's `from`, or the
 * path is a folder holding some of it (`src/` holds `src/payments/`).
 */
export function ruleTouches(rule: ArchitectureRule, p: string): boolean {
  if (inPattern(rule.from, p)) return true;
  const folder = p.endsWith('/') ? p : `${p}/`;
  return rule.from.startsWith(folder) || rule.from === p;
}

export function inScope(rule: ArchitectureRule, scope: RuleScope | null): boolean {
  if (!scope) return true;
  if (scope.suites && !(rule.suite && scope.suites.includes(rule.suite))) return false;
  if (scope.rules && !scope.rules.includes(rule.id)) return false;
  if (scope.paths && !scope.paths.some((p) => ruleTouches(rule, p))) return false;
  return true;
}

export function scopeRules(rules: readonly ArchitectureRule[], scope: RuleScope | null): ArchitectureRule[] {
  return rules.filter((r) => inScope(r, scope));
}

/** "suite payments, rule web-not-db", as the check says what it was asked. */
export function scopeWords(scope: RuleScope | null): string {
  if (!scope) return 'every rule';
  const part = (one: string, many: string, xs?: string[]) => (xs ? `${xs.length === 1 ? one : many} ${xs.join(', ')}` : null);
  return [part('suite', 'suites', scope.suites), part('rule', 'rules', scope.rules), part('rules about', 'rules about', scope.paths)].filter(Boolean).join('; ');
}
