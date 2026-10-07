/**
 * Phase 33 G7 — the Rules view's summaries: each suite with its status,
 * breaches and debt, and the history of changes to the rules.
 *
 * A suite holds when nothing breaks its checked rules today; it breaks when
 * something does; its state is unknown when the project's graph is not the
 * one loaded. Debt is what the baseline (C3) lists as already there: old
 * breaches that may only fall.
 */

import { getDb } from './database';
import { readBaseline } from './rule-baseline';
import { phraseEvent } from '../../shared/lib/tool-phrasing';
import type { RuleView } from '../../shared/types/architecture-rules';
import type { AgentEvent } from '../../shared/types';

export interface SuiteSummary {
  suite: string;
  /** Where it is kept. */
  where: string;
  rules: number;
  /** Imports that break its checked rules today, or null when they cannot be counted here. */
  breaches: number | null;
  /** Old breaches the baseline lists, which may only fall. */
  debt: number;
  status: 'holds' | 'breaks' | 'unknown';
  /** "2 rules · 1 import breaks one today · 3 old breaches in the baseline" */
  words: string;
}

export interface RuleHistoryEntry { at: number; ruleId: string | null; change: string; by: string; words: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each rule's debt: how many breaches the baseline lists for it. */
export function debtByRule(projectRoot: string): Map<string, number> {
  const base = readBaseline(projectRoot);
  return new Map([...(base ?? new Map())].map(([id, entries]) => [id, entries.size]));
}

export function suiteSummaries(views: readonly RuleView[], debt: ReadonlyMap<string, number>): SuiteSummary[] {
  const by = new Map<string, RuleView[]>();
  for (const v of views) {
    const k = v.rule.suite ?? 'config.json';
    by.set(k, [...(by.get(k) ?? []), v]);
  }
  return [...by].map(([suite, vs]) => {
    const checked = vs.filter((v) => v.rule.strength !== 'guide');
    const unknown = checked.some((v) => v.breaches === null);
    const breaches = unknown ? null : checked.reduce((n, v) => n + (v.breaches?.length ?? 0), 0);
    const owed = vs.reduce((n, v) => n + (debt.get(v.rule.id) ?? 0), 0);
    const status: SuiteSummary['status'] = unknown ? 'unknown' : breaches! > 0 ? 'breaks' : 'holds';
    const words = [
      plural(vs.length, 'rule'),
      breaches === null ? 'open the project to see what breaks them' : breaches === 0 ? 'nothing breaks them today' : `${plural(breaches, 'import')} ${breaches === 1 ? 'breaks' : 'break'} them today`,
      ...(owed ? [`${plural(owed, 'old breach', 'old breaches')} in the baseline`] : []),
    ].join(' · ');
    return { suite, where: vs[0].where, rules: vs.length, breaches, debt: owed, status, words };
  }).sort((a, b) => a.suite.localeCompare(b.suite));
}

/** The changes to a project's rules, newest first, as the Timeline words them. */
export function ruleHistory(projectRoot: string, limit = 100): RuleHistoryEntry[] {
  let rows: unknown[][] = [];
  try {
    rows = getDb().exec(
      `SELECT id, at, source, type, payload FROM agent_events WHERE type = 'rule_changed' ORDER BY at DESC LIMIT 2000`,
    )[0]?.values ?? [];
  } catch { return []; }
  const out: RuleHistoryEntry[] = [];
  for (const r of rows) {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(String(r[4])) as Record<string, unknown>; } catch { continue; }
    if (payload.projectRoot !== projectRoot) continue;
    const phrased = phraseEvent({ id: String(r[0]), timestamp: Number(r[1]), source: String(r[2]), type: String(r[3]), payload } as AgentEvent);
    out.push({
      at: Number(r[1]),
      ruleId: typeof payload.ruleId === 'string' ? payload.ruleId : null,
      change: String(payload.change ?? 'changed'),
      by: String(payload.author ?? 'someone'),
      words: phrased.text,
    });
    if (out.length >= limit) break;
  }
  return out;
}
