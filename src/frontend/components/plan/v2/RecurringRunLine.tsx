import { Repeat } from 'lucide-react';
import { usePlanRecurrence } from '../../../hooks/useRecurring';
import { usePlanItemsStore } from '../../../stores/plan-items-store';

/**
 * Phase 32 C4.2b — on a run's own page: which recurring playbook it is a run
 * of and for which period, who started it (a person, or the schedule), and
 * the tasks it carried from the run before, each a link to the task. A plan
 * that is no run says nothing.
 */
export function RecurringRunLine({ planUid }: { planUid: string }) {
  const recurrence = usePlanRecurrence(planUid);
  if (!recurrence) return null;
  return (
    <div className="rounded-lg border border-sky-400/20 bg-sky-500/[0.04] px-3 py-2 text-[12.5px]" data-testid="recurring-run-line">
      <div className="flex items-center gap-2 text-sky-100">
        <Repeat size={13} className="text-sky-300 shrink-0" />
        <span data-testid="recurring-run-line-words">{recurrence.line}</span>
      </div>
      {recurrence.words && <div className="mt-0.5 ml-5 text-[11.5px] text-foreground-muted">{recurrence.words}</div>}
      {recurrence.carriedTasks.length > 0 && (
        <ul className="mt-1 ml-5 space-y-0.5 text-[11.5px]">
          {recurrence.carriedTasks.map((t) => (
            <li key={t.itemUid} data-testid="recurring-carried-task">
              <button
                type="button"
                onClick={() => usePlanItemsStore.getState().selectItem(t.itemUid)}
                className="text-foreground hover:text-accent underline-offset-2 hover:underline"
              >
                {t.title}
              </button>
              <span className="text-foreground-muted"> — carried from {t.from}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
