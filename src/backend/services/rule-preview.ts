/**
 * Phase 33 R3 — what a change to one rule would do against the code, before
 * anyone makes it: the change's effect (R2's words), and how many imports
 * break the rule as proposed. Shared by the app's preview and `propose_rule`,
 * so a person and an agent read the same answer.
 */

import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { checkEdges, findRule } from './architecture-rules';
import { diffRules, type RuleChange } from './rule-changes';

export interface RulePreview {
  change: RuleChange | null;
  /** Imports that break the rule as proposed, or null when the graph loaded is not this project's (or it is a guide). */
  breaches: number | null;
  words: string;
  needsConfirm: boolean;
}

export const NO_CHANGE = 'This changes nothing about how code is judged.';

export function previewChange(projectRoot: string, id: string, next: ArchitectureRule | null, edges: Array<{ from: string; to: string }> | null): RulePreview {
  const current = findRule(projectRoot, id);
  const change = diffRules(current ? [current] : [], next ? [next] : [], edges ?? [])[0] ?? null;
  const breaches = edges && next && next.strength !== 'guide' ? checkEdges([next], edges).length : null;
  return { change, breaches, words: change ? change.words : NO_CHANGE, needsConfirm: change?.effect === 'loosens' };
}

/** The preview as an answer: the change without the rules it compares. */
export function previewJson(p: RulePreview) {
  return {
    change: p.change ? { rule: p.change.rule, change: p.change.change, effect: p.change.effect, allowed: p.change.allowed, forbidden: p.change.forbidden, words: p.change.words } : null,
    words: p.words,
    breaches: p.breaches,
    needsConfirm: p.needsConfirm,
  };
}
