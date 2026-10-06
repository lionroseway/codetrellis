/**
 * Phase 33 R2 — what a change does to the rulebook (design §4.1).
 *
 * A pull request cannot change the rules that judge it: the gate judges with
 * the base branch's rules, and reports the difference between the base's
 * rulebook and the branch's as its own finding. Loosening — a rule removed,
 * or a rule's paths or exceptions changed in a way not proven to only
 * tighten — needs a person (R3 signs it); tightening is reported and never
 * blocks; a reworded reason is listed.
 *
 * Pure: two lists of rules and the project's import edges in, the changes
 * out. The edges give each change its effect in imports, so the words say
 * what it would allow ("3 imports it forbade become allowed").
 */

import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { checkEdges } from './architecture-rule';

export type RuleEffect = 'loosens' | 'tightens' | 'reworded';

export interface Edge { from: string; to: string }

export interface RuleChange {
  rule: string;
  /** What happened to the rule. */
  change: 'added' | 'removed' | 'changed';
  effect: RuleEffect;
  /** Imports in the project now that the base's rule forbade and the branch's allows. */
  allowed: Edge[];
  /** Imports in the project now that the base's rule allowed and the branch's forbids. */
  forbidden: Edge[];
  /** One line, the way the gate says it. */
  words: string;
}

const key = (e: Edge) => `${e.from}>${e.to}`;
const breaches = (rule: ArchitectureRule, edges: readonly Edge[]): Edge[] =>
  checkEdges([rule], edges as Edge[]).map((b) => ({ from: b.from, to: b.to }));
const minus = (a: Edge[], b: Edge[]): Edge[] => { const drop = new Set(b.map(key)); return a.filter((e) => !drop.has(key(e))); };
const imports = (n: number) => `${n} import${n === 1 ? '' : 's'}`;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/**
 * Only a rule whose paths stayed the same and whose exceptions only shrank
 * is proven to tighten from its text alone; any other change to `from`,
 * `mayNotImport` or `except` is treated as loosening, since it may allow
 * code that does not exist yet. A person decides those (R3).
 */
function textEffect(base: ArchitectureRule, head: ArchitectureRule): RuleEffect | 'same' {
  const pathsSame = base.from === head.from && base.mayNotImport === head.mayNotImport;
  if (pathsSame && sameSet(base.except, head.except)) return 'same';
  if (pathsSame && head.except.every((e) => base.except.includes(e))) return 'tightens';
  return 'loosens';
}

export function diffRules(base: readonly ArchitectureRule[], head: readonly ArchitectureRule[], edges: readonly Edge[]): RuleChange[] {
  const out: RuleChange[] = [];
  const before = new Map(base.map((r) => [r.id, r]));
  const after = new Map(head.map((r) => [r.id, r]));

  for (const [id, b] of before) {
    const h = after.get(id);
    if (!h) {
      const allowed = breaches(b, edges);
      out.push({
        rule: id, change: 'removed', effect: 'loosens', allowed, forbidden: [],
        words: `✗ This change removes the rule “${b.from} may not import ${b.mayNotImport}” (${id})${allowed.length ? `: ${imports(allowed.length)} it forbade become allowed` : ''}. Loosening a rule needs a person's approval in the app.`,
      });
      continue;
    }
    const text = textEffect(b, h);
    if (text === 'same') {
      if (b.because !== h.because) {
        out.push({ rule: id, change: 'changed', effect: 'reworded', allowed: [], forbidden: [], words: `· This change rewords why the rule ${id} exists.` });
      }
      continue;
    }
    const was = breaches(b, edges);
    const now = breaches(h, edges);
    const allowed = minus(was, now);
    const forbidden = minus(now, was);
    const effect: RuleEffect = text === 'loosens' || allowed.length > 0 ? 'loosens' : 'tightens';
    const what = `“${b.from} may not import ${b.mayNotImport}${b.except.length ? ` (except ${b.except.join(', ')})` : ''}” to “${h.from} may not import ${h.mayNotImport}${h.except.length ? ` (except ${h.except.join(', ')})` : ''}”`;
    out.push({
      rule: id, change: 'changed', effect, allowed, forbidden,
      words: effect === 'loosens'
        ? `✗ This change loosens the rule ${id}, from ${what}${allowed.length ? `: ${imports(allowed.length)} it forbade become allowed` : ''}. Loosening a rule needs a person's approval in the app.`
        : `⚠ This change tightens the rule ${id}, from ${what}${forbidden.length ? `: ${imports(forbidden.length)} already in the code would break it` : ''}.`,
    });
  }

  for (const [id, h] of after) {
    if (before.has(id)) continue;
    const forbidden = breaches(h, edges);
    out.push({
      rule: id, change: 'added', effect: 'tightens', allowed: [], forbidden,
      words: `⚠ This change adds the rule “${h.from} may not import ${h.mayNotImport}” (${id})${forbidden.length ? `: ${imports(forbidden.length)} already in the code would break it` : ''}. It is checked once it is on the base branch.`,
    });
  }
  return out;
}
