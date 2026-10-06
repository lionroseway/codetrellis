import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { showPlan } from '../../lib/open-plan-item';
import { useReplayStore } from '../../stores/replay-store';
import { useRecurring, startRecurringRun } from '../../hooks/useRecurring';

/**
 * Phase 32 C4.2a — a recurring run that fell due while the app was closed,
 * asked about in the inbox (shared-work doc C-4: "Weekly security review is
 * due since Monday. Start it?"). Start makes the run, or finds the one a
 * teammate already started, and opens it; "Not this time" leaves it, and it
 * reads missed once its period ends. One the app started as it came is
 * never asked about.
 */
export function RecurringDue() {
  const root = useProjectStore((s) => s.root);
  const replaying = useReplayStore((s) => s.active);
  const { series, reload } = useRecurring(root);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);

  const due = series.filter((s) => s.due && !s.due.dismissed);
  if (!root || replaying || due.length === 0) return null;

  const start = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const run = await startRecurringRun(root, id);
      await reload();
      void showPlan(run.planUid);
    } catch (e) {
      setError({ id, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const notNow = async (id: string) => {
    setBusy(id);
    await fetch(`/api/recurring/${encodeURIComponent(id)}/dismiss?project=${encodeURIComponent(root)}`, { method: 'POST' }).catch(() => null);
    await reload();
    setBusy(null);
  };

  return (
    <div className="space-y-2" data-testid="recurring-due">
      {due.map((s) => (
        <div key={s.rule.id} data-testid="recurring-due-run" className="rounded-lg border border-sky-400/30 bg-sky-500/[0.05] px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <Repeat size={12} className="text-sky-300 shrink-0 self-center" />
            <span className="font-medium text-sky-100" data-testid="recurring-due-words">{s.due!.words}. Start it?</span>
          </div>
          <div className="mt-0.5 text-[10.5px] text-foreground-muted">{s.words} · from the {s.rule.playbook} playbook</div>
          <div className="mt-1.5 flex gap-2 text-[10.5px]">
            <button
              type="button"
              data-testid="recurring-due-start"
              disabled={busy === s.rule.id}
              onClick={() => { void start(s.rule.id); }}
              className="px-2 py-0.5 rounded border border-sky-400/40 text-sky-100 hover:bg-sky-500/15 disabled:opacity-40"
            >
              Start {s.rule.title} — {s.due!.label}
            </button>
            <button
              type="button"
              data-testid="recurring-due-dismiss"
              disabled={busy === s.rule.id}
              onClick={() => { void notNow(s.rule.id); }}
              title="Leave it: it is not asked about again here, and reads missed once its period ends"
              className="px-2 py-0.5 rounded text-foreground-muted hover:text-foreground disabled:opacity-40"
            >
              Not this time
            </button>
          </div>
          {error?.id === s.rule.id && <div className="mt-1 text-danger" data-testid="recurring-due-error">{error.text}</div>}
        </div>
      ))}
    </div>
  );
}
