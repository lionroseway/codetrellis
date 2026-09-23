/**
 * Phase 15 §15.D — V2 plan store.
 *
 * Owns the unified Object/Action tree for the V2 plan workspace.
 * Lives alongside the legacy `plan-store.ts` (which stays mounted
 * for V1 components) until 15.F prunes V1.
 *
 * Backed by the new REST surface from 15.C
 * (`/api/plans/:uid/items`, `/api/items/:uid/*`,
 * `/api/plans/:uid/timeline`) and the WS `plan-item-*` event
 * stream. Optimistic where it's safe, server-authoritative
 * otherwise.
 */

import { create } from 'zustand';
import type {
  PlanItem,
  PlanEvent,
  PlanItemKind,
  PlanItemVersion,
  TaskAttachment,
  Comment,
  TaskStatus,
  FileSpec,
  ItemCriterion,
  CriterionKind,
  CriterionPolicy,
} from '@shared/types';

export interface PlanItemFullBundle {
  item: PlanItem;
  parent: PlanItem | null;
  children: PlanItem[];
  attachments: TaskAttachment[];
  comments: Comment[];
  /** Phase 31 — acceptance criteria, with their derived state. */
  criteria: ItemCriterion[];
  versions: PlanItemVersion[];
}

interface PlanItemsState {
  /** Plan uid we're currently hydrated for. Switching plans clears the store. */
  activePlanUid: string | null;
  /** Flat lookup keyed by uid. Tree built client-side via `parentUid`. */
  itemsByUid: Record<string, PlanItem>;
  /** Newest-first plan_events feed for the activity drawer + timeline. */
  events: PlanEvent[];
  /** What's open in the canvas. Null = empty state. */
  selectedItemUid: string | null;
  /** Back/forward navigation stack of selected items (cmd+[ / cmd+]). */
  history: { back: string[]; forward: string[] };
  /** Per-item full context cache (children + attachments + comments + versions). */
  contextByUid: Record<string, PlanItemFullBundle>;
  /** Toggleable right rail. */
  activityDrawerOpen: boolean;
  /** Toggleable per-item history drawer (versions + events). */
  historyDrawerItemUid: string | null;
  /** Loading flag for the initial tree fetch. */
  hydrating: boolean;

  // --- Bulk hydration ---
  hydratePlan: (planUid: string) => Promise<void>;
  resetForPlan: (planUid: string | null) => void;

  // --- Selection / navigation ---
  selectItem: (uid: string | null) => void;
  navigateBack: () => void;
  navigateForward: () => void;

  // --- Drawers ---
  toggleActivityDrawer: () => void;
  setActivityDrawerOpen: (open: boolean) => void;
  openHistoryDrawer: (itemUid: string | null) => void;

  // --- CRUD ---
  createItem: (input: {
    planUid: string;
    kind: PlanItemKind;
    parentUid?: string | null;
    title: string;
    body?: string;
    template?: string | null;
    sortOrder?: number;
    status?: TaskStatus;
    fileSpecs?: FileSpec[];
    scopePath?: string | null;
  }) => Promise<PlanItem | null>;
  updateItem: (uid: string, updates: Partial<PlanItem> & { changeSummary?: string }) => Promise<PlanItem | null>;
  moveItem: (uid: string, input: { newParentUid?: string | null; newSortOrder?: number }) => Promise<void>;
  deleteItem: (uid: string, cascade?: boolean) => Promise<void>;
  fetchItemFull: (uid: string) => Promise<PlanItemFullBundle | null>;

  // --- Item-context (comments / attachments / progress / blocked) ---
  addItemComment: (uid: string, kind: 'note' | 'blocker' | 'progress' | 'question', body: string) => Promise<Comment | null>;
  removeItemComment: (itemUid: string, commentUid: string) => Promise<void>;
  addItemAttachment: (uid: string, input: {
    kind: TaskAttachment['kind']; value: string; label?: string; contentType?: string;
  }) => Promise<TaskAttachment | null>;
  removeItemAttachment: (itemUid: string, attachmentUid: string) => Promise<void>;
  reportProgress: (uid: string, percent: number, message?: string) => Promise<void>;
  setItemBlocked: (uid: string, reason: string) => Promise<void>;

