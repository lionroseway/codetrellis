import { useEffect, useState } from 'react';
import { GRADE_GLYPH, GRADE_ORDER, GRADE_WORDS, type CriterionGrade } from '@shared/lib/grounding-line';

/**
 * Phase 32 B8.3b — how far a task's criteria rest on evidence, in one line:
 * "3 criteria · 2 grounded · 1 waiting on a person". The same words the
 * phone and an agent's brief give; each part names, on hover, the criteria
 * it counts and why.
 */

export interface TaskGroundingView {
  words: string | null;
  total: number;
  grounded: boolean;
  counts: Record<CriterionGrade, number>;
  criteria: Array<{ uid: string; text: string; grade: CriterionGrade; why: string }>;
}

/** Asked again whenever `nonce` changes (a criterion's state, a submission, a decision). */
export function useTaskGrounding(itemUid: string, nonce: string): TaskGroundingView | null {
  const [g, setG] = useState<TaskGroundingView | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/items/${encodeURIComponent(itemUid)}/grounding`)
      .then(async (r) => (r.ok ? ((await r.json()) as TaskGroundingView) : null))
      .catch(() => null)
      .then((v) => { if (live) setG(v); });
    return () => { live = false; };
  }, [itemUid, nonce]);
  return g;
}

const TONE: Record<CriterionGrade, string> = {
  grounded: 'text-green-400',
  waiting: 'text-amber-300',
  sent_back: 'text-red-300',
  changed: 'text-amber-300',
  tests_older: 'text-amber-300',
  failing: 'text-red-300',
  no_evidence: 'text-foreground-subtle',
};

export function GroundingLine({ grounding }: { grounding: TaskGroundingView | null }) {
  if (!grounding || !grounding.words) return null;
  const present = GRADE_ORDER.filter((g) => grounding.counts[g] > 0);
  return (
    <p className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px]" data-testid="grounding-line" data-grounded={grounding.grounded ? 'yes' : 'no'} aria-label={grounding.words}>
      <span className="text-foreground-subtle">{grounding.total} criteri{grounding.total === 1 ? 'on' : 'a'}</span>
      {present.map((g) => {
        const these = grounding.criteria.filter((c) => c.grade === g);
        const n = grounding.counts[g];
        const label = grounding.grounded ? (n === 1 ? 'grounded' : 'all grounded') : `${n} ${GRADE_WORDS[g]}`;
        return (
          <span key={g} className={`${TONE[g]} inline-flex items-baseline gap-1`} data-testid={`grounding-${g}`} title={these.map((c) => `${c.text}: ${c.why}`).join('\n')}>
            <span aria-hidden>·</span><span aria-hidden>{GRADE_GLYPH[g]}</span>{label}
          </span>
        );
      })}
    </p>
  );
}
