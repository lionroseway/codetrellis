import { create } from 'zustand';
import type { Plan, Task, Comment, AgentSessionInfo, Deviation } from '@shared/types';

/**
 * Which `fetchPlans` is the latest. Every plan created, imported or updated
 * anywhere refetches the list, and the answers can arrive out of order: an
 * older one landing last put back a list without a plan just created, and
 * dropped a row from under a click (the plan list moving mid-click, #224).
 */
let plansRequest = 0;

// The V1 task / phase / doc actions this store carried (task context,
// comments, attachments, progress, subtasks, phases, spec docs) had no
// caller; they were removed with the V1 task API in Phase 32 §0.4c-2.
// Plan work is V2 plan items: see plan-items-store.

interface PlanState {
  plans: Plan[];
  activePlanUid: string | null;
  activePlan: (Plan & { tasks: Task[] }) | null;
  selectedTaskUid: string | null;
  comments: Comment[];
  sessions: AgentSessionInfo[];
  deviations: Deviation[];

  /**
   * Plan scope filter — 'all' shows plans from every project,
   * otherwise a project path restricts to that project.
   * WS handlers (onPlanCreated/Updated) respect this so real-time
   * updates don't flash plans from other projects.
   */
  planScope: 'all' | string;
  setPlanScope: (scope: 'all' | string) => void;

  /**
   * Fetch all plans (unfiltered). The `projectPath` parameter is
   * accepted for backward compatibility but ignored — scope
   * filtering now happens client-side via `planScope`.
   */
  fetchPlans: (projectPath?: string) => Promise<void>;
  fetchPlan: (uid: string) => Promise<void>;
  setActivePlan: (uid: string | null) => void;
  setSelectedTask: (uid: string | null) => void;
  fetchComments: (targetUid: string) => Promise<void>;
  fetchSessions: () => Promise<void>;



  // Called by WebSocket handler
  onPlanCreated: (plan: Plan) => void;
  onPlanDeleted: (planUid: string) => void;
  onPlanUpdated: (planUid: string) => void;
  onCommentAdded: (comment: Comment) => void;

  // --- Phase 14 §B — Plan Workspace ---

  /**
   * Phase 15 §15.D — patch the plan's git context (baseRef /
   * targetBranch / targetWorktree / autoCreateBranch). Optimistic
   * apply on the active plan + plans list; WS plan-updated will
   * reconcile from authoritative state.
   */
  /** The person approves a plan: its baseline is captured and its planned overlaps said (B9.3b). */
  approvePlan: (planUid: string) => Promise<{ ok: boolean; plannedOverlaps: string[]; error?: string }>;
  updatePlanGitContext: (planUid: string, patch: Partial<Pick<Plan, 'baseRef' | 'targetBranch' | 'targetWorktree' | 'autoCreateBranch'>>) => Promise<void>;

  /** Delete a plan (archives in DB + removes disk files). */
  deletePlan: (planUid: string) => Promise<boolean>;
  /** Bulk-delete plans by UID. */
  bulkDeletePlans: (planUids: string[]) => Promise<number>;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  plans: [],
  activePlanUid: null,
  activePlan: null,
  selectedTaskUid: null,
  comments: [],
  sessions: [],
  deviations: [],
  planScope: 'all',

  setPlanScope: (scope) => {
    set({ planScope: scope });
    // Always fetch all plans — client-side filtering by scope.
    // This way the scope chip bar always knows about all projects.
    get().fetchPlans();
  },

  fetchPlans: async (_projectPath?: string) => {
    // Always fetch the full unfiltered list; scoped filtering
    // happens in the component via planScope. The _projectPath
    // parameter is kept for backward compat but ignored.
    try {
      const seq = ++plansRequest;
      const res = await fetch('/api/plans');
      const data = await res.json();
      // A newer request was sent while this one was out: its answer wins.
      if (seq !== plansRequest) return;
      // Guard: only set if we got an array (backend may return {error:…})
      if (Array.isArray(data)) {
        set({ plans: data });
      }
    } catch { /* network error — leave existing plans in place */ }
  },