  // --- WS event handlers ---
  onItemCreated: (item: PlanItem) => void;
  onItemUpdated: (planUid: string, itemUid: string, changes: Record<string, unknown>) => void;
  onItemMoved: (itemUid: string, toParentUid: string | null, sortOrder: number) => void;
  onItemDeleted: (itemUid: string, cascadedUids: string[]) => void;
  onItemEvent: (event: PlanEvent) => void;
  onItemCommentAdded: (itemUid: string, comment: Comment) => void;
  onItemAttachmentAdded: (itemUid: string, attachment: TaskAttachment) => void;

  // Phase 31 — criteria. Each write goes to the REST route that issues a
  // person's decision; the result comes back through `refreshCriteria`.
  refreshCriteria: (itemUid: string) => Promise<void>;
  addCriterion: (itemUid: string, input: { text: string; kind: CriterionKind; policy?: CriterionPolicy }) => Promise<string | null>;
  updateCriterion: (itemUid: string, criterionUid: string, changes: { text?: string; policy?: CriterionPolicy }) => Promise<string | null>;
  deleteCriterion: (itemUid: string, criterionUid: string) => Promise<string | null>;
  decideCriterion: (itemUid: string, criterionUid: string, decision: 'approved' | 'sent_back', note?: string) => Promise<string | null>;
  /**
   * A criterion being written, per item. Held here rather than in the
   * block's own state: the canvas re-renders on every broadcast, and a
   * remount must not throw away what a person was typing — nor should
   * looking at another item and coming back. Present = the form is open.
   */
  criterionDrafts: Record<string, { text: string; kind: CriterionKind }>;
  setCriterionDraft: (itemUid: string, draft: { text: string; kind: CriterionKind } | null) => void;
}

const HISTORY_CAP = 50;
const EVENTS_CAP = 500;

