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

/** Keep this machine's state of a task set two ways at once (C3.2): a new record, made having seen the others. */
async function keep(itemUid: string): Promise<void> {
  try { await fetch(`/api/items/${encodeURIComponent(itemUid)}/keep-state`, { method: 'POST' }); } catch { /* the banner stays */ }
}

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
      {s.atOnce && (
        <span
          role="status"
          data-testid="item-state-at-once"
          className="basis-full rounded border border-amber-400/30 bg-amber-400/[0.06] px-2 py-1 text-amber-200"
          title="Records made without seeing each other's change. Nothing is picked: the next change to this task, made by either of you, settles it."
        >
          ⚠ {s.atOnce.words[0].toUpperCase()}{s.atOnce.words.slice(1)}.{' '}
          <button
            type="button"
            data-testid="item-state-keep"
            onClick={() => { void keep(item.uid); }}
            className="ml-1 rounded bg-white/[0.08] px-1.5 py-0.5 text-foreground hover:bg-white/[0.14]"
          >
            Keep “{s.words}”
          </button>
          <span className="ml-1.5 text-amber-200/80">or set the state you want.</span>
        </span>
      )}
    </div>
  );
}
