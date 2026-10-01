/**
 * Play-forward in the window (Phase 32 B9.2): where the planned overlaps of
 * `/api/play-forward` sit on the graph and in the Stack tab. Pure.
 */
import type { PlannedOverlap, PlayForward } from '@shared/types/play-forward';

export interface PlannedMark {
  /** Every planned overlap on it, one per line. */
  title: string;
  serious: boolean;
  /** Every one is sequenced: drawn quieter. */
  sequenced: boolean;
  count: number;
}

/** Each file's planned overlaps (a material has no file: it is in words only). */
export function overlapsByFile(data: PlayForward | null): Map<string, PlannedOverlap[]> {
  const out = new Map<string, PlannedOverlap[]>();
  for (const o of data?.overlaps ?? []) {
    if (!o.file) continue;
    out.set(o.file, [...(out.get(o.file) ?? []), o]);
  }
  return out;
}

function markOf(list: PlannedOverlap[]): PlannedMark | undefined {
  if (list.length === 0) return undefined;
  return {
    title: list.map((o) => `${o.words}${o.serious ? ' (serious)' : ''}`).join('\n'),
    serious: list.some((o) => o.serious),
    sequenced: list.every((o) => o.sequenced),
    count: list.length,
  };
}

/** A file node's mark: the dashed "◇ planned overlap" zone, with its words. */
export function filePlannedMark(byFile: Map<string, PlannedOverlap[]>, path: string): PlannedMark | undefined {
  return markOf(byFile.get(path) ?? []);
}

/** A cluster's: every planned overlap on any of its files, once each. */
export function clusterPlannedMark(byFile: Map<string, PlannedOverlap[]>, files: readonly string[]): PlannedMark | undefined {
  const seen = new Map<string, PlannedOverlap>();
  for (const f of files) for (const o of byFile.get(f) ?? []) seen.set(o.id, o);
  return markOf([...seen.values()]);
}

/** A plan's planned overlaps in the Stack tab: "◇ will overlap JIRA-150: validators.ts". */
export function planOverlapLines(data: PlayForward | null, planUid: string): Array<{ id: string; words: string; detail: string; serious: boolean; sequenced: boolean }> {
  return (data?.overlaps ?? [])
    .filter((o) => o.plans.some((p) => p.uid === planUid))
    .map((o) => {
      const others = o.plans.filter((p) => p.uid !== planUid).map((p) => p.label);
      const name = o.kind === 'symbol' ? o.subject.split('#').pop()! : o.subject.split(/[\\/]/).pop()!;
      return {
        id: o.id,
        words: `◇ will overlap ${others.join(', ')}: ${name}${o.sequenced ? ' (sequenced)' : ''}`,
        detail: o.words,
        serious: o.serious,
        sequenced: o.sequenced,
      };
    });
}
