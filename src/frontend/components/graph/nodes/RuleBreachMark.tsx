import { ATTENTION, chipClass } from '../../../lib/visual-language';

/**
 * Phase 33 G8 — a node whose files import across an architecture rule, with
 * the Rules overlay on: a ⊘ badge with how many, the imports and rules on
 * hover. Glyph and words as well as colour (G1).
 */
export function RuleBreachMark({ breach }: { breach?: unknown }) {
  if (!breach || typeof breach !== 'object') return null;
  const b = breach as { count?: unknown; title?: unknown; rules?: unknown };
  if (typeof b.count !== 'number' || typeof b.title !== 'string') return null;
  return (
    <span
      data-testid="node-rule-breach"
      data-rules={Array.isArray(b.rules) ? (b.rules as string[]).join(' ') : ''}
      title={b.title}
      aria-label={b.title}
      role="img"
      className={`absolute -bottom-2.5 left-4 z-10 flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] leading-none ${chipClass(ATTENTION.breach.tone)}`}
    >
      {ATTENTION.breach.glyph} {b.count} {b.count === 1 ? 'breach' : 'breaches'}
    </span>
  );
}
