import { create } from 'zustand';
import type { Plan, Task, Comment, AgentSessionInfo, Deviation, PlanDocument, PlanPhase, PhaseStatus } from '@shared/types';

interface PlanState {
  plans: Plan[];
  activePlanUid: string | null;
  activePlan: (Plan & { tasks: Task[] }) | null;
  selectedTaskUid: string | null;
  comments: Comment[];
  sessions: AgentSessionInfo[];
  deviations: Deviation[];
  planDocs: PlanDocument[];
  planPhases: PlanPhase[];
  selectedDocUid: string | null;

  fetchPlans: (projectPath?: string) => Promise<void>;
  fetchPlan: (uid: string) => Promise<void>;
  setActivePlan: (uid: string | null) => void;
  setSelectedTask: (uid: string | null) => void;
  fetchComments: (targetUid: string) => Promise<void>;
  fetchSessions: () => Promise<void>;

  fetchPlanDocs: (planUid: string) => Promise<void>;
  createPlanDoc: (planUid: string, input: { docType: string; title: string; body: string; orderHint?: string | null; parentDocUid?: string | null }) => Promise<PlanDocument | null>;
  updatePlanDoc: (docUid: string, updates: { title?: string; body?: string; docType?: string; changeSummary?: string; orderHint?: string | null; parentDocUid?: string | null }) => Promise<PlanDocument | null>;
  deletePlanDoc: (docUid: string) => Promise<void>;
  setSelectedDoc: (uid: string | null) => void;

  fetchPlanPhases: (planUid: string) => Promise<void>;
  createPlanPhase: (planUid: string, input: {
    title: string;
    phaseNumber?: number;
    scope?: string;
    prerequisites?: string;
    gitCheckpoint?: string | null;
    acceptanceCriteria?: string;
    status?: PhaseStatus;
  }) => Promise<PlanPhase | null>;
  updatePlanPhase: (phaseUid: string, updates: Partial<PlanPhase>) => Promise<PlanPhase | null>;
  deletePlanPhase: (phaseUid: string) => Promise<void>;
  assignTaskToPhase: (planUid: string, taskUid: string, phaseUid: string | null) => Promise<void>;

  // Called by WebSocket handler
  onPlanCreated: (plan: Plan) => void;
  onPlanUpdated: (planUid: string) => void;
  onTaskUpdated: (planUid: string, taskUid: string, status: string) => void;
  onCommentAdded: (comment: Comment) => void;
  onPlanDocCreated: (doc: PlanDocument) => void;
  onPlanDocUpdated: (doc: PlanDocument) => void;
  onPlanDocDeleted: (docUid: string) => void;
  onPlanPhaseChanged: (planUid: string) => void;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  plans: [],
  activePlanUid: null,
  activePlan: null,
  selectedTaskUid: null,
  comments: [],
  sessions: [],
  deviations: [],
  planDocs: [],
  planPhases: [],
  selectedDocUid: null,

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
    // Also fetch comments + spec docs + phases
    get().fetchComments(uid);
    get().fetchPlanDocs(uid);
    get().fetchPlanPhases(uid);
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
      set({ activePlanUid: null, activePlan: null, comments: [], planDocs: [], selectedDocUid: null });
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

  fetchPlanDocs: async (planUid) => {
    try {
      const res = await fetch(`/api/plans/${planUid}/docs`);
      const docs = await res.json();
      set({ planDocs: Array.isArray(docs) ? docs : [] });
    } catch {
      set({ planDocs: [] });
    }
  },

