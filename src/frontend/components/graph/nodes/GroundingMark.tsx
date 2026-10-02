/**
 * The test-grounding overlay on a node (Phase 32 B8.3a): ✓ passing, ✗
 * failing, ⚠ tests older than the code, ○ no tests, from the reports agents
 * handed over; a cluster sums its files ("✗ 2 · ✓ 9"). In words on hover
 * and as a glyph, never colour alone.
 */

const TONE: Record<string, string> = {
  failing: 'border-red-400/70 bg-[#2a0b0b] text-red-300',
  stale: 'border-amber-400/70 bg-[#2a1f08] text-amber-300',
  passing: 'border-emerald-400/60 bg-[#06221a] text-emerald-300',
  untested: 'border-white/15 bg-[#11151c] text-zinc-400',
};

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
