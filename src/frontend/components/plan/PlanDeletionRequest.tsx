/**
 * An agent asked to delete plans; the person decides.
 *
 * Plan deletion left MCP in Phase 32 §0.4c-3 (owner's decision). Deleting
 * a plan removes its files from the repo's `.codetrellis/plans/`, which
 * teammates share through git, so an agent may only ask
 * (`request_plan_deletion`). This is where the asking lands: the plans,
 * the agent's reason, and a Delete button that stays disabled until the
 * person types the plan's name (or "delete N plans" for several). Nothing
 * here runs without that; cancelling leaves every plan as it was.
 */

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useToastStore } from '../../stores/toast-store';

interface DeletionRequest {
  requestId: string;
  plans: Array<{ uid: string; title: string }>;
  reason: string;
}

/** The event `useWebSocket` dispatches for a `ui-confirm-plan-deletion` broadcast. */
export const PLAN_DELETION_REQUEST_EVENT = 'plan-deletion-request';

export function PlanDeletionRequest() {
  const [request, setRequest] = useState<DeletionRequest | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const headingId = useId();
  const inputId = useId();

  useEffect(() => {
    const onRequest = (e: Event) => {
      const detail = (e as CustomEvent<DeletionRequest>).detail;
      if (!detail || !Array.isArray(detail.plans) || detail.plans.length === 0) return;
      setRequest(detail);
      setTyped('');
    };
    window.addEventListener(PLAN_DELETION_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(PLAN_DELETION_REQUEST_EVENT, onRequest);
  }, []);

  if (!request) return null;

  const count = request.plans.length;
  const phrase = count === 1 ? request.plans[0].title : `delete ${count} plans`;
  const confirmed = typed.trim() === phrase;
  const close = () => { setRequest(null); setTyped(''); };

  const onDelete = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    const deletePlan = usePlanStore.getState().deletePlan;
    let deleted = 0;
    for (const plan of request.plans) {
      if (await deletePlan(plan.uid)) deleted++;
    }
    setBusy(false);
    close();
    addToast(deleted === count
      ? { type: 'success', title: count === 1 ? 'Plan deleted' : `${count} plans deleted`, message: 'Archived, and their files removed from .codetrellis/plans/.' }
      : { type: 'error', title: 'Some plans were not deleted', message: `${deleted} of ${count} deleted.` });
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="plan-deletion-request"
        className="bg-[#0d1117] border border-red-300/15 rounded-xl p-5 max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={headingId} className="flex items-center gap-2 text-[15px] font-semibold text-foreground mb-2">
          <Trash2 size={14} className="text-red-300" />
          An agent asked to delete {count === 1 ? 'a plan' : `${count} plans`}
        </h3>
        {request.reason && (
          <blockquote className="text-[12.5px] text-foreground-muted border-l-2 border-white/10 pl-3 mb-3 leading-relaxed">
            {request.reason}
          </blockquote>
        )}
        <ul className="mb-3 space-y-1">
          {request.plans.map((p) => (
            <li key={p.uid} className="text-[12.5px] font-medium text-foreground truncate">{p.title}</li>
          ))}
        </ul>
        <p className="text-[12px] text-foreground-muted mb-3 leading-relaxed">
          Deleting archives {count === 1 ? 'the plan' : 'them'} and removes {count === 1 ? 'its' : 'their'} files
          from <code className="font-mono bg-white/[0.05] px-1 rounded">.codetrellis/plans/</code>, which your team sees through git.
        </p>
        <label htmlFor={inputId} className="block text-[11.5px] text-foreground-muted mb-1">
          Type <span className="font-mono text-foreground">{phrase}</span> to delete
        </label>
        <input
          id={inputId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void onDelete(); if (e.key === 'Escape') close(); }}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-2 text-[12.5px] text-foreground focus:outline-none focus:border-red-300/40 mb-4"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={close}
            className="px-3 py-1.5 text-[12.5px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
          >
            Keep {count === 1 ? 'it' : 'them'}
          </button>
          <button
            onClick={() => void onDelete()}
            disabled={!confirmed || busy}
            className="px-3 py-1.5 text-[12.5px] rounded-md bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-300/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
