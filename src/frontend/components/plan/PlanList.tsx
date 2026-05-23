import { useEffect, useState, useMemo, useCallback } from 'react';
import { ClipboardList, Plus, FolderInput, Layers, Trash2, Search, X, CheckSquare, Square } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';
import { StatusBadge } from './StatusBadge';

export function PlanList() {
  const plans = usePlanStore((s) => s.plans);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const deletePlan = usePlanStore((s) => s.deletePlan);
  const bulkDeletePlans = usePlanStore((s) => s.bulkDeletePlans);
  const root = useProjectStore((s) => s.root);
  const addToast = useToastStore((s) => s.addToast);
  const [discovered, setDiscovered] = useState<string[] | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ uid: string; title: string } | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  useEffect(() => {
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

  const unimportedDirs = (discovered ?? []).filter((d) => {
    const slug = d.split('/').pop() || '';
    const parts = slug.split('-');
    const uidPrefix = parts[parts.length - 1] || '';
    if (!uidPrefix) return true;
    return !plans.some((p) => p.uid.startsWith(uidPrefix));
  });

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

  // Filter plans by search query
  const filteredPlans = useMemo(() => {
    if (!searchQuery.trim()) return plans;
    const q = searchQuery.toLowerCase();
    return plans.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q) ||
      p.uid.toLowerCase().includes(q)
    );
  }, [plans, searchQuery]);

  const handleDeleteSingle = useCallback(async (uid: string) => {
    const ok = await deletePlan(uid);
    if (ok) {
      addToast({ type: 'success', title: 'Plan deleted', message: 'Plan archived and disk files removed.' });
    } else {
      addToast({ type: 'error', title: 'Delete failed', message: 'Could not delete the plan.' });
    }
    setConfirmDelete(null);
    setSelectedUids((s) => { const next = new Set(s); next.delete(uid); return next; });
  }, [deletePlan, addToast]);

  const handleBulkDelete = useCallback(async () => {
    const uids = [...selectedUids];
    const count = await bulkDeletePlans(uids);
    addToast({ type: 'success', title: `Deleted ${count} plans`, message: 'Plans archived and disk files removed.' });
    setSelectedUids(new Set());
    setConfirmBulk(false);
  }, [selectedUids, bulkDeletePlans, addToast]);

  const toggleSelect = (uid: string) => {
    setSelectedUids((s) => {
      const next = new Set(s);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedUids.size === filteredPlans.length) {
      setSelectedUids(new Set());
    } else {
      setSelectedUids(new Set(filteredPlans.map((p) => p.uid)));
    }
  };

  const isMultiSelect = selectedUids.size > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1.5 mb-2.5">
        <span className="text-[12px] text-foreground-subtle uppercase tracking-wider font-medium">
          Plans ({plans.length})
        </span>
        <div className="flex items-center gap-1">
          {plans.length > 5 && (
            <button
              onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery(''); }}
              className="flex items-center justify-center w-7 h-7 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
              title="Search plans"
            >
              <Search size={13} />
            </button>
          )}
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

      {/* Search bar */}
      {showSearch && (
        <div className="relative px-1.5 mb-2">
          <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter plans..."
            className="w-full pl-8 pr-8 py-1.5 text-[12.5px] rounded-md bg-white/[0.04] border border-white/[0.08] text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-accent/40"
            autoFocus
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Multi-select toolbar */}
      {isMultiSelect && (
        <div className="flex items-center gap-2 px-2 py-1.5 mx-1.5 mb-1.5 rounded-md bg-red-500/[0.06] border border-red-300/15">
          <button onClick={selectAll} className="text-[11px] text-foreground-muted hover:text-foreground">
            {selectedUids.size === filteredPlans.length ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-[11px] text-foreground-muted flex-1">{selectedUids.size} selected</span>
          <button
            onClick={() => setConfirmBulk(true)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-red-500/20 text-red-200 hover:bg-red-500/30 transition-colors"
          >
            <Trash2 size={11} />
            Delete selected
          </button>
          <button
            onClick={() => setSelectedUids(new Set())}
            className="text-[11px] text-foreground-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

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
                  {isImporting ? 'Importing...' : 'Import'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {filteredPlans.map((plan) => {
        const progress = plan.taskCount ? Math.round(((plan.completedTaskCount || 0) / plan.taskCount) * 100) : 0;
        const isSelected = selectedUids.has(plan.uid);
        return (
          <div
            key={plan.uid}
            className={`group relative w-full text-left px-3 py-2.5 rounded-lg transition-all ${
              activePlanUid === plan.uid
                ? 'bg-accent/10 border border-accent/30'
                : isSelected
                  ? 'bg-red-500/[0.04] border border-red-300/20'
                  : 'hover:bg-surface-hover hover:border-accent/20 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2">
              {/* Multi-select checkbox (visible when any selected, or on hover) */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleSelect(plan.uid); }}
                className={`shrink-0 transition-opacity ${isMultiSelect ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
                title={isSelected ? 'Deselect' : 'Select for bulk action'}
              >
                {isSelected
                  ? <CheckSquare size={14} className="text-red-300" />
                  : <Square size={14} className="text-foreground-muted" />
                }
              </button>
              <button
                onClick={() => setActivePlan(plan.uid)}
                className="flex-1 min-w-0 text-left"
                title="Click to open the plan workspace"
              >
                <span className="text-[13px] font-medium text-foreground truncate block">{plan.title}</span>
              </button>
              <StatusBadge status={plan.status} />
              {/* Delete button — visible on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete({ uid: plan.uid, title: plan.title });
                }}
                className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-foreground-muted hover:text-red-300"
                title="Delete this plan"
              >
                <Trash2 size={13} />
              </button>
              <span className="text-[10.5px] text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                Open
              </span>
            </div>
            {plan.taskCount != null && plan.taskCount > 0 && (
              <div className="mt-2 flex items-center gap-2 ml-6">
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className="h-full bg-accent/60 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-[10.5px] text-foreground-subtle shrink-0">
                  {plan.completedTaskCount || 0}/{plan.taskCount}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* Search results info */}
      {searchQuery && filteredPlans.length !== plans.length && (
        <div className="px-3 py-1.5 text-[11px] text-foreground-muted">
          Showing {filteredPlans.length} of {plans.length} plans
        </div>
      )}

      {/* Single delete confirm dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)}>
          <div className="bg-[#0d1117] border border-white/[0.1] rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-foreground mb-2">Delete plan?</h3>
            <p className="text-[13px] text-foreground-muted mb-1">
              <span className="font-medium text-foreground">"{confirmDelete.title}"</span>
            </p>
            <p className="text-[12px] text-foreground-muted mb-4 leading-relaxed">
              This archives the plan in the database and removes its files from <code className="font-mono bg-white/[0.05] px-1 rounded">.codetrellis/plans/</code>. The plan won't appear in the list.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 text-[12.5px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteSingle(confirmDelete.uid)}
                className="px-3 py-1.5 text-[12.5px] rounded-md bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-300/15 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirm dialog */}
      {confirmBulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConfirmBulk(false)}>
          <div className="bg-[#0d1117] border border-white/[0.1] rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-foreground mb-2">Delete {selectedUids.size} plans?</h3>
            <p className="text-[12px] text-foreground-muted mb-4 leading-relaxed">
              This archives {selectedUids.size} plans and removes their disk files. They won't appear in the list.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmBulk(false)}
                className="px-3 py-1.5 text-[12.5px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-3 py-1.5 text-[12.5px] rounded-md bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-300/15 transition-colors"
              >
                Delete {selectedUids.size} plans
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
