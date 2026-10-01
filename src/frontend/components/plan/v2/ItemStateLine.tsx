/**
 * Phase 32 C2.4 — the item's state with its source, at the top of its page.
 *
 * Every item has one: a task on a branch says what git (or the review host)
 * proves; any other task says what the plan records and who recorded it,
 * "from the plan", in the same type as a code task's; a section sums the
 * tasks under it. Read, never written.
 */

import { useMemo } from 'react';
import type { PlanItem } from '@shared/types';
import { recordedWords } from '@shared/lib/item-status';
import { SOURCE_TONE, usePlanStatus } from '../../../lib/plan-status';

/** Why a teammate's record is "unverified" (C3.1), on hover. */
const RECORD_EXPLAINER = 'Read from a record in the project\'s files, which git or a synced folder brought here. '
  + 'Anyone who can write to those files could write one in another person\'s name, so it is not proven until records are signed.';

export function ItemStateLine({ item }: { item: PlanItem }) {
  const nonce = `${item.uid}:${item.status ?? ''}:${item.workstream ?? ''}:${item.updatedAt ?? ''}`;
  const status = usePlanStatus(item.planUid, nonce);
  const s = useMemo(() => status?.items.find((i) => i.itemUid === item.uid) ?? null, [status, item.uid]);
  if (!s) return null;
  const recorded = s.source === 'plan' ? recordedWords(s.recorded) : null;
  return (
    <div data-testid="item-state-line" data-state={s.state} data-source={s.source} className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-foreground-muted">
      <span className="text-[11px] uppercase tracking-wider text-foreground-subtle">State</span>
      <span className="text-foreground" data-testid="item-state-words">{s.words}</span>
      <span data-testid="item-state-source" className={`rounded border px-1 text-[10.5px] ${SOURCE_TONE[s.source] ?? ''}`}>{s.from}</span>
      {recorded && (
        <span
          className="text-foreground-subtle"
          data-testid="item-state-recorded"
          data-recorded-type={s.recorded?.byType}
          title={s.recorded?.byType === 'record' ? RECORD_EXPLAINER : undefined}
        >
          {recorded}
        </span>
      )}
      {s.gitNote && <span className="text-foreground-subtle" data-testid="item-state-git-note">· {s.gitNote}</span>}
    </div>
  );
}
