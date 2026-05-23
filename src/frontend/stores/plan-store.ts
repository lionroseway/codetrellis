import { create } from 'zustand';
import type { Plan, Task, Comment, AgentSessionInfo, Deviation, PlanDocument, PlanPhase, PhaseStatus, TaskAttachment, FileSpec, AttachmentKind } from '@shared/types';

/**
 * Phase 14 §B — per-task hydrated context. The Plan Workspace's
 * TaskCard shows comments + attachments + subtasks inline; rather
 * than fetch each per click, we cache the full bundle keyed by task
 * uid and hydrate lazily on first expand.
 */
export interface TaskContextBundle {
  comments: Comment[];
  attachments: TaskAttachment[];
  subtasks: Task[];
}

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
  /** Phase 14 §B — task-uid → hydrated context (comments + attachments + subtasks). */
  taskContexts: Record<string, TaskContextBundle>;
  /** Phase 14 §B — plan-scoped activity feed (claims, progress, blockers, comments, …). */
  activityEvents: Array<{
    id: string;
    timestamp: number;
    type: string;
    taskUid?: string;
    payload: Record<string, unknown>;
  }>;

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
  onPlanDeleted: (planUid: string) => void;
  onPlanUpdated: (planUid: string) => void;
  onTaskUpdated: (planUid: string, taskUid: string, status: string) => void;
  onCommentAdded: (comment: Comment) => void;
  onPlanDocCreated: (doc: PlanDocument) => void;
  onPlanDocUpdated: (doc: PlanDocument) => void;
  onPlanDocDeleted: (docUid: string) => void;
  onPlanPhaseChanged: (planUid: string) => void;

  // --- Phase 14 §B — Plan Workspace ---
  /** Hydrate `taskContexts[taskUid]` from `/api/tasks/:taskUid/full`. */
  fetchTaskContext: (taskUid: string) => Promise<TaskContextBundle | null>;
  /** Add a comment via REST, then push it into the task context cache. */
  addTaskComment: (taskUid: string, kind: 'note' | 'blocker' | 'progress' | 'question', body: string) => Promise<Comment | null>;
  /** Pin an attachment via REST. */
  addTaskAttachment: (taskUid: string, input: { kind: AttachmentKind; value: string; label?: string; contentType?: string }) => Promise<TaskAttachment | null>;
  /** Drop an attachment by uid. */
  removeTaskAttachment: (taskUid: string, attachmentUid: string) => Promise<void>;
  /** Mid-task progress heartbeat. */
  reportTaskProgress: (taskUid: string, percent: number, message?: string) => Promise<void>;
  /** Mark a task blocked with a reason. */
  setTaskBlocked: (taskUid: string, reason: string) => Promise<void>;
  /** Add a subtask under a task. */
  addSubtask: (taskUid: string, input: { description: string; body?: string; prompt?: string; scopePath?: string | null; fileSpecs?: FileSpec[] }) => Promise<Task | null>;
  /** Update task fields via REST (body / prompt / fileSpecs / scope_path / status / parent_task_uid). */
  updateTaskFields: (planUid: string, taskUid: string, updates: Partial<Pick<Task, 'description' | 'status' | 'body' | 'prompt' | 'scopePath' | 'fileSpecs' | 'parentTaskUid' | 'phaseUid'>>) => Promise<void>;
  /** Append an event to the plan-scoped activity feed. */
  pushActivityEvent: (event: { type: string; taskUid?: string; payload: Record<string, unknown> }) => void;

  /**
   * Phase 15 §15.D — patch the plan's git context (baseRef /
   * targetBranch / targetWorktree / autoCreateBranch). Optimistic
   * apply on the active plan + plans list; WS plan-updated will
   * reconcile from authoritative state.
   */
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
  planDocs: [],
  planPhases: [],
  selectedDocUid: null,
  taskContexts: {},
  activityEvents: [],

  fetchPlans: async (projectPath) => {
    const url = projectPath ? `/api/plans?project=${encodeURIComponent(projectPath)}` : '/api/plans';
    const res = await fetch(url);
    const plans = await res.json();
    set({ plans });
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
    // Also fetch comments + spec docs + phases
    get().fetchComments(uid);
    get().fetchPlanDocs(uid);
    get().fetchPlanPhases(uid);
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
      set({ activePlanUid: null, activePlan: null, comments: [], planDocs: [], selectedDocUid: null, taskContexts: {}, activityEvents: [] });
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
    // Optimistic prepend for instant visibility
    set((s) => {
      if (s.plans.some((p) => p.uid === plan.uid)) return s;
      return { plans: [plan, ...s.plans] };
    });
    // Also do a full server re-fetch so the project filter is applied
    // correctly (in case the agent's project_path doesn't exactly match
    // the UI's current root, or the optimistic append gets stale).
    (async () => {
      const { useProjectStore } = await import('./project-store');
      const root = useProjectStore.getState().root;
      get().fetchPlans(root || undefined);
    })();
  },

  onPlanDeleted: (planUid) => {
    set((s) => {
      const plans = s.plans.filter((p) => p.uid !== planUid);
      // If the deleted plan is the active one, clear it
      if (s.activePlanUid === planUid) {
        return { plans, activePlan: null, activePlanUid: null, comments: [], planDocs: [], selectedDocUid: null, taskContexts: {}, activityEvents: [] };
      }
      return { plans };
    });
  },

  onPlanUpdated: (planUid) => {
    // Refresh the plan if it's the active one.
    // Use the current project filter so we don't briefly flash
    // plans from other projects (which causes duplicate-key
    // warnings when fetchPlans(root) replaces the list).
    const state = get();
    (async () => {
      const { useProjectStore } = await import('./project-store');
      const root = useProjectStore.getState().root;
      state.fetchPlans(root || undefined);
    })();
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

  // --- Phase 14 §B Plan Workspace actions ---

  fetchTaskContext: async (taskUid) => {
    try {
      const res = await fetch(`/api/tasks/${taskUid}/full`);
      if (!res.ok) return null;
      const full = await res.json();
      const bundle: TaskContextBundle = {
        comments: Array.isArray(full.comments) ? full.comments : [],
        attachments: Array.isArray(full.attachments) ? full.attachments : [],
        subtasks: Array.isArray(full.subtasks) ? full.subtasks : [],
      };
      set((s) => ({ taskContexts: { ...s.taskContexts, [taskUid]: bundle } }));
      return bundle;
    } catch {
      return null;
    }
  },

  addTaskComment: async (taskUid, kind, body) => {
    try {
      const res = await fetch(`/api/tasks/${taskUid}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, body }),
      });
      if (!res.ok) return null;
      const comment: Comment = await res.json();
      // Optimistically add to taskContexts so the UI sees it before
      // the WS round-trips back. The WS handler is idempotent on uid.
      set((s) => {
        const ctx = s.taskContexts[taskUid];
        if (!ctx) return s;
        if (ctx.comments.some((c) => c.uid === comment.uid)) return s;
        return {
          taskContexts: {
            ...s.taskContexts,
            [taskUid]: { ...ctx, comments: [...ctx.comments, comment] },
          },
        };
      });
      return comment;
    } catch {
      return null;
    }
  },

  addTaskAttachment: async (taskUid, input) => {
    try {
      const res = await fetch(`/api/tasks/${taskUid}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const attachment: TaskAttachment = await res.json();
      set((s) => {
        const ctx = s.taskContexts[taskUid];
        if (!ctx) return s;
        if (ctx.attachments.some((a) => a.uid === attachment.uid)) return s;
        return {
          taskContexts: {
            ...s.taskContexts,
            [taskUid]: { ...ctx, attachments: [...ctx.attachments, attachment] },
          },
        };
      });
      return attachment;
    } catch {
      return null;
    }
  },

  removeTaskAttachment: async (taskUid, attachmentUid) => {
    try {
      await fetch(`/api/attachments/${attachmentUid}`, { method: 'DELETE' });
      set((s) => {
        const ctx = s.taskContexts[taskUid];
        if (!ctx) return s;
        return {
          taskContexts: {
            ...s.taskContexts,
            [taskUid]: { ...ctx, attachments: ctx.attachments.filter((a) => a.uid !== attachmentUid) },
          },
        };
      });
    } catch { /* WS will reconcile */ }
  },

  reportTaskProgress: async (taskUid, percent, message) => {
    try {
      await fetch(`/api/tasks/${taskUid}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ percent, message }),
      });
      // Optimistically bump progressPercent in activePlan; WS will
      // reconcile body / comments.
      set((s) => {
        if (!s.activePlan) return s;
        const tasks = s.activePlan.tasks.map((t) =>
          t.uid === taskUid ? { ...t, progressPercent: percent } : t,
        );
        return { activePlan: { ...s.activePlan, tasks } };
      });
    } catch { /* WS will reconcile */ }
  },

  setTaskBlocked: async (taskUid, reason) => {
    try {
      await fetch(`/api/tasks/${taskUid}/blocked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      set((s) => {
        if (!s.activePlan) return s;
        const tasks = s.activePlan.tasks.map((t) =>
          t.uid === taskUid ? { ...t, status: 'blocked' as Task['status'], blockedReason: reason } : t,
        );
        return { activePlan: { ...s.activePlan, tasks } };
      });
    } catch { /* WS will reconcile */ }
  },

  addSubtask: async (taskUid, input) => {
    try {
      const res = await fetch(`/api/tasks/${taskUid}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const subtask: Task = await res.json();
      set((s) => {
        // Append to the active plan's task list, and to the parent's
        // taskContext.subtasks if hydrated.
        let activePlan = s.activePlan;
        if (activePlan) {
          activePlan = { ...activePlan, tasks: [...activePlan.tasks, subtask] };
        }
        const ctx = s.taskContexts[taskUid];
        const updatedCtx = ctx ? { ...ctx, subtasks: [...ctx.subtasks, subtask] } : ctx;
        return {
          activePlan,
          taskContexts: ctx ? { ...s.taskContexts, [taskUid]: updatedCtx! } : s.taskContexts,
        };
      });
      return subtask;
    } catch {
      return null;
    }
  },

  updateTaskFields: async (planUid, taskUid, updates) => {
    // Map the camelCase fields the store uses onto the REST payload
    // (server.ts pulls them right back out by the same name).
    try {
      await fetch(`/api/plans/${planUid}/tasks/${taskUid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      set((s) => {
        if (!s.activePlan || s.activePlan.uid !== planUid) return s;
        const tasks = s.activePlan.tasks.map((t) =>
          t.uid === taskUid ? { ...t, ...updates } as Task : t,
        );
        return { activePlan: { ...s.activePlan, tasks } };
      });
    } catch { /* WS will reconcile */ }
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

  pushActivityEvent: (event) => {
    set((s) => {
      const next = [
        ...s.activityEvents,
        { id: `${event.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now(), ...event },
      ];
      // Cap the feed at 200 — older events scroll off (the server's
      // durable comments table is the long-term record).
      return { activityEvents: next.length > 200 ? next.slice(-200) : next };
    });
  },
}));
