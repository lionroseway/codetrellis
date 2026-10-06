/**
 * Phase 33 C3 — the debt ratchet: a rule's existing breaches, written down
 * once, may only fall (design §5).
 *
 * A team adopting a rule over old code has imports that already break it.
 * `codetrellis rules baseline` writes them to `.codetrellis/rules/baseline.yaml`,
 * per rule, and commits with the code. From then on the check judges the
 * whole tree, not only what a change adds: a breach the base's baseline does
 * not list fails, and a rule with fewer breaches than its baseline says so,
 * so the count can be locked in lower.
 *
 *     # .codetrellis/rules/baseline.yaml
 *     rules:
 *       web-not-db:
 *         - web/legacy/report.ts > db/client.ts
 *
 * The baseline is judged by the base's copy, like the rules (R2), and may
 * only shrink: a change that adds an entry to a rule the base already has a
 * baseline for fails. A rule new to the baseline (a rule added, or baselined
 * for the first time) may start with what breaks it now. A baseline never
 * excuses an import the change adds: that check (A7.3) does not read it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { checkEdges } from './architecture-rule';
import { readTextWithin } from './confined-fs';

export const BASELINE_FILE = '.codetrellis/rules/baseline.yaml';
const MAX_ENTRIES = 20_000;

/** Each rule's breaches, as `from > to`. */
export type Baseline = Map<string, Set<string>>;

const entry = (e: { from: string; to: string }) => `${e.from} > ${e.to}`;

export function parseBaseline(text: string): Baseline {
  const out: Baseline = new Map();
  let raw: unknown;
  try { raw = parseYaml(text, { maxAliasCount: 0 }); } catch { return out; }
  const rules = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).rules : null;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return out;
  let n = 0;
  for (const [id, list] of Object.entries(rules as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const set = new Set<string>();
    for (const x of list) {
      if (typeof x !== 'string' || !x.includes(' > ') || ++n > MAX_ENTRIES) continue;
      set.add(x.trim());
    }
    out.set(id, set);
  }
  return out;
}

export function baselineYaml(b: Baseline): string {
  const rules: Record<string, string[]> = {};
  for (const id of [...b.keys()].sort()) rules[id] = [...b.get(id)!].sort();
  return '# CodeTrellis: imports that already broke each rule when it was baselined.\n'
    + '# The check fails on any breach not listed here, and this file may only shrink.\n'
    + '# Written by `codetrellis rules baseline`; fix a breach, then run it again.\n'
    + stringifyYaml({ rules }, { lineWidth: 0 });
}

/** The baseline for the rules and the project's imports now. Guides check nothing, so have none. */
export function baselineOf(rules: readonly ArchitectureRule[], edges: ReadonlyArray<{ from: string; to: string }>): Baseline {
  const out: Baseline = new Map();
  for (const r of rules) {
    if (r.strength === 'guide') continue;
    out.set(r.id, new Set(checkEdges([r], edges as Array<{ from: string; to: string }>).map(entry)));
  }
  return out;
}

/** The working tree's baseline, or null when there is none. */
export function readBaseline(projectRoot: string): Baseline | null {
  if (!fs.existsSync(path.join(projectRoot, BASELINE_FILE))) return null;
  try { return parseBaseline(readTextWithin(projectRoot, BASELINE_FILE, 'rule baseline')); } catch { return null; }
}

/** A commit's baseline, or null when it has none. */
export function baselineAt(projectRoot: string, commit: string): Baseline | null {
  try {
    const text = execFileSync('git', ['-C', projectRoot, 'show', `${commit}:./${BASELINE_FILE}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
    return parseBaseline(text);
  } catch { return null; }
}

export interface RatchetFinding {
  rule: string;
  kind: 'grew' | 'breach' | 'fell';
  /** For a breach, the import. */
  from?: string;
  to?: string;
  words: string;
}

/**
 * The ratchet, judged by the base's baseline and rules. `head` is the
 * branch's baseline file; `now` the project's imports. Pure.
 */
export function ratchet(
  base: Baseline | null,
  head: Baseline | null,
  rules: readonly ArchitectureRule[],
  edges: ReadonlyArray<{ from: string; to: string }>,
): RatchetFinding[] {
  const out: RatchetFinding[] = [];
  // May only shrink: what the branch's file lists beyond the base's, for a rule the base baselined.
  for (const [id, entries] of head ?? new Map<string, Set<string>>()) {
    const was = base?.get(id);
    if (!was) continue;
    const added = [...entries].filter((e) => !was.has(e));
    if (added.length) {
      out.push({ rule: id, kind: 'grew', words: `✗ This change adds ${added.length} ${added.length === 1 ? 'entry' : 'entries'} to the baseline of ${id} (${added.slice(0, 3).join(', ')}${added.length > 3 ? ', …' : ''}); a baseline may only shrink.` });
    }
  }
  if (!base) return out;
  for (const r of rules) {
    const listed = base.get(r.id);
    if (!listed || r.strength === 'guide') continue;
    const breaches = checkEdges([r], edges as Array<{ from: string; to: string }>);
    for (const b of breaches) {
      if (listed.has(entry(b))) continue;
      out.push({ rule: r.id, kind: 'breach', from: b.from, to: b.to, words: `✗ ${b.from} imports ${b.to}, which the rule “${r.from} may not import ${r.mayNotImport}” forbids, and its baseline does not list it` });
    }
    const left = breaches.filter((b) => listed.has(entry(b))).length;
    if (left < listed.size) {
      out.push({ rule: r.id, kind: 'fell', words: `↓ ${r.id}: ${left} ${left === 1 ? 'breach' : 'breaches'} left, down from ${listed.size} in the baseline. Run \`codetrellis rules baseline\` to lock in the lower count.` });
    }
  }
  return out;
}
