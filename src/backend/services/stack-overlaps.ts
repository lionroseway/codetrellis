/**
 * Phase 32 B6.3 — where two plans in the stack meet (observability spec §5:
 * "overlap bands where two plans touch the same files or functions, declared
 * or actual", in words: "⚠ overlaps JIRA-150").
 *
 * Declared: both plans' unfinished tasks name the same file (a file spec, or
 * the file a symbol spec lives in) or the same function, or list the same
 * material in their briefs. Actual: an open collision or contract signal
 * between the lines of work the two plans' tasks are worked on, or a
 * material signal between two of their tasks. Signals are keyed by
 * workstream, so a plan's roots are its tasks' branch folders, the way the
 * review queue maps them, and its tasks themselves (`task:<uid>`, A6.1),
 * which is how a material signal names them (HD3).
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
  /** The workstream roots its tasks are worked in, and its tasks (`task:<uid>`), as signals name them. */
  roots: readonly string[];
  /** Materials its unfinished tasks' briefs list, project-relative (HD3). */
  materials?: ReadonlySet<string>;
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

type OverlapInput = Pick<AwarenessSignal, 'id' | 'kind' | 'severity' | 'summary' | 'workstreams' | 'state'> & { subject?: AwarenessSignal['subject'] };

/**
 * Whether a signal says two plans meet. A collision or a contract always
 * does. A material's changed version or split versions (A6.3) do too: two
 * tasks working from one spreadsheet is the business form of two branches
 * touching one file. Code stale-base and drift are about one line of work.
 */
function meets(s: OverlapInput): s is OverlapInput & { kind: StackOverlapSignal['kind'] } {
  if (s.kind === 'collision' || s.kind === 'contract') return true;
  return (s.kind === 'version-split' || s.kind === 'stale-base') && !!s.subject?.material;
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p;

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
  signals: readonly OverlapInput[],
  canon: (root: string) => string = (r) => r,
  /** "now" for the live stack; "then" for the stack at a past moment (B6.5). */
  when: 'now' | 'then' = 'now',
): Map<string, StackOverlap[]> {
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);
  const actual = new Map<string, StackOverlapSignal[]>();
  const plansAt = (root: string) => plans.filter((p) => p.roots.some((r) => canon(r) === canon(root)));

  for (const s of signals) {
    if (!meets(s) || !OPEN.has(s.state)) continue;
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
      const materials = [...(a.materials ?? [])].filter((m) => b.materials?.has(m)).sort();
      const signalsBetween = actual.get(pairKey(a.uid, b.uid)) ?? [];
      if (files.length === 0 && symbols.length === 0 && materials.length === 0 && signalsBetween.length === 0) continue;

      const parts: string[] = [];
      if (symbols.length || files.length) parts.push(`Both plan to change ${list([...symbols, ...files])}.`);
      if (materials.length) parts.push(`Both rely on ${list(materials.map(baseName))}.`);
      if (signalsBetween.length) parts.push(`Open ${when}: ${signalsBetween.map((s) => s.summary).join('; ')}`);
      const detail = parts.join(' ');
      const high = signalsBetween.some((s) => s.severity === 'high');
      for (const [me, other] of [[a, b], [b, a]] as const) {
        out.get(me.uid)!.push({
          withPlanUid: other.uid,
          withLabel: other.label,
          declared: { files, symbols, materials },
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
