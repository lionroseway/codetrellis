/**
 * "Other work in flight" (Phase 32 A5.2, awareness spec §9.2): what a review
 * and a PR body say about the lines of work around the one under review.
 *
 * Every entry is an awareness signal that names that workstream, in the
 * desktop's words (`signal-words.ts`), with what happened to it: fixed,
 * acknowledged with each agent's note, marked intended by the person (a
 * decision, written down so the reviewer need not rediscover it), set aside,
 * or still open. A contract adds who will need updating, in the direction
 * that matters for a merge.
 *
 * Pure. Never quotes an agent except the notes agents left for the person.
 */

import type { AwarenessSignal, SignalStateBy } from '../types';
import { kindWords, sideWords, sideRootsOf } from './signal-words';

export type OtherWorkOutcome = 'open' | 'acknowledged' | 'intended' | 'dismissed' | 'fixed';

export interface OtherWorkEntry {
  signalId: string;
  kind: AwarenessSignal['kind'];
  severity: AwarenessSignal['severity'];
  /** "Changed signature", "Same function". */
  heading: string;
  /** Each side in one sentence, in the tab's order. */
  sides: Array<{ name: string; words: string }>;
  outcome: OtherWorkOutcome;
  /** What happened to it, in a sentence. */
  outcomeWords: string;
  /** The notes the agents left, as "codex: …". */
  notes: string[];
  /** For a contract: what merging means for the other side. */
  merge?: string;
}

export interface OtherWorkInFlight {
  /** The workstream under review. */
  workstream: { root: string; name: string };
  entries: OtherWorkEntry[];
  /** Open high signals: the ones that keep it from being ready (§9.2). */
  openHigh: number;
}

const RANK: Record<OtherWorkOutcome, number> = { open: 0, acknowledged: 1, intended: 2, dismissed: 3, fixed: 4 };
const SEVERITY: Record<AwarenessSignal['severity'], number> = { high: 0, medium: 1, low: 2 };
/** Fixed ones are history: the most recent few are enough to show the work was tidied. */
const MAX_FIXED = 5;

function who(by: SignalStateBy | undefined): string {
  if (!by) return 'someone';
  if (by.actorType === 'unverified') return 'someone through the local API, not verified as the person';
  return by.channel === 'phone' ? 'the person, from their phone' : 'the person';
}

function outcomeOf(s: AwarenessSignal): OtherWorkOutcome {
  if (s.state === 'resolved') return 'fixed';
  return s.state;
}

function outcomeWords(s: AwarenessSignal, outcome: OtherWorkOutcome): string {
  switch (outcome) {
    case 'fixed': return 'Fixed: what caused it is gone.';
    case 'acknowledged': return `Acknowledged by ${who(s.stateBy)}.`;
    case 'intended': return `Marked intended by ${who(s.stateBy)}: a decision, not an accident.`;
    case 'dismissed': return `Set aside by ${who(s.stateBy)}.`;
    default: return s.reopened
      ? `Open again: it changed since it was ${s.reopened.from === 'intended' ? 'marked intended' : 'acknowledged'}.`
      : 'Open: nobody has answered it yet.';
  }
}

function mergeWords(s: AwarenessSignal, target: string, label: (root: string) => string, same: (a: string, b: string) => boolean): string | undefined {
  if (s.kind !== 'contract' || !s.subject.by) return undefined;
  const symbol = s.subject.symbol ?? 'an export';
  const others = sideRootsOf(s).filter((r) => !same(r, target)).map(label);
  if (same(s.subject.by, target)) {
    const verb = s.subject.change === 'removed' ? 'removes' : 'changes';
    const who = others.join(' and ') || 'another line of work';
    return `Merging this ${verb} ${symbol}; ${who} ${others.length > 1 ? 'import' : 'imports'} it and will need updating.`;
  }
  return `This imports ${symbol}, which ${label(s.subject.by)} ${s.subject.change === 'removed' ? 'removes' : 'changes'}: merge after it and update, or ask it to keep the old form.`;
}

/**
 * The entries for `target`, from every signal (live and resolved) of the
 * project. `same` compares workstream roots (a caller canonicalises paths).
 */
export function otherWorkInFlight(
  target: { root: string; name: string },
  signals: readonly AwarenessSignal[],
  label: (root: string) => string,
  same: (a: string, b: string) => boolean = (a, b) => a === b,
): OtherWorkInFlight {
  const mine = signals.filter((s) => s.workstreams.some((w) => same(w, target.root)));
  const entries = mine.map((s): OtherWorkEntry => {
    const outcome = outcomeOf(s);
    const merge = mergeWords(s, target.root, label, same);
    return {
      signalId: s.id,
      kind: s.kind,
      severity: s.severity,
      heading: kindWords(s),
      sides: sideWords(s, label).map(({ name, words }) => ({ name, words })),
      outcome,
      outcomeWords: outcomeWords(s, outcome),
      notes: (s.told ?? []).filter((t) => t.note).map((t) => `${t.agentType}: ${t.note}`),
      ...(merge ? { merge } : {}),
    };
  });
  entries.sort((a, b) => RANK[a.outcome] - RANK[b.outcome] || SEVERITY[a.severity] - SEVERITY[b.severity]);
  const fixed = entries.filter((e) => e.outcome === 'fixed');
  const kept = [...entries.filter((e) => e.outcome !== 'fixed'), ...fixed.slice(0, MAX_FIXED)];
  return {
    workstream: target,
    entries: kept,
    openHigh: entries.filter((e) => e.outcome === 'open' && e.severity === 'high').length,
  };
}

/** The section as markdown, for `review_plan` and the PR body. */
export function otherWorkMarkdown(o: OtherWorkInFlight): string {
  const lines = ['### Other work in flight', ''];
  if (o.entries.length === 0) {
    lines.push(`No other line of work overlaps with \`${o.workstream.name}\`.`, '');
    return lines.join('\n');
  }
  lines.push(`How \`${o.workstream.name}\` meets the other lines of work, and what happened to each overlap.`, '');
  for (const e of o.entries) {
    lines.push(`- **${e.severity.toUpperCase()} · ${e.heading}.** ${e.sides.map((s) => s.words).join(' ')}`);
    if (e.merge) lines.push(`  ${e.merge}`);
    lines.push(`  ${e.outcomeWords}`);
    for (const n of e.notes) lines.push(`  > ${n}`);
  }
  lines.push('');
  return lines.join('\n');
}
