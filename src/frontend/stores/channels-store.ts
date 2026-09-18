/**
 * CDev Phase 1.4 — channels store.
 *
 * Holds the channel events for the currently-active plan. Hydrated
 * from `/api/plans/:planUid/channels`; mutated through
 * `/api/plans/:planUid/channels` (POST) and
 * `/api/channels/:eventUid/status` (POST). Live updates arrive via
 * the WS event types `channel-event-posted`, `channel-event-status-
 * changed`, and `channel-event-imported`.
 *
 * The store is tab/panel state, not durable — the manifest (in git)
 * is the source of truth.
 */

import { create } from 'zustand';
import type { ChannelEvent, ChannelEventStatus, ChannelEventType } from '@shared/types';

interface ChannelsState {
  /** Which plan's channel is loaded right now. */
  activePlanUid: string | null;
  /** Flat lookup by event uid. Tree shape is derived via `respondsTo`. */
  eventsByUid: Record<string, ChannelEvent>;
  /** Sort cache — chronological by createdAt ascending. Recomputed on mutation. */
  orderedUids: string[];
  /** Drawer open/closed (its own toggle, independent of activity drawer). */
  drawerOpen: boolean;
  /** True while the initial fetch is in flight. */
  loading: boolean;
  /** Posting indicator for the composer. */
  posting: boolean;

  // --- Lifecycle ---
  hydrate: (planUid: string) => Promise<void>;
  reset: (planUid: string | null) => void;
  toggleDrawer: () => void;

  // --- Mutations ---
  post: (input: {
    eventType: ChannelEventType;
    message: string;
    itemUid?: string | null;
    respondsTo?: string | null;
    attempted?: string[];
    options?: string[];
  }) => Promise<ChannelEvent | null>;
  setStatus: (eventUid: string, status: ChannelEventStatus) => Promise<void>;

  // --- WS-driven event handlers ---
  onEventPosted: (event: ChannelEvent | { uid: string; planUid: string }) => Promise<void>;
  onEventStatusChanged: (uid: string, status: ChannelEventStatus) => Promise<void>;
  onEventImported: (uid: string, planUid: string) => Promise<void>;
}

function rebuildOrder(eventsByUid: Record<string, ChannelEvent>): string[] {
  return Object.values(eventsByUid)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((e) => e.uid);
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  activePlanUid: null,
  eventsByUid: {},
  orderedUids: [],
  drawerOpen: false,
  loading: false,
  posting: false,

  async hydrate(planUid: string) {
    if (get().activePlanUid !== planUid) {
      set({ activePlanUid: planUid, eventsByUid: {}, orderedUids: [] });
    }
    set({ loading: true });
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/channels?limit=500`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const events = (await res.json()) as ChannelEvent[];
      const eventsByUid = Object.fromEntries(events.map((e) => [e.uid, e]));
      set({
        eventsByUid,
        orderedUids: rebuildOrder(eventsByUid),
        loading: false,
      });
    } catch (err) {
      console.warn('[Channels] hydrate failed:', err);
      set({ loading: false });
    }
  },

  reset(planUid: string | null) {
    set({ activePlanUid: planUid, eventsByUid: {}, orderedUids: [] });
  },

  toggleDrawer() {
    set({ drawerOpen: !get().drawerOpen });
  },

  async post(input) {
    const planUid = get().activePlanUid;
    if (!planUid) return null;
    set({ posting: true });
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: input.eventType,
          message: input.message,
          item_uid: input.itemUid ?? null,
          responds_to: input.respondsTo ?? null,
          attempted: input.attempted,
          options: input.options,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `status ${res.status}`);
      }
      const created = (await res.json()) as ChannelEvent;
      const eventsByUid = { ...get().eventsByUid, [created.uid]: created };
      set({ eventsByUid, orderedUids: rebuildOrder(eventsByUid), posting: false });
      return created;
    } catch (err) {
      console.warn('[Channels] post failed:', err);
      set({ posting: false });
      return null;
    }
  },

  async setStatus(eventUid, status) {
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(eventUid)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const updated = (await res.json()) as ChannelEvent;
      const eventsByUid = { ...get().eventsByUid, [updated.uid]: updated };
      set({ eventsByUid });
    } catch (err) {
      console.warn('[Channels] setStatus failed:', err);
    }
  },

  async onEventPosted(event) {
    const planUid = get().activePlanUid;
    if (!planUid || event.planUid !== planUid) return;
    // We may receive only a minimal payload from WS — refetch the full
    // event row.
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/channels?limit=500`);
      if (!res.ok) return;
      const events = (await res.json()) as ChannelEvent[];
      const eventsByUid = Object.fromEntries(events.map((e) => [e.uid, e]));
      set({ eventsByUid, orderedUids: rebuildOrder(eventsByUid) });
    } catch (err) {
      console.warn('[Channels] onEventPosted refresh failed:', err);
    }
  },

  async onEventStatusChanged(_uid, _status) {
    const planUid = get().activePlanUid;
    if (!planUid) return;
    // Cheap refresh — the panel's "what needs attention" filter is
    // status-driven, so we want canonical state, not a guess.
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/channels?limit=500`);
      if (!res.ok) return;
      const events = (await res.json()) as ChannelEvent[];
      const eventsByUid = Object.fromEntries(events.map((e) => [e.uid, e]));
      set({ eventsByUid, orderedUids: rebuildOrder(eventsByUid) });
    } catch (err) {
      console.warn('[Channels] onEventStatusChanged refresh failed:', err);
    }
  },

  async onEventImported(_uid, planUid) {
    const active = get().activePlanUid;
    if (!active || active !== planUid) return;
    await get().hydrate(planUid);
  },
}));
