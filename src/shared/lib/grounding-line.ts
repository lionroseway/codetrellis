/**
 * A task's grounding line (Phase 32 B8.3b): how far its acceptance criteria
 * rest on evidence, in one line the window, the phone and an agent's brief
 * all say the same way: "3 criteria · 2 grounded · 1 waiting on a person".
 *
 * Each criterion is in exactly one of:
 *  - grounded: evidence attached, its checks pass, nothing changed since;
 *  - waiting on a person: its checks pass and a person must decide (or it
 *    is a judgement only a person can make);
 *  - sent back: a person sent it back;
 *  - changed since: a file it was approved on has changed;
 *  - failing: its checks fail on the evidence there is;
 *  - no evidence yet: nothing offered and nothing to check.
 *
 * Pure: the grades are the backend's (`services/task-grounding.ts`).
 */

export type CriterionGrade = 'grounded' | 'waiting' | 'sent_back' | 'changed' | 'failing' | 'no_evidence';

/** The order the line names them in: what is solid first, then what needs a person, then what needs work. */
export const GRADE_ORDER: readonly CriterionGrade[] = ['grounded', 'waiting', 'sent_back', 'changed', 'failing', 'no_evidence'];

export const GRADE_WORDS: Record<CriterionGrade, string> = {
  grounded: 'grounded',
  waiting: 'waiting on a person',
  sent_back: 'sent back',
  changed: 'changed since',
  failing: 'failing',
  no_evidence: 'no evidence yet',
};

/** A glyph for each, as the criteria block draws states: a word always beside it, colour third. */
export const GRADE_GLYPH: Record<CriterionGrade, string> = {
  grounded: '✓',
  waiting: '◐',
  sent_back: '↩',
  changed: '⚠',
  failing: '✗',
  no_evidence: '○',
};

export interface GroundingLine {
  /** "3 criteria · 2 grounded · 1 waiting on a person", or null for a task with none. */
  words: string | null;
  total: number;
  counts: Record<CriterionGrade, number>;
  /** Every criterion grounded. */
  grounded: boolean;
}

export function groundingLine(grades: readonly CriterionGrade[]): GroundingLine {
  const counts = Object.fromEntries(GRADE_ORDER.map((g) => [g, 0])) as Record<CriterionGrade, number>;
  for (const g of grades) counts[g]++;
  const total = grades.length;
  if (total === 0) return { words: null, total, counts, grounded: false };
  const parts = [`${total} criteri${total === 1 ? 'on' : 'a'}`];
  if (counts.grounded === total) parts.push(total === 1 ? 'grounded' : 'all grounded');
  else for (const g of GRADE_ORDER) if (counts[g]) parts.push(`${counts[g]} ${GRADE_WORDS[g]}`);
  return { words: parts.join(' · '), total, counts, grounded: counts.grounded === total };
}
