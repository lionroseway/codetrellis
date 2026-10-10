/**
 * Phase 33 R2 — what a change does to the rulebook (design §4.1).
 *
 * A pull request cannot change the rules that judge it: the gate judges with
 * the base branch's rules, and reports the difference between the base's
 * rulebook and the branch's as its own finding. Loosening — a rule removed,
 * its strength lowered (R4), or its paths or exceptions changed in a way not
 * proven to only tighten — needs a person (R3 signs it); tightening is reported and never
 * blocks; a reworded reason is listed.
 *
 * Pure: two lists of rules and the project's import edges in, the changes
 * out. The edges give each change its effect in imports, so the words say
 * what it would allow ("3 imports it forbade become allowed").
 */

import type { ArchitectureRule, RuleStrength } from '../../shared/types/architecture-rules';
import { checkEdges, ruleStatement } from './architecture-rule';

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
  /** The rule on the base, and on the branch (null when there is none). */
  before: ArchitectureRule | null;
  after: ArchitectureRule | null;
  /** R3: for a loosening, the person's signed approval that travels with it, or why the one attached does not count. */
  approval?: { ok: true; by: string; how: 'git' | 'device'; file: string } | { ok: false; why: string } | null;
}

// A folder breach (R8) says what is wrong in words, which change with the rule's terms: it is keyed by its file.
const key = (e: Edge) => (e.to.startsWith('folder:') ? `${e.from}>folder` : `${e.from}>${e.to}`);
const breaches = (rule: ArchitectureRule, edges: readonly Edge[]): Edge[] =>
  checkEdges([rule], edges as Edge[]).map((b) => ({ from: b.from, to: b.to }));
const minus = (a: Edge[], b: Edge[]): Edge[] => { const drop = new Set(b.map(key)); return a.filter((e) => !drop.has(key(e))); };
// B2: a grep rule is broken by lines, or by files that lack its text, not imports.
const imports = (n: number, r?: ArchitectureRule | null) => {
  const noun = r?.kind === 'grep' ? (r.must ? 'file' : 'line') : 'import';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
};
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/**
 * Only a rule whose paths stayed the same and whose exceptions only shrank
 * is proven to tighten from its text alone; any other change to `from`,
 * `mayNotImport` or `except` is treated as loosening, since it may allow
 * code that does not exist yet. A person decides those (R3).
 */
function textEffect(base: ArchitectureRule, head: ArchitectureRule): RuleEffect | 'same' {
  // B1: what a glob or a regex covers is not proven from its text, so any change of matcher or pattern loosens.
  const pathsSame = (base.kind ?? 'imports') === (head.kind ?? 'imports') && base.from === head.from && base.mayNotImport === head.mayNotImport && (base.match ?? null) === (head.match ?? null);
  // B3: a lower threshold matches more look-alikes (tighter), a higher one fewer (looser).
  const threshold = (base.threshold ?? null) === (head.threshold ?? null) ? 'same' : (head.threshold ?? 1) < (base.threshold ?? 1) ? 'tightens' : 'loosens';
  // A package or symbol rule's `only` is who may: fewer is tighter, more or other is looser (R5, R6).
  const baseOnly = base.only ?? [];
  const headOnly = head.only ?? [];
  const onlySame = sameSet(baseOnly, headOnly);
  const onlyShrank = headOnly.every((o) => baseOnly.includes(o));
  // A folder rule's terms (R8): an empty list allows anything, so naming some
  // where there were none, or fewer, tightens; dropping "one export" loosens.
  const allowed = (b: readonly string[] = [], h: readonly string[] = []) =>
    sameSet(b, h) ? 'same' : (b.length === 0 && h.length > 0) || (h.length > 0 && h.every((x) => b.includes(x))) ? 'tightens' : 'loosens';
  const folder = [allowed(base.files, head.files), allowed(base.kinds, head.kinds),
    base.exports === head.exports ? 'same' : head.exports === 'one' ? 'tightens' : 'loosens'];
  // B2: a grep rule reading other files, requiring rather than forbidding, or in another case, is not proven tighter.
  const grepSame = sameSet(base.in ?? [], head.in ?? []) && !!base.must === !!head.must && !!base.ignoreCase === !!head.ignoreCase;
  // A tag selects the rule into a pipeline's stages: one dropped may take it out of a stage, one added only into more.
  const baseTags = base.tags ?? [];
  const headTags = head.tags ?? [];
  const tags = sameSet(baseTags, headTags) ? 'same' : baseTags.every((t) => headTags.includes(t)) ? 'tightens' : 'loosens';
  const folderSame = folder.every((f) => f === 'same') && grepSame && threshold === 'same' && tags === 'same';
  const folderTighter = folder.every((f) => f !== 'loosens') && grepSame && threshold !== 'loosens' && tags !== 'loosens';
  if (pathsSame && onlySame && sameSet(base.except, head.except) && folderSame) return 'same';
  if (pathsSame && onlyShrank && head.except.every((e) => base.except.includes(e)) && folderTighter) return 'tightens';
  return 'loosens';
}