export const usePlanItemsStore = create<PlanItemsState>((set, get) => ({
  activePlanUid: null,
  itemsByUid: {},
  events: [],
  selectedItemUid: null,
  history: { back: [], forward: [] },
  contextByUid: {},
  criterionDrafts: {},
  activityDrawerOpen: true,
  historyDrawerItemUid: null,
  hydrating: false,

  hydratePlan: async (planUid) => {
    const cur = get().activePlanUid;
    if (cur === planUid && Object.keys(get().itemsByUid).length > 0) return;
    // Switching plans — reset navigation history so back/forward
    // don't land on items from a different plan.
    const planChanged = cur !== planUid;
    set({
      hydrating: true,
      activePlanUid: planUid,
      ...(planChanged ? { history: { back: [], forward: [] }, selectedItemUid: null } : {}),
    });
    try {
      const [itemsRes, eventsRes] = await Promise.all([
        fetch(`/api/plans/${planUid}/items`),
        fetch(`/api/plans/${planUid}/timeline?limit=200`),
      ]);
      const items: PlanItem[] = itemsRes.ok ? await itemsRes.json() : [];
      const events: PlanEvent[] = eventsRes.ok ? await eventsRes.json() : [];
      const itemsByUid: Record<string, PlanItem> = {};
      for (const i of items) itemsByUid[i.uid] = i;
      set({ itemsByUid, events, hydrating: false });
    } catch {
      set({ hydrating: false });
    }
  },

  resetForPlan: (planUid) => {
    set({
      activePlanUid: planUid,
      itemsByUid: {},
      events: [],
      selectedItemUid: null,
      history: { back: [], forward: [] },
      contextByUid: {},
      historyDrawerItemUid: null,
    });
  },

  selectItem: (uid) => {
    set((s) => {
      if (s.selectedItemUid === uid) return s;
      const back = s.selectedItemUid ? [...s.history.back, s.selectedItemUid].slice(-HISTORY_CAP) : s.history.back;
      return {
        selectedItemUid: uid,
        history: { back, forward: [] },
      };
    });
    if (uid) get().fetchItemFull(uid);
  },

  navigateBack: () => {
    set((s) => {
      const prev = s.history.back[s.history.back.length - 1];
      if (!prev) return s;
      return {
        selectedItemUid: prev,
        history: {
          back: s.history.back.slice(0, -1),
          forward: s.selectedItemUid ? [...s.history.forward, s.selectedItemUid] : s.history.forward,
        },
      };
    });
    const u = get().selectedItemUid;
    if (u) get().fetchItemFull(u);
  },

  navigateForward: () => {
    set((s) => {
      const next = s.history.forward[s.history.forward.length - 1];
      if (!next) return s;
      return {
        selectedItemUid: next,
        history: {
          back: s.selectedItemUid ? [...s.history.back, s.selectedItemUid] : s.history.back,
          forward: s.history.forward.slice(0, -1),
        },
      };
    });
    const u = get().selectedItemUid;
    if (u) get().fetchItemFull(u);
  },

  toggleActivityDrawer: () => set((s) => ({ activityDrawerOpen: !s.activityDrawerOpen })),
  setActivityDrawerOpen: (open) => set({ activityDrawerOpen: open }),
  openHistoryDrawer: (itemUid) => set({ historyDrawerItemUid: itemUid }),

  createItem: async (input) => {
    try {
      const res = await fetch(`/api/plans/${input.planUid}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const item: PlanItem = await res.json();
      // WS will fold it in too, but optimistically insert so the UI
      // updates instantly.
      set((s) => ({ itemsByUid: { ...s.itemsByUid, [item.uid]: item } }));
      return item;
    } catch { return null; }
  },

  updateItem: async (uid, updates) => {
    try {
      const res = await fetch(`/api/items/${uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return null;
      const item: PlanItem = await res.json();
      set((s) => ({ itemsByUid: { ...s.itemsByUid, [uid]: item } }));
      return item;
    } catch { return null; }
  },

  moveItem: async (uid, input) => {
    try {
      const res = await fetch(`/api/items/${uid}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newParentUid: input.newParentUid,
          newSortOrder: input.newSortOrder,
        }),
      });
      if (!res.ok) return;
      const item: PlanItem = await res.json();
      set((s) => ({ itemsByUid: { ...s.itemsByUid, [uid]: item } }));
    } catch { /* WS will reconcile */ }
  },

  deleteItem: async (uid, cascade = true) => {
    try {
      const res = await fetch(`/api/items/${uid}?cascade=${cascade}`, { method: 'DELETE' });
      if (!res.ok) return;
      const data = await res.json();
      const cascadedUids: string[] = Array.isArray(data?.deleted) ? data.deleted : [uid];
      set((s) => {
        const next = { ...s.itemsByUid };
        for (const u of cascadedUids) delete next[u];
        const selectedItemUid = s.selectedItemUid && cascadedUids.includes(s.selectedItemUid) ? null : s.selectedItemUid;
        return { itemsByUid: next, selectedItemUid };
      });
    } catch { /* WS will reconcile */ }
  },

  fetchItemFull: async (uid) => {
    try {
      const res = await fetch(`/api/items/${uid}/full`);
      if (!res.ok) return null;
      const bundle: PlanItemFullBundle = await res.json();
      set((s) => ({
        contextByUid: { ...s.contextByUid, [uid]: bundle },
        // Also make sure children landed in the flat lookup so the
        // sidebar can render them even if we hydrated lazily.
        itemsByUid: bundle.children.reduce(
          (acc, c) => ({ ...acc, [c.uid]: c }),
          { ...s.itemsByUid, [bundle.item.uid]: bundle.item },
        ),
      }));
      return bundle;
    } catch { return null; }
  },

  addItemComment: async (uid, kind, body) => {
    try {
      const res = await fetch(`/api/items/${uid}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, body }),
      });
      if (!res.ok) return null;
      const comment: Comment = await res.json();
      // Optimistic; WS handler is idempotent on uid.
      set((s) => {
        const ctx = s.contextByUid[uid];
        if (!ctx) return s;
        if (ctx.comments.some((c) => c.uid === comment.uid)) return s;
        return { contextByUid: { ...s.contextByUid, [uid]: { ...ctx, comments: [...ctx.comments, comment] } } };
      });
      return comment;
    } catch { return null; }
  },

  removeItemComment: async (itemUid, commentUid) => {
    try {
      await fetch(`/api/comments/${commentUid}`, { method: 'DELETE' });
      set((s) => {
        const ctx = s.contextByUid[itemUid];
        if (!ctx) return s;
        return {
          contextByUid: {
            ...s.contextByUid,
            [itemUid]: { ...ctx, comments: ctx.comments.filter((c) => c.uid !== commentUid) },
          },
        };
      });
    } catch { /* WS will reconcile if it fails to remove */ }
  },

  addItemAttachment: async (uid, input) => {
    try {
      const res = await fetch(`/api/items/${uid}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const attachment: TaskAttachment = await res.json();
      set((s) => {
        const ctx = s.contextByUid[uid];
        if (!ctx) return s;
        if (ctx.attachments.some((a) => a.uid === attachment.uid)) return s;
        return { contextByUid: { ...s.contextByUid, [uid]: { ...ctx, attachments: [...ctx.attachments, attachment] } } };
      });
      return attachment;
    } catch { return null; }
  },

  removeItemAttachment: async (itemUid, attachmentUid) => {
    try {
      await fetch(`/api/attachments/${attachmentUid}`, { method: 'DELETE' });
      set((s) => {
        const ctx = s.contextByUid[itemUid];
        if (!ctx) return s;
        return {
          contextByUid: {
            ...s.contextByUid,
            [itemUid]: { ...ctx, attachments: ctx.attachments.filter((a) => a.uid !== attachmentUid) },
          },
        };
      });
    } catch { /* WS will reconcile if it fails to remove */ }
  },

  reportProgress: async (uid, percent, message) => {
    try {
      await fetch(`/api/items/${uid}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ percent, message }),
      });
      // Optimistic bump; WS will reconcile.
      set((s) => {
        const item = s.itemsByUid[uid];
        if (!item) return s;
        return { itemsByUid: { ...s.itemsByUid, [uid]: { ...item, progressPercent: percent } } };
      });
    } catch { /* WS will reconcile */ }
  },

  setItemBlocked: async (uid, reason) => {
    try {
      await fetch(`/api/items/${uid}/blocked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      set((s) => {
        const item = s.itemsByUid[uid];
        if (!item) return s;
        return {
          itemsByUid: {
            ...s.itemsByUid,
            [uid]: { ...item, status: 'blocked' as TaskStatus, blockedReason: reason },
          },
        };
      });
    } catch { /* WS will reconcile */ }
  },

  // --- WS handlers (called by useWebSocket) ---

  onItemCreated: (item) => {
    set((s) => {
      if (item.planUid !== s.activePlanUid) return s;
      if (s.itemsByUid[item.uid]) return s; // already there from optimistic
      return { itemsByUid: { ...s.itemsByUid, [item.uid]: item } };
    });
  },

  onItemUpdated: (planUid, itemUid, changes) => {
    set((s) => {
      if (planUid !== s.activePlanUid) return s;
      const before = s.itemsByUid[itemUid];
      if (!before) return s;
      // Apply only known fields from `changes` so we don't smuggle in junk.
      const safeChanges: Partial<PlanItem> = {};
      const keys = ['title', 'body', 'template', 'status', 'assignee', 'progressPercent', 'blockedReason',
        'scopePath', 'fileSpecs', 'symbolSpecs', 'newConnections', 'removedConnections', 'parentUid', 'sortOrder',
        'skills', 'skillsMode', 'claimPolicy', 'claimPolicyMode', 'executionConfig', 'executionConfigMode',
        'constraints', 'constraintsMode', 'requiresApproval'] as const;
      for (const k of keys) {
        if (k in changes) (safeChanges as Record<string, unknown>)[k] = changes[k];
      }
      return { itemsByUid: { ...s.itemsByUid, [itemUid]: { ...before, ...safeChanges } } };
    });
    // The gate is a criterion now (Phase 31): toggling it adds or removes
    // one, so the open item's criteria have to follow.
    if ('requiresApproval' in changes) void get().refreshCriteria(itemUid);
  },

  onItemMoved: (itemUid, toParentUid, sortOrder) => {
    set((s) => {
      const before = s.itemsByUid[itemUid];
      if (!before) return s;
      return {
        itemsByUid: { ...s.itemsByUid, [itemUid]: { ...before, parentUid: toParentUid, sortOrder } },
      };
    });
  },

  onItemDeleted: (_itemUid, cascadedUids) => {
    set((s) => {
      const next = { ...s.itemsByUid };
      for (const u of cascadedUids) delete next[u];
      const selectedItemUid = s.selectedItemUid && cascadedUids.includes(s.selectedItemUid) ? null : s.selectedItemUid;
      return { itemsByUid: next, selectedItemUid };
    });
  },

  onItemEvent: (event) => {
    set((s) => {
      if (event.planUid !== s.activePlanUid) return s;
      const next = [event, ...s.events];
      return { events: next.length > EVENTS_CAP ? next.slice(0, EVENTS_CAP) : next };
    });
  },

  onItemCommentAdded: (itemUid, comment) => {
    set((s) => {
      const ctx = s.contextByUid[itemUid];
      if (!ctx) return s;
      if (ctx.comments.some((c) => c.uid === comment.uid)) return s;
      return { contextByUid: { ...s.contextByUid, [itemUid]: { ...ctx, comments: [...ctx.comments, comment] } } };
    });
  },

  onItemAttachmentAdded: (itemUid, attachment) => {
    set((s) => {
      const ctx = s.contextByUid[itemUid];
      if (!ctx) return s;
      if (ctx.attachments.some((a) => a.uid === attachment.uid)) return s;
      return { contextByUid: { ...s.contextByUid, [itemUid]: { ...ctx, attachments: [...ctx.attachments, attachment] } } };
    });
  },

  refreshCriteria: async (itemUid) => {
    if (!get().contextByUid[itemUid]) return; // not open — it loads fresh when it is
    try {
      const res = await fetch(`/api/items/${itemUid}/criteria`);
      if (!res.ok) return;
      const criteria: ItemCriterion[] = await res.json();
      set((s) => {
        const ctx = s.contextByUid[itemUid];
        if (!ctx) return s;
        return { contextByUid: { ...s.contextByUid, [itemUid]: { ...ctx, criteria } } };
      });
    } catch { /* the WS event will bring it round again */ }
  },

  setCriterionDraft: (itemUid, draft) =>
    set((s) => {
      const next = { ...s.criterionDrafts };
      if (draft) next[itemUid] = draft;
      else delete next[itemUid];
      return { criterionDrafts: next };
    }),

  addCriterion: (itemUid, input) =>
    criteriaWrite(`/api/items/${itemUid}/criteria`, 'POST', input, () => get().refreshCriteria(itemUid)),

  updateCriterion: (itemUid, criterionUid, changes) =>
    criteriaWrite(`/api/criteria/${criterionUid}`, 'PUT', changes, () => get().refreshCriteria(itemUid)),

  deleteCriterion: (itemUid, criterionUid) =>
    criteriaWrite(`/api/criteria/${criterionUid}`, 'DELETE', undefined, () => get().refreshCriteria(itemUid)),

  decideCriterion: (itemUid, criterionUid, decision, note) =>
    criteriaWrite(`/api/criteria/${criterionUid}/decide`, 'POST', { decision, note }, () => get().refreshCriteria(itemUid)),
}));

/** Returns null on success, or the server's reason — shown to the person. */
async function criteriaWrite(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  after: () => Promise<void>,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      return data.error ?? `Failed (HTTP ${res.status})`;
    }
    await after();
    return null;
  } catch (err) {
    return String(err);
  }
}

/**
 * Helper: build a tree of children-by-parent from the flat item map.
 * Components compute this on render with `useMemo`. Cheap — typical
 * plan tree is < 100 items.
 */
export function buildItemTree(itemsByUid: Record<string, PlanItem>): {
  rootUids: string[];
  childrenByParent: Record<string, string[]>;
} {
  const rootUids: string[] = [];
  const childrenByParent: Record<string, string[]> = {};
  const items = Object.values(itemsByUid).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const item of items) {
    if (!item.parentUid) {
      rootUids.push(item.uid);
    } else {
      if (!childrenByParent[item.parentUid]) childrenByParent[item.parentUid] = [];
      childrenByParent[item.parentUid].push(item.uid);
    }
  }
  return { rootUids, childrenByParent };
}
