/**
 * Approving a plan, from the plan header.
 *
 * There was no way to do this in the window or on the phone, so the only way
 * a plan became approved was an agent setting it with `update_plan`, which
 * skipped what an approval does: the baseline snapshot and the planned
 * overlaps it is in (B9.3b). Approving is the person's, as a criterion's is;
 * `update_plan` now refuses it and an agent sets "review" to ask.
 *
 * Shown while the plan is a draft or in review. Approving says the planned
 * overlaps the plan is in, once, as the phone does.
 */
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { usePlanStore } from '../../../stores/plan-store';
import { useToastStore } from '../../../stores/toast-store';

export function ApprovePlanButton({ planUid, status }: { planUid: string; status: string }) {
  const approvePlan = usePlanStore((s) => s.approvePlan);
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  if (status !== 'draft' && status !== 'review') return null;

  const approve = async () => {
    setBusy(true);
    const r = await approvePlan(planUid);
    setBusy(false);
    if (!r.ok) { addToast({ type: 'error', title: 'Could not approve the plan', message: r.error }); return; }
    addToast(r.plannedOverlaps.length
      ? { type: 'warning', title: 'Plan approved', message: r.plannedOverlaps.join('\n'), duration: 10_000 }
      : { type: 'success', title: 'Plan approved', message: 'Its baseline is captured.' });
  };

  return (
    <button
      type="button"
      data-testid="approve-plan"
      onClick={() => { void approve(); }}
      disabled={busy}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md border transition-colors disabled:opacity-60 ${
        status === 'review'
          ? 'border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'
          : 'border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
      }`}
      title={status === 'review' ? 'An agent asked for this plan to be approved' : 'Approve this plan'}
    >
      <CheckCircle2 size={12} />
      Approve
    </button>
  );
}
