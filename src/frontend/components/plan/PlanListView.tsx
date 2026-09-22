import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { ClipboardList, Plus, FolderInput, Layers, Trash2, Search, X, CheckSquare, Square, AlertTriangle, RefreshCw, FolderOpen } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';
import { StatusBadge } from './StatusBadge';
import { CrossRepoSection } from './CrossRepoSection';
import { OtherWorktreesSection } from './OtherWorktreesSection';
import { PlanTemplatePicker } from './PlanTemplatePicker';

interface OrphanedPlanDir {
  dirPath: string;
  dirName: string;
  uidPrefix: string | null;
  title: string | null;
}

interface ReconcileState {
  orphanedOnDisk: OrphanedPlanDir[];
  orphanedInDb: Array<{ uid: string; title: string; status: string }>;
  totalDisk: number;
  totalDb: number;
}

export function PlanList() {
  const plans = usePlanStore((s) => s.plans);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const deletePlan = usePlanStore((s) => s.deletePlan);
  const bulkDeletePlans = usePlanStore((s) => s.bulkDeletePlans);
  const planScope = usePlanStore((s) => s.planScope);
  const setPlanScope = usePlanStore((s) => s.setPlanScope);
  const root = useProjectStore((s) => s.root);
  const tabs = useProjectStore((s) => s.tabs);
  const addToast = useToastStore((s) => s.addToast);
  const [discovered, setDiscovered] = useState<string[] | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ uid: string; title: string } | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [reconcile, setReconcile] = useState<ReconcileState | null>(null);
  const [showReconcile, setShowReconcile] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [confirmPrune, setConfirmPrune] = useState(false);
  // Phase 29 §4.10 — this button used to fire a "coming soon" toast
  // while mobile had shipped the same picker two phases earlier.
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  // CDev Phase 3.6 — soften the "no plans" nudge when the repo
  // declares repoRole: "code" in its project config (plans live
  // elsewhere in this deployment).
  const [repoRole, setRepoRole] = useState<'planning' | 'code' | 'mixed' | null>(null);

  // Track the previous root so we can auto-switch scope when the user
  // changes project tabs (only if scope was tracking the old project).
  const prevRootRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevRootRef.current;
    prevRootRef.current = root;
    if (root && root !== prev) {
      // User switched tabs or first project opened.
      if (planScope === 'all') {
        // Default to the active project (first open, or user
        // was on "all" and a new project appeared)
        setPlanScope(root);
      } else if (prev && planScope === prev) {
        // Was tracking the old project — follow the tab switch
        setPlanScope(root);
      }
      // else: user manually chose a different project, leave it
    } else if (!root && prev) {
      // All tabs closed — fall back to all
      setPlanScope('all');
    }
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch all plans on mount (client-side filtering by planScope)
  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  // Derive a short project name from a path for display
  const projectName = useCallback((path: string) => {
    return path.split('/').pop() || path;
  }, []);

  // Derive unique project paths from the plans list + open tabs
  // for the scope filter chips.
  const projectChips = useMemo(() => {
    const paths = new Set<string>();
    for (const p of plans) {
      if (p.projectPath) paths.add(p.projectPath);
    }
    for (const t of tabs) {
      paths.add(t.root);
    }
    return [...paths].sort().map((path) => ({
      path,
      name: path.split('/').pop() || path,
    }));
  }, [plans, tabs]);

  // Phase 13 §A: discover plan directories committed in the project's
  // `.codetrellis/plans/` so the user can one-click import them.
  useEffect(() => {
    if (!root) { setDiscovered(null); return; }
    fetch(`/api/plans/discover?project=${encodeURIComponent(root)}`)
      .then((r) => r.json())
      .then((dirs) => setDiscovered(Array.isArray(dirs) ? dirs : []))
      .catch(() => setDiscovered([]));
  }, [root, plans.length]);

  // CDev Phase 3.6 — fetch the project's repoRole so the empty
  // state can shift from "create your first plan" to "plans live
  // in the planning repo" when this is a code-only repo.
  useEffect(() => {
    if (!root) { setRepoRole(null); return; }
    fetch(`/api/project-config?project=${encodeURIComponent(root)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => setRepoRole(cfg?.repoRole ?? null))
      .catch(() => setRepoRole(null));
  }, [root]);

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
      await fetchPlans();
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

  // Fetch reconciliation status (DB vs disk)
  const fetchReconcile = useCallback(async () => {
    if (!root) return;
    try {
      const res = await fetch(`/api/plans/reconcile?project=${encodeURIComponent(root)}`);
      if (res.ok) {
        const data = await res.json();
        setReconcile(data);
      }
    } catch { /* silent */ }
  }, [root]);

  useEffect(() => {
    fetchReconcile();
  }, [fetchReconcile, plans.length]);

  const handlePruneOrphans = useCallback(async () => {
    if (!reconcile || reconcile.orphanedOnDisk.length === 0) return;
    setPruning(true);
    try {
      const dirPaths = reconcile.orphanedOnDisk.map((o) => o.dirPath);
      const res = await fetch('/api/plans/prune-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPaths }),
      });
      if (res.ok) {
        const data = await res.json();
        addToast({ type: 'success', title: `Pruned ${data.removed} orphaned directories`, message: 'Disk is clean.' });
        await fetchReconcile();
      } else {
        addToast({ type: 'error', title: 'Prune failed', message: 'Could not remove orphaned directories.' });
      }
    } catch {
      addToast({ type: 'error', title: 'Prune failed', message: 'Network error.' });
    } finally {
      setPruning(false);
      setConfirmPrune(false);
    }
  }, [reconcile, addToast, fetchReconcile]);

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
      await fetchPlans();
      await setActivePlan(plan.uid);
    } catch (err) {
      addToast({ type: 'error', title: 'Could not create plan', message: String(err) });
    }
  };

  // Filter plans by project scope + search query
  const filteredPlans = useMemo(() => {
    let result = plans;
    // Apply project scope filter
    if (planScope !== 'all') {
      result = result.filter((p) => p.projectPath === planScope);
    }
    // Apply text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q) ||
        p.uid.toLowerCase().includes(q)
      );
    }
    // The active plan leads the list. With a plan open, the pane used to
    // read as a flat list with one faintly tinted row somewhere in it.
    return [...result].sort((a, b) => Number(b.uid === activePlanUid) - Number(a.uid === activePlanUid));
  }, [plans, planScope, searchQuery, activePlanUid]);

  // The active plan can be filtered out (another project's scope, or a
  // search). Pin it anyway, so switching away from it stays one click.
  const activePlanHidden = activePlanUid != null
    && plans.some((p) => p.uid === activePlanUid)
    && !filteredPlans.some((p) => p.uid === activePlanUid);
  const activePlanRow = activePlanHidden ? plans.find((p) => p.uid === activePlanUid) : undefined;

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
            onClick={() => setShowTemplatePicker(true)}
            className="flex items-center gap-1 px-2 py-1.5 text-[12.5px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
            title="New plan from template"
          >
            <Layers size={12} />
          </button>
        </div>
      </div>

      {/* Project scope filter — shown when plans span multiple projects */}
      {projectChips.length > 1 && (
        <div className="flex items-center gap-1 px-1.5 mb-2 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setPlanScope('all')}
            className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11.5px] rounded-md border transition-colors ${
              planScope === 'all'
                ? 'bg-accent/10 border-accent/30 text-accent font-medium'
                : 'border-white/[0.06] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
            }`}
          >
            All projects
          </button>
          {projectChips.map((chip) => (
            <button
              key={chip.path}
              onClick={() => setPlanScope(chip.path)}
              className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11.5px] rounded-md border transition-colors truncate max-w-[160px] ${
                planScope === chip.path
                  ? 'bg-accent/10 border-accent/30 text-accent font-medium'
                  : 'border-white/[0.06] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
              }`}
              title={chip.path}
            >
              <FolderOpen size={11} className="shrink-0" />
              {chip.name}
            </button>
          ))}
        </div>
      )}

      {/* DB ↔ disk reconciliation status */}
      {reconcile && reconcile.orphanedOnDisk.length > 0 && (
        <div className="mx-1.5 mb-2">
          <button
            onClick={() => setShowReconcile(!showReconcile)}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-lg bg-amber-500/[0.06] border border-amber-300/15 hover:bg-amber-500/[0.1] transition-colors"
          >
            <AlertTriangle size={13} className="text-amber-400 shrink-0" />
            <span className="text-[12px] text-amber-200 flex-1">
              {reconcile.orphanedOnDisk.length} orphaned dir{reconcile.orphanedOnDisk.length === 1 ? '' : 's'} on disk
            </span>
            <span className="text-[11px] text-amber-300/60">
              {showReconcile ? 'Hide' : 'Details'}
            </span>
          </button>
          {showReconcile && (
            <div className="mt-1.5 rounded-lg border border-amber-300/10 bg-amber-500/[0.03] px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-3 text-[11px] text-foreground-muted">
                <span>{reconcile.totalDb} in DB</span>
                <span className="text-foreground-muted/30">|</span>
                <span>{reconcile.totalDisk} on disk</span>
                <button onClick={fetchReconcile} className="ml-auto text-foreground-muted hover:text-foreground transition-colors" title="Refresh">
                  <RefreshCw size={11} />
                </button>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {reconcile.orphanedOnDisk.map((o) => (
                  <div key={o.dirPath} className="flex items-center gap-2 text-[11.5px]">
                    <span className="text-amber-300/70 font-mono truncate flex-1" title={o.dirPath}>
                      {o.title || o.dirName}
                    </span>
                    <span className="text-foreground-muted/50 shrink-0 text-[10px]">disk only</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setConfirmPrune(true)}
                disabled={pruning}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11.5px] rounded-md bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
              >
                <Trash2 size={11} />
                {pruning ? 'Pruning...' : `Prune ${reconcile.orphanedOnDisk.length} orphaned directories`}
              </button>
            </div>
          )}
        </div>
      )}

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

      {plans.length === 0 && unimportedDirs.length === 0 && repoRole !== 'code' && (
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

      {/* CDev Phase 3.6 — code repos that delegate planning elsewhere
          get the softer copy. Pointers (rendered by CrossRepoSection)
          point at the planning repo; we don't push "create your first
          plan" here because that's not how the team works. */}
      {plans.length === 0 && unimportedDirs.length === 0 && repoRole === 'code' && (
        <div className="flex flex-col items-center gap-3 py-7 text-foreground-subtle text-[13px] rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015]">
          <ClipboardList size={22} />
          <div className="text-center space-y-1.5 px-4">
            <p className="text-foreground text-[13.5px] font-medium">No local plans</p>
            <p className="text-[12px] text-foreground-muted leading-relaxed max-w-sm">
              This repo declares <code className="font-mono bg-white/[0.06] px-1 rounded">repoRole: "code"</code> —
              plans live in another repo and reach this one via pointer files.
              Look for cross-repo plans below; open the planning repo to author new work.
            </p>
          </div>
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

      {activePlanRow && (
        <button
          onClick={() => setActivePlan(activePlanRow.uid)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/30 text-left"
          title="The open plan, outside the current filter"
          data-testid="pinned-active-plan"
        >
          <span className="text-[10px] uppercase tracking-wider text-accent shrink-0">Open</span>
          <span className="text-[13px] font-medium text-foreground truncate flex-1">{activePlanRow.title}</span>
          <span className="text-[10.5px] text-foreground-muted/60 truncate max-w-[30%]">{projectName(activePlanRow.projectPath)}</span>
          <StatusBadge status={activePlanRow.status} />
        </button>
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
                <span className="text-[13px] font-medium text-foreground truncate block">
                  {activePlanUid === plan.uid && (
                    <span className="mr-1.5 text-[10px] uppercase tracking-wider text-accent align-middle">Open</span>
                  )}
                  {plan.title}
                </span>
                {planScope === 'all' && plan.projectPath && (
                  <span className="text-[10.5px] text-foreground-muted/60 truncate block mt-0.5">
                    {projectName(plan.projectPath)}
                  </span>
                )}
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

      {/* Plans on this repo's other worktrees (other branches). Only when
          scoped to this checkout: under "All projects" they are already
          in the list above. */}
      {planScope !== 'all' && <OtherWorktreesSection />}

      {/* CDev Phase 3.5 — cross-repo pointers under the local plans list. */}
      <CrossRepoSection />

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

      {/* Prune orphans confirm dialog */}
      {confirmPrune && reconcile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConfirmPrune(false)}>
          <div className="bg-[#0d1117] border border-white/[0.1] rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-foreground mb-2">Prune orphaned directories?</h3>
            <p className="text-[12px] text-foreground-muted mb-2 leading-relaxed">
              This removes {reconcile.orphanedOnDisk.length} plan director{reconcile.orphanedOnDisk.length === 1 ? 'y' : 'ies'} from <code className="font-mono bg-white/[0.05] px-1 rounded">.codetrellis/plans/</code> that have no matching plan in the database.
            </p>
            <p className="text-[11px] text-amber-300/70 mb-4">
              These directories can be re-created by exporting their plans. If a plan was deleted from the DB, this cleans up its leftover files.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmPrune(false)}
                className="px-3 py-1.5 text-[12.5px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePruneOrphans}
                disabled={pruning}
                className="px-3 py-1.5 text-[12.5px] rounded-md bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border border-amber-300/15 disabled:opacity-50 transition-colors"
              >
                {pruning ? 'Pruning...' : `Prune ${reconcile.orphanedOnDisk.length} directories`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 29 §4.10 — new plan from a built-in, project or user
          template. Project and user templates live on disk and had no
          desktop surface at all before this. */}
      {showTemplatePicker && (
        <PlanTemplatePicker onClose={() => setShowTemplatePicker(false)} />
      )}
    </div>
  );
}
