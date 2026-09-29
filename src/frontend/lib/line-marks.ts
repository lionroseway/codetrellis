/**
 * The code view's workstream gutter (Phase 32 B3.2): which lines this copy
 * changed against its merge base with main, and, separately, which lines
 * other workstreams change, placed on this copy's lines.
 *
 * Another workstream's hunks are numbered in ITS copy, so they are placed
 * through the base: their base lines, moved by this copy's own hunks above
 * them. When the two branched from different commits of main this is
 * approximate; the words on hover keep their own line numbers, which are
 * exact. Pure.
 */

import type { LineHunk, WorkstreamLineChanges } from '@shared/types';
import { hunkSentence } from '../../shared/lib/line-changes';

export interface GutterMark {
  who: string;
  kind: LineHunk['kind'];
  committed: boolean;
  /** "billing-v2 changed 40–52, in validateCreateOrder, not committed". */
  sentence: string;
}

export interface GutterMarks {
  /** This copy's own changes, on its lines; a removal marks the line above the gap. */
  own: Map<number, GutterMark[]>;
  /** Other workstreams' changes, placed on this copy's lines. */
  others: Map<number, GutterMark[]>;
  /** The other workstreams changing this file, in the order given. */
  otherChanges: WorkstreamLineChanges[];
  /** This copy's own entry, when it changes the file. */
  ownChanges: WorkstreamLineChanges | null;
}

/** Where a base line sits in this copy, given this copy's own hunks. */
export function baseToOwn(line: number, own: readonly LineHunk[]): number {
  let shift = 0;
  for (const h of [...own].sort((a, b) => a.old.start - b.old.start)) {
    const oldEnd = h.old.start + h.old.lines - 1;
    if (h.old.lines > 0 && line >= h.old.start && line <= oldEnd) return Math.max(1, h.new.start);
    const before = h.old.lines > 0 ? oldEnd < line : h.old.start < line;
    if (before) shift += h.new.lines - h.old.lines;
  }
  return Math.max(1, line + shift);
}

const norm = (p: string) => p.replace(/[\\/]+$/, '');

function add(map: Map<number, GutterMark[]>, line: number, mark: GutterMark): void {
  map.set(line, [...(map.get(line) ?? []), mark]);
}

/**
 * The gutter for one file. `ownRoot` is the open copy's folder; the entry
 * whose workstream is that folder is "this copy". `nameOf` names a
 * workstream in words (its branch, else its folder).
 */
export function gutterMarks(
  changes: readonly WorkstreamLineChanges[],
  ownRoot: string | null,
  nameOf: (c: WorkstreamLineChanges) => string,
): GutterMarks {
  const own = new Map<number, GutterMark[]>();
  const others = new Map<number, GutterMark[]>();
  const ownChanges = (ownRoot && changes.find((c) => norm(c.workstream) === norm(ownRoot))) || null;
  const otherChanges = changes.filter((c) => c !== ownChanges && c.status !== 'unchanged');
  const ownHunks = ownChanges?.hunks ?? [];

  if (ownChanges) {
    const who = nameOf(ownChanges);
    for (const h of ownChanges.hunks) {
      const mark = { who, kind: h.kind, committed: h.committed, sentence: hunkSentence(who, h) };
      if (h.kind === 'removed') add(own, Math.max(1, h.new.start), mark);
      else for (let n = h.new.start; n < h.new.start + h.new.lines; n++) add(own, n, mark);
    }
  }
  for (const c of otherChanges) {
    const who = nameOf(c);
    for (const h of c.hunks) {
      const mark = { who, kind: h.kind, committed: h.committed, sentence: hunkSentence(who, h) };
      if (h.kind === 'added') {
        add(others, baseToOwn(Math.max(1, h.old.start), ownHunks), mark);
      } else {
        const from = baseToOwn(h.old.start, ownHunks);
        const to = baseToOwn(h.old.start + h.old.lines - 1, ownHunks);
        for (let n = from; n <= Math.max(from, to); n++) add(others, n, mark);
      }
    }
  }
  return { own, others, otherChanges, ownChanges };
}

/** The glyph for this copy's own change on a line: ＋ added, ～ changed, − lines removed below. */
export function ownGlyph(marks: readonly GutterMark[] | undefined): string {
  if (!marks?.length) return '';
  const kinds = new Set(marks.map((m) => m.kind));
  return kinds.has('changed') ? '～' : kinds.has('added') ? '＋' : '−';
}