/** R4: block holds hardest, then warn; a guide checks nothing. Lowering one loosens it. */
const RANK: Record<RuleStrength, number> = { guide: 0, warn: 1, block: 2 };
function strengthEffect(base: ArchitectureRule, head: ArchitectureRule): RuleEffect | 'same' {
  const d = RANK[head.strength] - RANK[base.strength];
  return d === 0 ? 'same' : d > 0 ? 'tightens' : 'loosens';
}

const stated = (r: ArchitectureRule) => `“${ruleStatement(r)}”`;

export function diffRules(base: readonly ArchitectureRule[], head: readonly ArchitectureRule[], edges: readonly Edge[]): RuleChange[] {
  const out: RuleChange[] = [];
  const before = new Map(base.map((r) => [r.id, r]));
  const after = new Map(head.map((r) => [r.id, r]));

  for (const [id, b] of before) {
    const h = after.get(id);
    if (!h) {
      const allowed = breaches(b, edges);
      out.push({
        rule: id, change: 'removed', effect: 'loosens', allowed, forbidden: [], before: b, after: null,
        words: `✗ This change removes the rule “${ruleStatement({ ...b, except: [] })}” (${id})${allowed.length ? `: ${imports(allowed.length, b)} it forbade become allowed` : ''}. Loosening a rule needs a person's approval in the app.`,
      });
      continue;
    }
    const text = textEffect(b, h);
    const strength = strengthEffect(b, h);
    if (text === 'same' && strength === 'same') {
      if (b.because !== h.because) {
        out.push({ rule: id, change: 'changed', effect: 'reworded', allowed: [], forbidden: [], before: b, after: h, words: `· This change rewords why the rule ${id} exists.` });
      }
      continue;
    }
    const was = breaches(b, edges);
    const now = breaches(h, edges);
    if (text === 'same') {
      // Only the strength moved: the same imports break it, and what changes is what they do.
      const n = was.length;
      out.push(strength === 'loosens'
        ? {
          rule: id, change: 'changed', effect: 'loosens', allowed: b.strength === 'block' ? was : [], forbidden: [], before: b, after: h,
          words: `✗ This change lowers the rule ${id} from ${b.strength} to ${h.strength}${n && b.strength === 'block' ? `: ${imports(n, b)} that break it would no longer fail CI` : ''}. Loosening a rule needs a person's approval in the app.`,
        }
        : {
          rule: id, change: 'changed', effect: 'tightens', allowed: [], forbidden: h.strength === 'block' ? now : [], before: b, after: h,
          words: `⚠ This change raises the rule ${id} from ${b.strength} to ${h.strength}${now.length && h.strength === 'block' ? `: ${imports(now.length, h)} already in the code would fail CI` : ''}.`,
        });
      continue;
    }
    const allowed = minus(was, now);
    const forbidden = minus(now, was);
    const effect: RuleEffect = text === 'loosens' || strength === 'loosens' || allowed.length > 0 ? 'loosens' : 'tightens';
    const at = (r: ArchitectureRule) => (b.strength === h.strength ? '' : ` at ${r.strength}`);
    const what = `${stated(b)}${at(b)} to ${stated(h)}${at(h)}`;
    out.push({
      rule: id, change: 'changed', effect, allowed, forbidden, before: b, after: h,
      words: effect === 'loosens'
        ? `✗ This change loosens the rule ${id}, from ${what}${allowed.length ? `: ${imports(allowed.length, b)} it forbade become allowed` : ''}. Loosening a rule needs a person's approval in the app.`
        : `⚠ This change tightens the rule ${id}, from ${what}${forbidden.length ? `: ${imports(forbidden.length, h)} already in the code would break it` : ''}.`,
    });
  }

  for (const [id, h] of after) {
    if (before.has(id)) continue;
    const forbidden = breaches(h, edges);
    out.push({
      rule: id, change: 'added', effect: 'tightens', allowed: [], forbidden, before: null, after: h,
      words: `⚠ This change adds the rule “${ruleStatement({ ...h, except: [] })}” (${id}) at ${h.strength}${forbidden.length ? `: ${imports(forbidden.length, h)} already in the code would break it` : ''}. It is checked once it is on the base branch.`,
    });
  }
  return out;
}

export const NEEDS = " Loosening a rule needs a person's approval in the app.";

/** How the gate says a change, given its approval (R3): approved, it is a note; otherwise the line says what is missing. */
export function changeWords(c: RuleChange): string {
  if (c.effect !== 'loosens' || !c.approval) return c.words;
  if (c.approval.ok) return `✓ ${c.words.replace(/^✗ /, '').replace(NEEDS, '')} ${c.approval.by} approved it in the app, signed (${c.approval.file}).`;
  return `${c.words} An approval is attached, but ${c.approval.why}.`;
}
