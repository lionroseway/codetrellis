/**
 * The test-grounding overlay on a node (Phase 32 B8.3a): ✓ passing, ✗
 * failing, ⚠ tests older than the code, ○ no tests, from the reports agents
 * handed over; a cluster sums its files ("✗ 2 · ✓ 9"). In words on hover
 * and as a glyph, never colour alone.
 */

import { GRAPH_MARK } from '../../../lib/visual-language';

/** Failing red, older amber, passing green, none grey: `TESTS` in the vocabulary. */
const TONE = GRAPH_MARK.tests;

export function GroundingMark({ grounding }: { grounding?: unknown }) {
  if (!grounding || typeof grounding !== 'object') return null;
  const g = grounding as { state?: unknown; mark?: unknown; short?: unknown; title?: unknown };
  const label = typeof g.short === 'string' ? g.short : typeof g.mark === 'string' ? g.mark : null;
  if (!label || typeof g.state !== 'string') return null;
  const title = typeof g.title === 'string' ? g.title : undefined;
  return (
    <span
      data-testid="node-grounding"
      data-state={g.state}
      title={title}
      aria-label={title}
      role="img"
      className={`absolute top-2 right-3 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 font-mono text-[10.5px] leading-none ${TONE[g.state] ?? TONE.untested}`}
    >
      {label}
    </span>
  );
}
