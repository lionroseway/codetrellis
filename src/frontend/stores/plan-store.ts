import { create } from 'zustand';
import type { Plan, Task, Comment, AgentSessionInfo, Deviation } from '@shared/types';

interface PlanState {
  plans: Plan[];
  activePlanUid: string | null;
  activePlan: (Plan & { tasks: Task[] }) | null;
  selectedTaskUid: string | null;
  comments: Comment[];
  sessions: AgentSessionInfo[];
  deviations: Deviation[];

  fetchPlans: (projectPath?: string) => Promise<void>;
  fetchPlan: (uid: string) => Promise<void>;
  setActivePlan: (uid: string | null) => void;
  setSelectedTask: (uid: string | null) => void;
  fetchComments: (targetUid: string) => Promise<void>;
  fetchSessions: () => Promise<void>;

  // Called by WebSocket handler
  onPlanCreated: (plan: Plan) => void;
  onPlanUpdated: (planUid: string) => void;
  onTaskUpdated: (planUid: string, taskUid: string, status: string) => void;
  onCommentAdded: (comment: Comment) => void;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  plans: [],
  activePlanUid: null,
  activePlan: null,
  selectedTaskUid: null,
  comments: [],
  sessions: [],
  deviations: [],

  fetchPlans: async (projectPath) => {
    const url = projectPath ? `/api/plans?project=${encodeURIComponent(projectPath)}` : '/api/plans';
    const res = await fetch(url);
    const plans = await res.json();
    set({ plans });
  },

  fetchPlan: async (uid) => {
    const res = await fetch(`/api/plans/${uid}`);
    const plan = await res.json();
    set({ activePlan: plan, activePlanUid: uid });
    // Also fetch comments
    get().fetchComments(uid);
  },

  setActivePlan: async (uid) => {
    if (uid) {
      await get().fetchPlan(uid);

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

          projectStore.addTab(plan.projectPath, branch);
          projectStore.setScanStatus('scanning');
          try {
            const { getAPI } = await import('../bridge');
            const api = getAPI();
            const result = await api.scanProject(plan.projectPath);
            projectStore.setMonorepoConfig(result.monorepoConfig);
            projectStore.setFileTree(result.fileTree);
            projectStore.setScanStatus('ready');
          } catch (err) {
            projectStore.setError(String(err));
          }
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
    const res = await fetch('/api/sessions');
    const sessions = await res.json();
    set({ sessions });
  },

  onPlanCreated: (plan) => {
    set((s) => ({ plans: [plan, ...s.plans] }));
  },

  onPlanUpdated: (planUid) => {
    // Refresh the plan if it's the active one
    const state = get();
    state.fetchPlans();
    if (state.activePlanUid === planUid) {
      state.fetchPlan(planUid);
    }
  },

  onTaskUpdated: (planUid, taskUid, status) => {
    set((s) => {
      if (!s.activePlan || s.activePlan.uid !== planUid) return s;
      const tasks = s.activePlan.tasks.map((t) =>
        t.uid === taskUid ? { ...t, status: status as Task['status'] } : t
      );
      const completedTaskCount = tasks.filter((t) => t.status === 'done').length;
      return {
        activePlan: { ...s.activePlan, tasks, completedTaskCount },
        plans: s.plans.map((p) => p.uid === planUid ? { ...p, completedTaskCount } : p),
      };
    });
  },

  onCommentAdded: (comment) => {
    set((s) => {
      if (s.activePlanUid === comment.targetUid) {
        return { comments: [...s.comments, comment] };
      }
      return s;
    });
  },
}));
