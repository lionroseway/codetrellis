import { useCallback, useEffect, useState } from 'react';
import { HardDrive, Users, Loader2 } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import { useToastStore } from '../../../stores/toast-store';
import type { Plan } from '@shared/types';

/**
 * Phase 29 §4.14 — is this plan shared, or only on this machine?
 *
 * `plan-file-service` calls it "the Shared → Local toggle": a plan
 * either has a directory under `<project>/.codetrellis/plans/<slug>/`
 * — which goes into git and reaches the rest of the team — or it lives
 * only in the local database. Three endpoints implement it and none of
 * them had a caller:
 *
 *   GET  /api/plans/:uid/file-status  → { linked, planDir }
 *   POST /api/plans/:uid/export       → write the directory
 *   POST /api/plans/:uid/unlink       → remove it (DB rows survive)
 *
 * `useWebSocket` has had handlers for `plan-exported` and
 * `plan-unlinked` the whole time, so the client was ready to react to
 * events that nothing could cause.
 *
 * The register described `file-status` as "a file's standing against a
 * plan". It is not that — it reports whether the *plan* is on disk.
 *
 * Wording note: "Shared" and "Local" are the words the service uses,
 * and they say the consequence rather than the mechanism. "Exported"
 * would describe what the button does; "Shared" describes what changes
 * for the user, which is the thing worth putting in a chip.
 */
export function PlanSyncChip({ plan }: { plan: Plan }) {
  const root = useProjectStore((s) => s.root);
  const addToast = useToastStore((s) => s.addToast);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [planDir, setPlanDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!root) { setLinked(null); return; }
    try {
      const res = await fetch(
        `/api/plans/${plan.uid}/file-status?path=${encodeURIComponent(root)}`,
      );
      if (!res.ok) return;
      const data = await res.json() as { linked: boolean; planDir: string | null };
      setLinked(data.linked);
      setPlanDir(data.planDir);
    } catch { /* an unknown answer renders nothing, which is the honest state */ }
  }, [plan.uid, root]);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async () => {
    if (!root || linked === null) return;
    setBusy(true);
    try {
      const path = linked
        ? `/api/plans/${plan.uid}/unlink?path=${encodeURIComponent(root)}`
        : `/api/plans/${plan.uid}/export?path=${encodeURIComponent(root)}`;
      const res = await fetch(path, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      // The answer says where the plan now lives, so say it now. This
      // waited on a second request to re-read the status, and a scan
      // holding the backend kept a plan that was already shared reading
      // "Local", disabled, for as long as the scan took. The re-read
      // still runs, to confirm, but nothing waits on it.
      setLinked(!linked);
      setPlanDir(linked ? null : data?.planDir ?? null);
      addToast(
        linked
          ? {
              type: 'info',
              title: 'Plan is now local',
              message: 'Removed from .codetrellis/plans/. The plan itself is untouched.',
            }
          : {
              type: 'success',
              title: 'Plan is now shared',
              message: `Written to ${data?.planDir ?? '.codetrellis/plans/'} — commit it to share.`,
            },
      );
      void load();
    } catch (err) {
      addToast({
        type: 'error',
        title: linked ? 'Could not unlink' : 'Could not share',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [root, linked, plan.uid, addToast, load]);

  // No project open, or the status never came back — say nothing rather
  // than guess. A chip reading "Local" when we do not know would be a
  // claim about where the user's work lives.
  if (!root || linked === null) return null;

  const Icon = busy ? Loader2 : linked ? Users : HardDrive;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={
        linked
          ? `Shared — written to ${planDir ?? '.codetrellis/plans/'}. Click to keep it on this machine only.`
          : 'Local — this plan is in the database only. Click to write it into .codetrellis/plans/ so it can be committed.'
      }
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12.5px] transition-colors disabled:opacity-50 ${
        linked
          ? 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300 hover:bg-emerald-500/[0.12]'
          : 'border-white/[0.08] bg-white/[0.02] text-foreground-subtle hover:text-foreground hover:bg-white/[0.04]'
      }`}
    >
      <Icon size={11} className={busy ? 'animate-spin' : ''} />
      {linked ? 'Shared' : 'Local'}
    </button>
  );
}
