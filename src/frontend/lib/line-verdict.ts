/**
 * One answer per line, from the two signals we already had.
 *
 * The reader carried two independent colour systems and never joined
 * them: the git annotation said whether a line CHANGED, and the plan
 * overlay rail said whether a line was MEANT to change. Both were drawn,
 * faintly, in different palettes, and the comparison — which is the
 * entire product — was left to the person reading.
 *
 * So the join happens here, once, and the surfaces render the result.
 *
 *   aligned      planned, and it happened
 *   drifted      it happened, and nobody planned it
 *   outstanding  planned, and it has not happened yet
 *
 * `null` is the ordinary case: not planned, not changed. Most lines.
 *
 * The three names are deliberately the same words the plan-level drift
 * report uses, because they are the same question asked at a different
 * scale. A line that is `drifted` is a line-level instance of exactly
 * what `unclaimedChanges` reports for the plan.
 */

import type { LineAnnotation } from '../components/inspector/CodePreview';

export type LineVerdict = 'aligned' | 'drifted' | 'outstanding';

/**
 * Decide a line's verdict.
 *
 * `annotation` is git's answer, `planned` is the plan's. Neither is
 * authoritative alone, which is the whole point.
 */
export function lineVerdict(
  annotation: LineAnnotation | undefined,
  planned: boolean,
  /**
   * Does a plan item claim this FILE, without naming lines?
   *
   * Most plans target files. `fileSpecs` is a list of paths, and an item
   * that says "modify services/notifier/app.rb" produces a file-level
   * marker with no line span — so `indexMarkers`, which expands spans,
   * indexes nothing and every line reads `planned: false`.
   *
   * Without this, a change made exactly as the plan asked renders as
   * DRIFT, on every ordinary plan, which is precisely backwards. Caught
   * by looking at a screenshot of work that had just been done to order
   * and seeing it marked as work nobody asked for.
   *
   * A file-level claim is weaker evidence than a line-level one — it says
   * the right file, not the right place — but it is emphatically not
   * "nobody asked for this", and that is the distinction the verdict
   * exists to draw.
   */
  fileClaimed = false,
): LineVerdict | null {
  const changed = annotation === 'added' || annotation === 'modified';
  if (changed && (planned || fileClaimed)) return 'aligned';
  if (changed) return 'drifted';
  if (planned) return 'outstanding';
  // A file-level claim does not make every UNCHANGED line outstanding —
  // that would mark a whole file the plan merely mentions.
  return null;
}

export interface VerdictStyle {
  /** Single character in the gutter. Readable without colour. */
  glyph: string;
  /** Row tint — strong enough to see, quiet enough to read code through. */
  row: string;
  /** The stripe at the very left edge. */
  stripe: string;
  /** Gutter glyph colour. */
  ink: string;
  /** Said in words, for the tooltip. Colour is never the only carrier. */
  label: string;
}

/**
 * Presentation for each verdict.
 *
 * Kept beside the rule rather than in the component so the gutter, the
 * legend and any future surface cannot disagree about what green means.
 *
 * Tints were 4% opacity, which is below the threshold of noticing on any
 * display — the defect that started this. They are 12% now, and the
 * stripe carries the signal even where a tint would be lost against a
 * selection.
 *
 * GLYPHS MATCH THE SIDEBAR, on purpose. `Sidebar.tsx` has graded whole
 * files as ◇ planned / ✓ aligned / ◆ unplanned since Phase 26, and a
 * second vocabulary for the same three ideas one zoom level down would
 * be the sort of drift this codebase keeps finding in its own surfaces.
 * Same question, same symbol, whether you are looking at a file tree or
 * a line.
 */
export const VERDICT_STYLE: Record<LineVerdict, VerdictStyle> = {
  aligned: {
    glyph: '✓',
    row: 'bg-emerald-500/[0.12]',
    stripe: 'bg-emerald-400',
    ink: 'text-emerald-300',
    label: 'Planned, and changed',
  },
  drifted: {
    glyph: '◆',
    row: 'bg-fuchsia-500/[0.12]',
    stripe: 'bg-fuchsia-400',
    ink: 'text-fuchsia-300',
    label: 'Changed, but no plan item asked for it',
  },
  outstanding: {
    glyph: '◇',
    row: 'bg-violet-500/[0.09]',
    stripe: 'bg-violet-400/70',
    ink: 'text-violet-300',
    label: 'Planned, not changed yet',
  },
};

/**
 * The raw git mark.
 *
 * No longer rendered: it had its own gutter column, which made three
 * pieces of furniture before the line number for a signal that is the
 * verdict's input rather than an answer. `verdictTooltip` carries it in
 * words instead. Kept because the mapping is worth stating in one place
 * if any surface needs it again — the sidebar's file-level badges are
 * the likely caller.
 */
export function gitMark(annotation: LineAnnotation | undefined): string {
  if (annotation === 'added') return '+';
  if (annotation === 'modified') return '~';
  return '';
}

/**
 * The whole line, in words.
 *
 * This is the tooltip, and it is the only place a person can ask "was
 * this planned?" and get an answer without leaving the file. Colour says
 * it at a glance; this says it exactly.
 */
export function verdictTooltip(
  verdict: LineVerdict | null,
  annotation: LineAnnotation | undefined,
  itemTitle?: string | null,
  intent?: string | null,
  /** True when the claim is on the file rather than these lines. */
  fileLevel = false,
): string {
  if (!verdict) return 'Unchanged, and no plan item covers this line';

  const parts = [VERDICT_STYLE[verdict].label];

  if (annotation === 'added') parts.push('added since HEAD');
  else if (annotation === 'modified') parts.push('modified since HEAD');

  if (itemTitle) {
    const scope = fileLevel ? 'this file' : 'these lines';
    parts.push(intent ? `${intent} ${scope} · ${itemTitle}` : `${itemTitle} wants ${scope}`);
  } else if (verdict === 'drifted') {
    parts.push('no item claims this file');
  }

  return parts.join(' — ');
}
