/**
 * Phase 33 G8 — rules on the graph (RULES-AND-CLARITY §5.6).
 *
 * With the Rules overlay on, an import that breaks a rule is drawn in the
 * breach style, and a file (or a cluster holding one) that imports across a
 * rule carries a ⊘ mark with how many, and which. "Show this suite" fades
 * every node no rule of that suite is about. Pure: the rules in, the marks
 * out; the canvas and the inspector render them.
 */

import { inRulePattern } from '../../shared/lib/rule-pattern';

export interface OverlayRule {
  id: string;
  kind?: string;
  from: string;
  mayNotImport: string;
  only?: string[];
  except: string[];
  suite?: string;
  strength: string;
}
export interface OverlayBreach { rule: string; from: string; to: string }
export interface OverlayRuleView { rule: OverlayRule; words: string; breaches: OverlayBreach[] | null }

/** The breaches of the rules that are checked (a guide is not). */
export function breachesOf(views: readonly OverlayRuleView[]): OverlayBreach[] {
  return views.filter((v) => v.rule.strength !== 'guide').flatMap((v) => v.breaches ?? []);
}

/** Which rules an import between these files breaks: a file edge, or a cluster edge with the files under each end. */
export function edgeBreaches(breaches: readonly OverlayBreach[], fromFiles: readonly string[], toFiles: readonly string[]): string[] {
  if (breaches.length === 0 || fromFiles.length === 0 || toFiles.length === 0) return [];
  const from = new Set(fromFiles);
  const to = new Set(toFiles);
  return [...new Set(breaches.filter((b) => from.has(b.from) && to.has(b.to)).map((b) => b.rule))].sort();
}

/** A node's ⊘ mark: how many imports from its files break a rule, and which rules; null when none. */
export function nodeBreachMark(breaches: readonly OverlayBreach[], files: readonly string[]): { count: number; rules: string[]; title: string } | null {
  if (breaches.length === 0 || files.length === 0) return null;
  const mine = new Set(files);
  const hits = breaches.filter((b) => mine.has(b.from));
  if (hits.length === 0) return null;
  const rules = [...new Set(hits.map((b) => b.rule))].sort();
  const lines = hits.slice(0, 8).map((b) => `${b.from} → ${b.to} (${b.rule})`);
  return {
    count: hits.length,
    rules,
    title: `⊘ ${hits.length} ${hits.length === 1 ? 'import breaks' : 'imports break'} a rule:\n${lines.join('\n')}${hits.length > 8 ? `\n…and ${hits.length - 8} more` : ''}`,
  };
}

/** Whether a rule is about a file: it is in the rule's scope, may alone import its package, or is what the rule guards. */
export function ruleCovers(rule: OverlayRule, file: string): boolean {
  if (rule.kind === 'package') return inRulePattern(rule.from, file) || (rule.only ?? []).some((o) => inRulePattern(o, file));
  return inRulePattern(rule.from, file) || inRulePattern(rule.mayNotImport, file);
}

/** The rules about a file, each with the breaches that start or end at it. */
export function rulesForFile(views: readonly OverlayRuleView[], file: string): Array<OverlayRuleView & { here: OverlayBreach[] }> {
  return views
    .filter((v) => ruleCovers(v.rule, file) || (v.breaches ?? []).some((b) => b.from === file || b.to === file))
    .map((v) => ({ ...v, here: (v.breaches ?? []).filter((b) => b.from === file || b.to === file) }));
}

/** Whether any rule of a suite is about any of these files: what "Show this suite" keeps lit. */
export function suiteCovers(views: readonly OverlayRuleView[], suite: string, files: readonly string[]): boolean {
  const rules = views.filter((v) => (v.rule.suite ?? 'config.json') === suite);
  return files.some((f) => rules.some((v) => ruleCovers(v.rule, f) || (v.breaches ?? []).some((b) => b.from === f || b.to === f)));
}