  fetchPlan: async (uid) => {
    const res = await fetch(`/api/plans/${uid}`);
    if (!res.ok) {
      // Don't set garbage state — surface the error via toast and bail.
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      const { useToastStore } = await import('./toast-store');
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Could not load plan',
        message: errText || `Server returned ${res.status}`,
      });
      return;
    }
    const plan = await res.json();
    set({ activePlan: plan, activePlanUid: uid });
    get().fetchComments(uid);
  },

  setActivePlan: async (uid) => {
    if (uid) {
      await get().fetchPlan(uid);

      // If fetchPlan failed (res not ok), activePlanUid won't be set.
      // Bail out — the error toast was already shown.
      if (!get().activePlanUid) return;

      // Auto-enable projection when a plan is selected
      try {
        const { useGraphStore } = await import('./graph-store');
        if (!useGraphStore.getState().projectionEnabled) {
          useGraphStore.getState().toggleProjection();
        }
      } catch { /* ignore */ }

      // If the plan has a project path and no project is open, open it
      const plan = get().activePlan;
      if (plan?.projectPath) {
        const { useProjectStore } = await import('./project-store');
        const projectStore = useProjectStore.getState();
        if (projectStore.scanStatus === 'scanning') {
          // Already scanning, don't trigger another scan
        } else if (!projectStore.root || projectStore.root !== plan.projectPath) {
          // Open the plan's project
          let branch: string | null = null;
          try {
            const branchRes = await fetch(`/api/git/branch?path=${encodeURIComponent(plan.projectPath)}`);
            branch = (await branchRes.json()).branch;
          } catch { /* ignore */ }

          // Switch to its tab if it is already open. This always added a
          // new one, so switching between two worktrees' plans stacked up
          // duplicate tabs scanning the same directory.
          const { openWorktreeTab } = await import('../lib/plan-worktrees');
          await openWorktreeTab(plan.projectPath, branch);
        }
      }
    } else {
      set({ activePlanUid: null, activePlan: null, comments: [] });
    }
  },

  setSelectedTask: (uid) => set({ selectedTaskUid: uid }),

  fetchComments: async (targetUid) => {
    const res = await fetch(`/api/comments?target=${encodeURIComponent(targetUid)}`);
    const comments = await res.json();
    set({ comments });
  },

  fetchSessions: async () => {
    // Guard: /api/sessions can return an error body (e.g. during project
    // teardown). A non-array here would poison state and crash every
    // `sessions.filter(...)` render via the error boundary.
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      set({ sessions: Array.isArray(data) ? data : [] });
    } catch {
      set({ sessions: [] });
    }
  },











  onPlanCreated: (plan) => {
    // Optimistic prepend for instant visibility
    set((s) => {
      if (s.plans.some((p) => p.uid === plan.uid)) return s;
      return { plans: [plan, ...s.plans] };
    });
    // Full server re-fetch respecting the current plan scope filter.
    const scope = get().planScope;
    get().fetchPlans(scope === 'all' ? undefined : scope);
  },

  onPlanDeleted: (planUid) => {
    set((s) => {
      const plans = s.plans.filter((p) => p.uid !== planUid);
      // If the deleted plan is the active one, clear it
      if (s.activePlanUid === planUid) {
        return { plans, activePlan: null, activePlanUid: null, comments: [] };
      }
      return { plans };
    });
  },

  onPlanUpdated: (planUid) => {
    // Refresh the plan if it's the active one.
    // Use the current plan scope filter so we don't briefly flash
    // plans from other projects.
    const state = get();
    const scope = state.planScope;
    state.fetchPlans(scope === 'all' ? undefined : scope);
    if (state.activePlanUid === planUid) {
      state.fetchPlan(planUid);
    }
  },


  onCommentAdded: (comment) => {
    set((s) => {
      if (s.activePlanUid === comment.targetUid) {
        return { comments: [...s.comments, comment] };
      }
      return s;
    });
  },





  // --- Phase 14 §B Plan Workspace actions ---









  approvePlan: async (planUid) => {
    try {
      const res = await fetch(`/api/plans/${planUid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      const body = (await res.json().catch(() => ({}))) as { plannedOverlaps?: string[]; error?: string };
      if (!res.ok) return { ok: false, plannedOverlaps: [], error: body.error ?? `HTTP ${res.status}` };
      set((s) => ({
        plans: s.plans.map((p) => (p.uid === planUid ? { ...p, status: 'approved' } : p)),
        activePlan: s.activePlan && s.activePlan.uid === planUid ? { ...s.activePlan, status: 'approved' } : s.activePlan,
      }));
      return { ok: true, plannedOverlaps: body.plannedOverlaps ?? [] };
    } catch (err) {
      return { ok: false, plannedOverlaps: [], error: err instanceof Error ? err.message : String(err) };
    }
  },

  updatePlanGitContext: async (planUid, patch) => {
    try {
      await fetch(`/api/plans/${planUid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      set((s) => ({
        plans: s.plans.map((p) => (p.uid === planUid ? { ...p, ...patch } : p)),
        activePlan:
          s.activePlan && s.activePlan.uid === planUid
            ? { ...s.activePlan, ...patch }
            : s.activePlan,
      }));
    } catch {
      /* WS plan-updated will reconcile */
    }
  },

  deletePlan: async (planUid) => {
    try {
      const res = await fetch(`/api/plans/${planUid}`, { method: 'DELETE' });
      if (!res.ok) return false;
      // Optimistic removal (WS plan-deleted will also fire)
      get().onPlanDeleted(planUid);
      return true;
    } catch {
      return false;
    }
  },

  bulkDeletePlans: async (planUids) => {
    try {
      const res = await fetch('/api/plans/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uids: planUids }),
      });
      if (!res.ok) return 0;
      const data = await res.json();
      // Optimistic removal
      for (const uid of planUids) get().onPlanDeleted(uid);
      return data.deleted ?? 0;
    } catch {
      return 0;
    }
  },

}));
