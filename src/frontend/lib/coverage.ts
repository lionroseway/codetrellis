/**
 * Turning coverage numbers into sentences — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * ## "Unresolved" was the wrong word, and the numbers proved it
 *
 * The first version of this surface reported `resolved / total` and led
 * with the percentage. On the test fixture that reads **45%**, which
 * looks like something is badly broken. Nothing is: C# imports `System`,
 * Go imports `net/http`, Python imports its standard library. Those were
 * never going to resolve to a file inside the scan — they are external
 * **by definition**, not failures.
 *
 * So the framing is internal-versus-external, not resolved-versus-failed.
 * An import that points outside the project is a fact about the
 * project's dependencies, and the ratio is genuinely interesting — it is
 * roughly "how self-contained is this codebase" — but it is not a score
 * and must never be presented as one.
 *
 * We deliberately do **not** claim to know which outside-pointing imports
 * are a standard library and which are something we failed to read. The
 * resolver returns null either way and nothing records the difference,
 * so asserting it would be exactly the over-claim this phase exists to
 * remove. What the per-language reason gives instead is the honest
 * shape: here is why THIS language has more of them than you might
 * expect, written from what `services/resolvers/<lang>.ts` actually does.
 */

/** How much of a language's outward-pointing imports the language itself explains. */
export type GapKind =
  /** Expected: the language genuinely does not write these down. */
  | 'inherent'
  /** Partly expected: a known limitation with a known shape. */
  | 'known-limit'
  /** Unexplained: worth looking at. */
  | 'unexplained';

export interface GapExplanation {
  kind: GapKind;
  /** One sentence, shown next to the count. No jargon, no blame. */
  text: string;
}

/**
 * Why a language's imports may not resolve. Keyed by the scanner's
 * language tag.
 *
 * Absent from this map means "no known reason", which is deliberately
 * different from "no reason" — see `explainGap`.
 */
const REASONS: Record<string, GapExplanation> = {
  swift: {
    kind: 'inherent',
    text: 'Swift files in the same module see each other with no import at all, so most coupling here is never written down.',
  },
  ruby: {
    kind: 'inherent',
    text: 'Rails autoloading resolves classes by naming convention rather than by require, so those dependencies are implied rather than declared.',
  },
  csharp: {
    kind: 'known-limit',
    text: 'The .NET base class library accounts for most of these. A using also names a namespace rather than a file, so resolution follows the project’s root namespace.',
  },
  kotlin: {
    kind: 'known-limit',
    text: 'The Kotlin and Java standard libraries, plus anything from Gradle, live outside the project and have no file here to point at.',
  },
  java: {
    kind: 'known-limit',
    text: 'The JDK and third-party packages live outside the project. Wildcard imports also name a package rather than a class.',
  },
  go: {
    kind: 'known-limit',
    text: 'Standard-library packages like fmt and net/http, plus any third-party module, live outside the project.',
  },
  python: {
    kind: 'known-limit',
    text: 'Standard-library and installed-package imports live outside the project.',
  },
  typescript: {
    kind: 'known-limit',
    text: 'npm packages live outside the project unless they are a workspace member.',
  },
  javascript: {
    kind: 'known-limit',
    text: 'npm packages live outside the project unless they are a workspace member.',
  },
  rust: {
    kind: 'known-limit',
    text: 'Crates from outside the workspace live outside the project.',
  },
  php: {
    kind: 'known-limit',
    text: 'Composer packages outside the project have no file here to point at.',
  },
};

/**
 * The reason a language's imports did not all resolve, or null when the
 * language resolved everything.
 *
 * A language with a gap and no entry in `REASONS` returns `unexplained`
 * rather than nothing. That is the honest state — we do not know — and
 * it is the one worth a reader's attention, so it must not look
 * identical to a language that is fine.
 */
export function explainGap(language: string, imports: number, resolved: number): GapExplanation | null {
  if (imports <= 0 || resolved >= imports) return null;
  return (
    REASONS[language.toLowerCase()] ?? {
      kind: 'unexplained',
      text: 'No known reason for these to point outside the project — worth a look.',
    }
  );
}

/**
 * Share of imports that link to a file inside the project, 0–100.
 *
 * Roughly "how self-contained is this codebase". NOT a score: a low
 * number means heavy reliance on external packages, which is a fact
 * about the project and not a fault in it. 100 when there is nothing to
 * link, because a project with no imports has not failed at anything.
 */
export function internalPercent(imports: number, resolved: number): number {
  if (imports <= 0) return 100;
  return Math.round((resolved / imports) * 100);
}

/**
 * The headline sentence for the HTTP side.
 *
 * Deliberately not phrased as a fault. A route with no caller in the
 * repository might be consumed by something outside the scan, might be
 * genuinely dead, or might have a caller whose extractor missed it —
 * three different situations, and the tool cannot tell them apart. It
 * can only make the question askable.
 */
export function describeHttpGap(unservedRoutes: number, unmatchedCalls: number): string | null {
  const parts: string[] = [];
  if (unservedRoutes > 0) {
    parts.push(`${unservedRoutes} endpoint${unservedRoutes === 1 ? '' : 's'} nothing here calls`);
  }
  if (unmatchedCalls > 0) {
    parts.push(`${unmatchedCalls} call${unmatchedCalls === 1 ? '' : 's'} to something outside this project`);
  }
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/**
 * Ordering for the panel: the rows a reader should look at first.
 *
 * Unexplained gaps lead, because they are the only ones that might be a
 * defect. Then inherent and known limits by size, then fully-resolved
 * languages, which are there to be reassuring rather than interesting.
 */
export function sortByAttention<T extends { language: string; imports: number; resolved: number }>(
  rows: readonly T[],
): T[] {
  const rank = (row: T): number => {
    const gap = explainGap(row.language, row.imports, row.resolved);
    if (!gap) return 3;
    if (gap.kind === 'unexplained') return 0;
    if (gap.kind === 'inherent') return 1;
    return 2;
  };
  return [...rows].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (b.imports - b.resolved) - (a.imports - a.resolved);
  });
}
