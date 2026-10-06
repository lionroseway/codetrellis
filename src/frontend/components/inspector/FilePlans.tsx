/**
 * Phase 33 G5 — the plans and tasks that touch the selected file, shown
 * with the file rather than behind "View source". A task opens its plan at
 * that task (restoring a minimised plan, G6).
 */

import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import type { FileOverlay } from '../../lib/plan-overlay';
import { fileTouches } from '../../lib/file-plan-touches';
import { revealPlanItem } from '../../lib/open-plan-item';

export function FilePlans({ overlay }: { overlay: FileOverlay | null }) {
  const plans = usePlanStore((s) => s.plans);
  const touching = useMemo(
    () => fileTouches(overlay, new Map(plans.map((p) => [p.uid, p.title]))),
    [overlay, plans],
  );

  return (
    <section data-testid="file-plans" aria-label="Plans that touch this file">
      <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-foreground-subtle mb-1">
        <ListChecks size={10} /> Plans
      </h3>
      {touching.length === 0 ? (
        <p className="text-[10.5px] text-foreground-subtle">No plan touches this file.</p>
      ) : (
        <ul className="space-y-1.5">
          {touching.map((plan) => (
            <li key={plan.planUid}>
              <p className="text-[11px] text-foreground truncate" title={plan.title}>{plan.title}</p>
              <ul className="mt-0.5 space-y-0.5">
                {plan.tasks.map((t) => (
                  <li key={t.itemUid}>
                    <button
                      type="button"
                      data-testid="file-plan-task"
                      onClick={() => { void revealPlanItem(plan.planUid, t.itemUid); }}
                      className="w-full flex items-baseline gap-1.5 px-1.5 py-0.5 rounded text-left text-[10.5px] text-foreground-muted hover:bg-white/[0.05] hover:text-foreground"
                    >
                      <span aria-hidden className="shrink-0 w-3 text-center">{t.glyph}</span>
                      <span className="truncate">{t.title}</span>
                      <span className="ml-auto shrink-0 text-[9.5px] text-foreground-subtle">
                        {t.state}{t.holder ? ` · ${t.holder}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
