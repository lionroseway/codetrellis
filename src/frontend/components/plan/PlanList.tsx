import { useEffect, useState } from 'react';
import { ClipboardList, Plus, FolderInput } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';
import { StatusBadge } from './StatusBadge';

export function PlanList({ onCreateClick }: { onCreateClick: () => void }) {
  const plans = usePlanStore((s) => s.plans);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const root = useProjectStore((s) => s.root);
  const addToast = useToastStore((s) => s.addToast);
  const [discovered, setDiscovered] = useState<string[] | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    // Fetch all plans (filtered by project if one is open)
    fetchPlans(root || undefined);
  }, [root, fetchPlans]);

  // Phase 13 §A: discover plan directories committed in the project's
  // `.codetrellis/plans/` so the user can one-click import them.
  useEffect(() => {
    if (!root) { setDiscovered(null); return; }
    fetch(`/api/plans/discover?project=${encodeURIComponent(root)}`)
      .then((r) => r.json())
      .then((dirs) => setDiscovered(Array.isArray(dirs) ? dirs : []))
      .catch(() => setDiscovered([]));
  }, [root, plans.length]);

  const handleImport = async (planDir: string) => {
    setImporting(planDir);
    try {
      const res = await fetch(`/api/plans/import?path=${encodeURIComponent(planDir)}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Import failed');
      const w = data.warnings?.length ? ` (${data.warnings.length} warnings)` : '';
      addToast({
        type: 'success',
        title: 'Plan imported',
        message: `${data.plan.title} — ${data.tasks.length} tasks, ${data.docs.length} docs${w}`,
        duration: 6000,
      });
      await fetchPlans(root || undefined);
      setActivePlan(data.plan.uid);
    } catch (err) {
      addToast({ type: 'error', title: 'Import failed', message: String(err) });
    } finally {
      setImporting(null);
    }
  };

  // Plans we've discovered on disk whose slug-uid prefix doesn't match
  // any currently-loaded plan. The slug encodes an 8-char UID suffix
  // (see plan-file-service.makePlanSlug); cheap heuristic to avoid
  // showing "import" for plans the DB already knows about.
  const unimportedDirs = (discovered ?? []).filter((d) => {
    const slug = d.split('/').pop() || '';
    const parts = slug.split('-');
    const uidPrefix = parts[parts.length - 1] || '';
    if (!uidPrefix) return true;
    return !plans.some((p) => p.uid.startsWith(uidPrefix));
  });

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">
          Plans ({plans.length})
        </span>
        <button
          onClick={onCreateClick}
          className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover transition-colors"
        >
          <Plus size={10} />
          New
        </button>
      </div>

      {plans.length === 0 && unimportedDirs.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-foreground-subtle text-[11px]">
          <ClipboardList size={18} />
          <span>No plans yet</span>
          <button onClick={onCreateClick} className="text-accent hover:underline text-[10px]">Create one</button>
        </div>
      )}

      {unimportedDirs.length > 0 && (
        <div className="mb-2 rounded-lg border border-dashed border-accent/25 bg-accent/[0.04] px-2.5 py-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-accent uppercase tracking-wider font-medium">
            <FolderInput size={11} />
            Found {unimportedDirs.length} plan{unimportedDirs.length === 1 ? '' : 's'} on disk
          </div>
          <p className="text-[10px] text-foreground-muted leading-relaxed">
            These plans live in this project's <code className="font-mono bg-white/[0.05] px-1 rounded">.codetrellis/plans/</code> but aren't loaded yet. Import to bring them into your local DB.
          </p>
          {unimportedDirs.map((dir) => {
            const slug = dir.split('/').pop() || dir;
            const isImporting = importing === dir;
            return (
              <button
                key={dir}
                onClick={() => handleImport(dir)}
                disabled={isImporting}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-md bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-accent/30 disabled:opacity-50 transition-colors"
              >
                <FolderInput size={11} className="text-accent shrink-0" />
                <span className="text-[10.5px] font-mono text-foreground truncate flex-1">{slug}</span>
                <span className="text-[9.5px] text-accent shrink-0">
                  {isImporting ? 'Importing…' : 'Import'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {plans.map((plan) => {
        const progress = plan.taskCount ? Math.round(((plan.completedTaskCount || 0) / plan.taskCount) * 100) : 0;
        return (
          <button
            key={plan.uid}
            onClick={() => setActivePlan(plan.uid)}
            className={`w-full text-left px-2.5 py-2 rounded-lg transition-all ${
              activePlanUid === plan.uid
                ? 'bg-accent/10 border border-accent/20'
                : 'hover:bg-surface-hover border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-foreground truncate flex-1">{plan.title}</span>
              <StatusBadge status={plan.status} />
            </div>
            {plan.taskCount != null && plan.taskCount > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className="h-full bg-accent/60 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-[9px] text-foreground-subtle shrink-0">
                  {plan.completedTaskCount || 0}/{plan.taskCount}
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
