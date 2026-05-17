import { useEffect, useState } from 'react';
import { ClipboardList, Plus, FolderInput, Layers } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';
import { StatusBadge } from './StatusBadge';

export function PlanList() {
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

  // Quick-create: makes a blank "Untitled plan" via REST and immediately
  // opens the workspace so the user can start typing.
  const handleQuickCreate = async () => {
    if (!root) {
      addToast({ type: 'error', title: 'No project open', message: 'Open a project first to create a plan.' });
      return;
    }
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Untitled plan',
          description: '',
          projectPath: root,
          tasks: [],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const plan = await res.json();
      await fetchPlans(root);
      await setActivePlan(plan.uid);
    } catch (err) {
      addToast({ type: 'error', title: 'Could not create plan', message: String(err) });
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1.5 mb-2.5">
        <span className="text-[12px] text-foreground-subtle uppercase tracking-wider font-medium">
          Plans ({plans.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleQuickCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-md bg-accent text-white hover:bg-accent-hover transition-colors shadow-[0_0_10px_rgba(59,130,246,0.2)]"
            title="Create a blank plan and start typing (no modal)"
          >
            <Plus size={13} />
            New plan
          </button>
          <button
            onClick={() => addToast({ type: 'info', title: 'Templates', message: 'Template picker coming soon — use MCP create_plan_from_template for now.' })}
            className="flex items-center gap-1 px-2 py-1.5 text-[12.5px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
            title="Create from template"
          >
            <Layers size={12} />
          </button>
        </div>
      </div>

      {plans.length === 0 && unimportedDirs.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-9 text-foreground-subtle text-[13px] rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015]">
          <ClipboardList size={26} />
          <div className="text-center space-y-1.5 px-4">
            <p className="text-foreground text-[14px] font-medium">No plans yet</p>
            <p className="text-[12.5px] text-foreground-muted leading-relaxed max-w-xs">
              A plan is your spec for a piece of work — phases, tasks, context docs, and progress.
              Click a plan to open the full workspace.
            </p>
          </div>
          <button
            onClick={handleQuickCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] rounded-md bg-accent text-white hover:bg-accent-hover transition-colors shadow-[0_0_10px_rgba(59,130,246,0.2)]"
          >
            <Plus size={13} /> Create your first plan
          </button>
        </div>
      )}

      {unimportedDirs.length > 0 && (
        <div className="mb-2.5 rounded-lg border border-dashed border-accent/25 bg-accent/[0.04] px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-2 text-[12px] text-accent uppercase tracking-wider font-medium">
            <FolderInput size={13} />
            Found {unimportedDirs.length} plan{unimportedDirs.length === 1 ? '' : 's'} on disk
          </div>
          <p className="text-[12px] text-foreground-muted leading-relaxed">
            These plans live in this project's <code className="font-mono bg-white/[0.05] px-1.5 rounded">.codetrellis/plans/</code> but aren't loaded yet. Import to bring them into your local DB.
          </p>
          {unimportedDirs.map((dir) => {
            const slug = dir.split('/').pop() || dir;
            const isImporting = importing === dir;
            return (
              <button
                key={dir}
                onClick={() => handleImport(dir)}
                disabled={isImporting}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-md bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-accent/30 disabled:opacity-50 transition-colors"
              >
                <FolderInput size={13} className="text-accent shrink-0" />
                <span className="text-[12.5px] font-mono text-foreground truncate flex-1">{slug}</span>
                <span className="text-[11.5px] text-accent shrink-0">
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
            title="Click to open the plan workspace (Spec / Tasks / Activity)"
            className={`group w-full text-left px-3 py-2.5 rounded-lg transition-all ${
              activePlanUid === plan.uid
                ? 'bg-accent/10 border border-accent/30'
                : 'hover:bg-surface-hover hover:border-accent/20 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-foreground truncate flex-1">{plan.title}</span>
              <StatusBadge status={plan.status} />
              <span className="text-[10.5px] text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                Open →
              </span>
            </div>
            {plan.taskCount != null && plan.taskCount > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className="h-full bg-accent/60 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-[10.5px] text-foreground-subtle shrink-0">
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