  createPlanDoc: async (planUid, input) => {
    try {
      const res = await fetch(`/api/plans/${planUid}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const doc: PlanDocument = await res.json();
      set((s) => ({
        planDocs: get().activePlanUid === planUid ? [...s.planDocs, doc] : s.planDocs,
      }));
      return doc;
    } catch {
      return null;
    }
  },

  updatePlanDoc: async (docUid, updates) => {
    try {
      const res = await fetch(`/api/plan-docs/${docUid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return null;
      const doc: PlanDocument = await res.json();
      set((s) => ({
        planDocs: s.planDocs.map((d) => (d.uid === docUid ? doc : d)),
      }));
      return doc;
    } catch {
      return null;
    }
  },

  deletePlanDoc: async (docUid) => {
    try {
      await fetch(`/api/plan-docs/${docUid}`, { method: 'DELETE' });
      set((s) => ({
        planDocs: s.planDocs.filter((d) => d.uid !== docUid),
        selectedDocUid: s.selectedDocUid === docUid ? null : s.selectedDocUid,
      }));
    } catch {
      // ignore — WS event will reconcile
    }
  },

  setSelectedDoc: (uid) => set({ selectedDocUid: uid }),

  fetchPlanPhases: async (planUid) => {
    try {
      const res = await fetch(`/api/plans/${planUid}/phases`);
      const phases = await res.json();
      set({ planPhases: Array.isArray(phases) ? phases : [] });
    } catch {
      set({ planPhases: [] });
    }
  },

  createPlanPhase: async (planUid, input) => {
    try {
      const res = await fetch(`/api/plans/${planUid}/phases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const phase: PlanPhase = await res.json();
      set((s) => ({
        planPhases: get().activePlanUid === planUid ? [...s.planPhases, phase] : s.planPhases,
      }));
      return phase;
    } catch {
      return null;
    }
  },

  updatePlanPhase: async (phaseUid, updates) => {
    try {
      const res = await fetch(`/api/plan-phases/${phaseUid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return null;
      const phase: PlanPhase = await res.json();
      set((s) => ({
        planPhases: s.planPhases.map((p) => (p.uid === phaseUid ? phase : p)),
      }));
      return phase;
    } catch {
      return null;
    }
  },

  deletePlanPhase: async (phaseUid) => {
    try {
      await fetch(`/api/plan-phases/${phaseUid}`, { method: 'DELETE' });
      set((s) => {
        // Detach tasks locally so the UI updates immediately; backend
        // already cleared phase_uid via deletePhase.
        const next = s.planPhases.filter((p) => p.uid !== phaseUid);
        if (s.activePlan) {
          const tasks = s.activePlan.tasks.map((t) =>
            t.phaseUid === phaseUid ? { ...t, phaseUid: null } : t,
          );
          return { planPhases: next, activePlan: { ...s.activePlan, tasks } };
        }
        return { planPhases: next };
      });
    } catch {
      // WS event will reconcile
    }
  },

  assignTaskToPhase: async (planUid, taskUid, phaseUid) => {
    try {
      await fetch(`/api/plans/${planUid}/tasks/${taskUid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phaseUid }),
      });
      set((s) => {
        if (!s.activePlan || s.activePlan.uid !== planUid) return s;
        const tasks = s.activePlan.tasks.map((t) =>
          t.uid === taskUid ? { ...t, phaseUid } : t,
        );
        return { activePlan: { ...s.activePlan, tasks } };
      });
    } catch {
      // WS task-updated will reconcile
    }
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

  onPlanDocCreated: (doc) => {
    set((s) => {
      if (s.activePlanUid !== doc.planUid) return s;
      if (s.planDocs.some((d) => d.uid === doc.uid)) return s;
      return { planDocs: [...s.planDocs, doc] };
    });
  },

  onPlanDocUpdated: (doc) => {
    set((s) => {
      if (s.activePlanUid !== doc.planUid) return s;
      return { planDocs: s.planDocs.map((d) => (d.uid === doc.uid ? doc : d)) };
    });
  },

  onPlanDocDeleted: (docUid) => {
    set((s) => ({
      planDocs: s.planDocs.filter((d) => d.uid !== docUid),
      selectedDocUid: s.selectedDocUid === docUid ? null : s.selectedDocUid,
    }));
  },

  onPlanPhaseChanged: (planUid) => {
    // Phase create / update / delete from any source — refetch the
    // active plan's phases so the UI reflects all clients (including
    // MCP-side authoring). Cheap, single endpoint.
    if (get().activePlanUid === planUid) {
      get().fetchPlanPhases(planUid);
    }
  },
}));
