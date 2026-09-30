/**
 * Phase 32 B6.3 — where two plans in the stack meet (observability spec §5:
 * "overlap bands where two plans touch the same files or functions, declared
 * or actual", in words: "⚠ overlaps JIRA-150").
 *
 * Declared: both plans' unfinished tasks name the same file (a file spec, or
 * the file a symbol spec lives in) or the same function. Actual: an open
 * collision or contract signal between the lines of work the two plans'
 * tasks are worked on. Signals are keyed by workstream root, so a plan's
 * roots come from its tasks' branches, the way the review queue maps them.
 *
 * Pure: the caller passes each plan's footprint and the signals.
 */
import type { AwarenessSignal, PlanItem } from '../../shared/types';
import type { StackOverlap, StackOverlapSignal } from '../../shared/types/stack';
import { isSettled } from './plan-dependencies';

export interface PlanFootprint {
  uid: string;
  label: string;
  /** Files its unfinished tasks name. */
  files: ReadonlySet<string>;
  /** Functions its unfinished tasks name, keyed `file#name` (or `name` when no file is given), shown by name. */
  symbols: ReadonlyMap<string, string>;
  /** The workstream roots its tasks are worked in, as signals name them. */
  roots: readonly string[];
}

/** What a plan's unfinished tasks say they will touch. */
export function declaredFootprint(items: readonly PlanItem[]): { files: Set<string>; symbols: Map<string, string> } {
  const files = new Set<string>();
  const symbols = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== 'action' || isSettled(item)) continue;
    for (const f of item.fileSpecs ?? []) {
      if (f.isDir) continue;
      if (f.path) files.add(f.path);
      if (f.moveTo) files.add(f.moveTo);
    }
    for (const s of item.symbolSpecs ?? []) {
      if (!s.name) continue;
      symbols.set(s.filePath ? `${s.filePath}#${s.name}` : s.name, s.name);
      if (s.filePath) files.add(s.filePath);
    }
  }
  return { files, symbols };
}

const OPEN: ReadonlySet<string> = new Set(['open', 'acknowledged', 'intended']);

function list(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/**
 * Every pair of plans that meet, from each side. `canon` makes two spellings
 * of one folder compare equal (a symlink, `branch:` names pass through).
 */
export function stackOverlaps(
  plans: readonly PlanFootprint[],
  signals: readonly AwarenessSignal[],
  canon: (root: string) => string = (r) => r,
): Map<string, StackOverlap[]> {
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);
  const actual = new Map<string, StackOverlapSignal[]>();
  const plansAt = (root: string) => plans.filter((p) => p.roots.some((r) => canon(r) === canon(root)));

  for (const s of signals) {
    if ((s.kind !== 'collision' && s.kind !== 'contract') || !OPEN.has(s.state)) continue;
    const seen = new Set<string>();
    for (let i = 0; i < s.workstreams.length; i++) {
      for (let j = i + 1; j < s.workstreams.length; j++) {
        for (const a of plansAt(s.workstreams[i])) {
          for (const b of plansAt(s.workstreams[j])) {
            if (a.uid === b.uid) continue;
            const key = pairKey(a.uid, b.uid);
            if (seen.has(key)) continue;
            seen.add(key);
            const at = actual.get(key) ?? [];
            at.push({ id: s.id, kind: s.kind, severity: s.severity, summary: s.summary });
            actual.set(key, at);
          }
        }
      }
    }
  }

  const out = new Map<string, StackOverlap[]>(plans.map((p) => [p.uid, []]));
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const a = plans[i];
      const b = plans[j];
      const files = [...a.files].filter((f) => b.files.has(f)).sort();
      const symbols = [...a.symbols.keys()].filter((k) => b.symbols.has(k)).map((k) => a.symbols.get(k)!).sort();
      const signalsBetween = actual.get(pairKey(a.uid, b.uid)) ?? [];
      if (files.length === 0 && symbols.length === 0 && signalsBetween.length === 0) continue;

      const parts: string[] = [];
      if (symbols.length || files.length) parts.push(`Both plan to change ${list([...symbols, ...files])}.`);
      if (signalsBetween.length) parts.push(`Open now: ${signalsBetween.map((s) => s.summary).join('; ')}`);
      const detail = parts.join(' ');
      const high = signalsBetween.some((s) => s.severity === 'high');
      for (const [me, other] of [[a, b], [b, a]] as const) {
        out.get(me.uid)!.push({
          withPlanUid: other.uid,
          withLabel: other.label,
          declared: { files, symbols },
          actual: signalsBetween,
          high,
          words: `⚠ overlaps ${other.label}`,
          detail,
        });
      }
    }
  }
  for (const each of out.values()) {
    each.sort((x, y) => Number(y.high) - Number(x.high) || x.withLabel.localeCompare(y.withLabel));
  }
  return out;
}
