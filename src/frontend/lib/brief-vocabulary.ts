/**
 * Phase 31 §10.3 — the Brief's words, in one table.
 *
 * Read by Brief components only. Internal names do not change: #64 chose
 * `aligned · drifted · outstanding` because they are the same question at
 * different scales, and a second vocabulary in the data would break that.
 * This is what the same things are called on a page an analyst reads.
 */
import type { CriterionState } from '@shared/types';

export const BRIEF_WORDS = {
  plan: 'brief',
  plans: 'briefs',
  action: 'task',
  actions: 'tasks',
  object: 'guide page',
  objects: 'guide',
  criterion: 'what good looks like',
  criteria: 'What good looks like',
  material: 'material',
  materials: 'Materials',
  outputs: 'Outputs',
  evidence: 'Evidence',
  drift: 'changed, and no task mentions it',
  freeze: 'close (period locked)',
} as const;

/**
 * A criterion's state as a glyph AND words (§10.4) — colour is the third
 * carrier, never the first. `met` says who approved it and when.
 */
export function briefState(
  state: CriterionState,
  met?: { actor: string; actorType: string; at: number } | null,
  you?: string | null,
): { glyph: string; words: string } {
  switch (state) {
    case 'open': return { glyph: '○', words: 'not yet' };
    case 'submitted': return { glyph: '◐', words: 'waiting for you' };
    case 'sent_back': return { glyph: '↩', words: 'sent back' };
    case 'stale': return { glyph: '⚠', words: 'changed since approved' };
    case 'met': {
      if (!met) return { glyph: '✓', words: 'met' };
      if (met.actorType !== 'human') return { glyph: '✓', words: 'met — approved by Claude' };
      const who = you && met.actor === you ? 'you' : met.actor;
      const when = new Date(met.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return { glyph: '✓', words: `met — ${who}, ${when}` };
    }
  }
}
