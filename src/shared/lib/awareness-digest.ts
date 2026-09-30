/**
 * The digest (Phase 32 A3.1, awareness spec §4.5): the distilled view of
 * parallel work. People don't read streams; this is a few lines a person
 * takes in at a glance, and the same words for an agent in `get_awareness`.
 *
 * Built from signals, never from the Timeline:
 *  - only what needs someone: open high and medium signals (a signal the
 *    person answered is seen; low ones are counted, not listed);
 *  - grouped by kind and by the workstreams it names, so two worktrees
 *    overlapping in four places is one line, not four;
 *  - each line says what changed, who is affected, whether the agents were
 *    told, and what is waiting on the person;
 *  - at most `maxLines` lines, then "and N more".
 *
 * Pure. The caller supplies how a workstream root reads (its branch).
 */

import type { AwarenessSignal } from '../types';

export const DIGEST_MAX_LINES = 5;

export interface DigestLine {
  kind: AwarenessSignal['kind'];
  severity: AwarenessSignal['severity'];
  signalIds: string[];
  /** What changed and who is affected. Backticks mark workstream names. */
  text: string;
  /** Every agent concerned has been told (A2.6). */
  told: boolean;
  /** The choice the person is asked to make. */
  question: string;
}

export interface Digest {
  /** Open high and medium signals. */
  needsYou: number;
  lines: DigestLine[];
  /** Groups past the cap. */
  moreLines: number;
  /** Open low signals: counted, not listed. */
  low: number;
  /** Needs-you signals first seen after `since`, when it was given. */
  newSince: number | null;
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

const QUESTION: Record<AwarenessSignal['kind'], string> = {
  collision: 'who goes first, or is it intended?',
  contract: 'keep the old signature, or update the callers?',
  drift: 'is the wider scope meant?',
  'stale-base': 'rebase now, or later?',
  'version-split': 'which version should both use?',
};

/** Tasks' materials (A6.3) ask their own question where the code one would not fit. */
const MATERIAL_QUESTION: Partial<Record<AwarenessSignal['kind'], string>> = {
  contract: 'check the cited parts again, or keep the old version?',
  collision: 'which task writes it?',
  drift: 'is the file meant to be shared?',
  'stale-base': 'read it again, or keep the old version?',
};

const listed = (names: string[], max = 2) =>
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function subjectOf(s: AwarenessSignal): string {
  if (s.subject.file && s.subject.symbol) return `${s.subject.file} → ${s.subject.symbol}`;
  return s.subject.file ?? (s.subject.files ?? []).join(', ');
}

function lineText(kind: AwarenessSignal['kind'], group: AwarenessSignal[], label: (root: string) => string): string {
  const first = group[0];
  // A material signal is one per material, and its summary already names the tasks (A6.3).
  if (first.subject.material) return first.summary;
  const names = (roots: string[]) => roots.map((r) => `\`${label(r)}\``);
  if (kind === 'contract') {
    const by = first.subject.by ?? first.workstreams[0];
    const others = names(first.workstreams.filter((w) => w !== by)).join(' and ');
    const symbols = [...new Set(group.map((s) => s.subject.symbol ?? '?'))];
    const removed = group.every((s) => s.subject.change === 'removed');
    if (group.length === 1) {
      return removed
        ? `\`${label(by)}\` removed ${symbols[0]}; ${others} imports it`
        : `\`${label(by)}\` changed ${symbols[0]}'s signature; ${others} imports it`;
    }
    return `\`${label(by)}\` changed ${plural(symbols.length, 'exported name')} ${others} imports: ${listed(symbols)}`;
  }
  if (kind === 'drift') {
    const files = [...new Set(group.flatMap((s) => s.subject.files ?? []))];
    return `${names(first.workstreams)[0]} changes ${plural(files.length, 'file')} outside its scope: ${listed(files)}`;
  }
  // collision
  const pair = names(first.workstreams).join(' and ');
  if (group.length === 1) {
    const declared = first.subject.intended?.length ? ' (declared, not yet edited)' : '';
    return `${pair} both change ${subjectOf(first)}${declared}`;
  }
  return `${pair} both change ${plural(group.length, 'thing')}: ${listed(group.map(subjectOf))}`;
}

/** The digest of these signals. */
export function buildDigest(
  signals: readonly AwarenessSignal[],
  label: (root: string) => string,
  opts: { since?: number | null; maxLines?: number } = {},
): Digest {
  const live = signals.filter((s) => s.state !== 'resolved');
  const needs = live.filter((s) => s.state === 'open' && s.severity !== 'low');
  const low = live.filter((s) => s.state === 'open' && s.severity === 'low').length;

  // One line per kind and workstreams (and, for a contract, which side changed it).
  const groups = new Map<string, AwarenessSignal[]>();
  for (const s of needs) {
    const key = s.subject.material
      ? `material\0${s.id}`
      : `${s.kind}\0${s.kind === 'contract' ? `${s.subject.by ?? ''}\0` : ''}${[...s.workstreams].sort().join('\0')}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const ordered = [...groups.values()]
    .map((g) => g.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.lastSeen - a.lastSeen))
    .sort((a, b) => RANK[a[0].severity] - RANK[b[0].severity] || b[0].lastSeen - a[0].lastSeen);

  const max = opts.maxLines ?? DIGEST_MAX_LINES;
  const lines = ordered.slice(0, max).map((g): DigestLine => ({
    kind: g[0].kind,
    severity: g[0].severity,
    signalIds: g.map((s) => s.id),
    text: lineText(g[0].kind, g, label),
    told: g.every((s) => (s.told ?? []).some((t) => t.toldAt !== null)),
    question: (g[0].subject.material ? MATERIAL_QUESTION[g[0].kind] : undefined) ?? QUESTION[g[0].kind],
  }));

  return {
    needsYou: needs.length,
    lines,
    moreLines: Math.max(0, ordered.length - max),
    low,
    newSince: opts.since == null ? null : needs.filter((s) => s.firstSeen > (opts.since as number)).length,
  };
}

/** The digest as one plain paragraph, for an agent. */
export function digestText(d: Digest): string {
  if (d.needsYou === 0) {
    return d.low ? `Nothing needs attention; ${plural(d.low, 'low-priority note')}.` : 'Nothing overlaps with other work right now.';
  }
  const lines = d.lines.map((l) => `${l.text}.${l.told ? ' Agents told.' : ''} Waiting on the person: ${l.question}`);
  if (d.moreLines) lines.push(`And ${plural(d.moreLines, 'more overlap')}.`);
  if (d.low) lines.push(`${plural(d.low, 'low-priority note')}.`);
  return `${plural(d.needsYou, 'signal')} ${d.needsYou === 1 ? 'needs' : 'need'} attention. ${lines.join(' ')}`;
}
