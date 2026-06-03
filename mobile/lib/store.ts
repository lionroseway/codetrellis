/**
 * Mobile workspace store — Zustand-based reactive state.
 *
 * Holds the latest WorkspaceSnapshot (v2) from the desktop and
 * provides typed selectors for each tab to consume. The connection
 * manager pushes snapshots and patches into this store; React
 * components subscribe via hooks.
 *
 * Patch application uses fast-json-patch to stay in sync with the
 * desktop's 100ms debounced JSON-RFC-6902 diffs.
 */

import { create } from 'zustand';
import { applyPatch, type Operation } from 'fast-json-patch';
import type {
  ConnectionState,
  WorkspaceSnapshot,
  PlanSummary,
  AgentSummary,
  ChannelEventSummary,
  PresenceSummary,
  ActiveProjectSummary,
  RecentProjectSummary,
  TerminalSummary,
  InputRequestSummary,
  DeviationCountsSummary,
} from './types';

// --- Store shape -------------------------------------------------------------

interface WorkspaceState {
  // --- Connection ---
  connectionState: ConnectionState;
  connectedFingerprint: string | null;

  // --- Snapshot (v2) ---
  snapshot: WorkspaceSnapshot | null;
  lastSnapshotAt: number | null;

  // --- Actions ---
  setConnectionState: (state: ConnectionState, fingerprint: string | null) => void;
  applySnapshot: (snapshot: WorkspaceSnapshot) => void;
  applyPatch: (patch: Operation[]) => void;
  reset: () => void;
}

// --- Default empty snapshot (used for safe access) ---------------------------

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  v: 2,
  ts: 0,
  plans: [],
  channelEvents: [],
  agents: [],
  presence: [],
  audio: { capturing: false, bufferedSeconds: 0 },
  activeProject: null,
  recentProjects: [],
  terminals: [],
  pendingInputRequests: [],
  walkthroughActive: false,
  deviationCounts: { pending: 0, byPlan: [] },
};

// --- Dedupe helper -----------------------------------------------------------

/**
 * Defensively dedupe the identity-keyed arrays in a snapshot. RFC-6902
 * array patches applied during a reconnect race can occasionally insert
 * a duplicate entry, which then collides on the React key (and shows a
 * redbox in dev). Deduping by the stable identity field keeps the UI
 * consistent regardless of patch ordering.
 */
function dedupeSnapshot(s: WorkspaceSnapshot): WorkspaceSnapshot {
  const uniq = <T>(arr: T[] | undefined, keyOf: (item: T) => string): T[] => {
    if (!arr) return arr as unknown as T[];
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of arr) {
      const k = keyOf(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out.length === arr.length ? arr : out;
  };

  return {
    ...s,
    plans: uniq(s.plans, (p) => p.uid),
    channelEvents: uniq(s.channelEvents, (e) => e.uid),
    agents: uniq(s.agents, (a) => a.sessionId),
    presence: uniq(s.presence, (c) => c.id),
    terminals: uniq(s.terminals, (t) => t.id),
    recentProjects: uniq(s.recentProjects, (p) => p.path),
    pendingInputRequests: uniq(s.pendingInputRequests, (r) => r.requestId),
  };
}

// --- Store -------------------------------------------------------------------

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  // Initial state
  connectionState: 'disconnected',
  connectedFingerprint: null,
  snapshot: null,
  lastSnapshotAt: null,

  // Actions
  setConnectionState: (connectionState, connectedFingerprint) =>
    set({ connectionState, connectedFingerprint }),

  applySnapshot: (snapshot) =>
    set({ snapshot: dedupeSnapshot(snapshot), lastSnapshotAt: Date.now() }),

  applyPatch: (patch) => {
    const current = get().snapshot;
    if (!current) return; // Can't patch without a base snapshot

    try {
      const cloned = JSON.parse(JSON.stringify(current));
      const result = applyPatch(cloned, patch);
      set({ snapshot: dedupeSnapshot(result.newDocument as WorkspaceSnapshot), lastSnapshotAt: Date.now() });
    } catch (err) {
      console.warn('[Store] Patch application failed — requesting resync:', err);
      // The connection manager should handle resync; we just drop the patch
    }
  },

  reset: () =>
    set({
      connectionState: 'disconnected',
      connectedFingerprint: null,
      snapshot: null,
      lastSnapshotAt: null,
    }),
}));

// --- Stable defaults (avoids Zustand infinite re-render from new refs) -------

const EMPTY_PLANS: PlanSummary[] = [];
const EMPTY_EVENTS: ChannelEventSummary[] = [];
const EMPTY_AGENTS: AgentSummary[] = [];
const EMPTY_PRESENCE: PresenceSummary[] = [];
const EMPTY_PROJECTS: RecentProjectSummary[] = [];
const EMPTY_TERMINALS: TerminalSummary[] = [];
const EMPTY_INPUTS: InputRequestSummary[] = [];
const EMPTY_DEVIATIONS: DeviationCountsSummary = { pending: 0, byPlan: [] };
const EMPTY_AUDIO = { capturing: false, bufferedSeconds: 0 };

// --- Typed selectors (for use in tab components) -----------------------------

/** Safe snapshot access — never null, returns empty defaults. */
export function useSnapshot(): WorkspaceSnapshot {
  return useWorkspaceStore((s) => s.snapshot ?? EMPTY_SNAPSHOT);
}

export function useConnectionState(): ConnectionState {
  return useWorkspaceStore((s) => s.connectionState);
}

export function useConnectedFingerprint(): string | null {
  return useWorkspaceStore((s) => s.connectedFingerprint);
}

export function usePlans(): PlanSummary[] {
  return useWorkspaceStore((s) => s.snapshot?.plans ?? EMPTY_PLANS);
}

export function useChannelEvents(): ChannelEventSummary[] {
  return useWorkspaceStore((s) => s.snapshot?.channelEvents ?? EMPTY_EVENTS);
}

export function useAgents(): AgentSummary[] {
  return useWorkspaceStore((s) => s.snapshot?.agents ?? EMPTY_AGENTS);
}

export function usePresence(): PresenceSummary[] {
  return useWorkspaceStore((s) => s.snapshot?.presence ?? EMPTY_PRESENCE);
}

export function useActiveProject(): ActiveProjectSummary | null {
  return useWorkspaceStore((s) => s.snapshot?.activeProject ?? null);
}

export function useRecentProjects(): RecentProjectSummary[] {
  return useWorkspaceStore((s) => s.snapshot?.recentProjects ?? EMPTY_PROJECTS);
}

export function useTerminals(): TerminalSummary[] {
  return useWorkspaceStore((s) => s.snapshot?.terminals ?? EMPTY_TERMINALS);
}

export function usePendingInputRequests(): InputRequestSummary[] {
  return useWorkspaceStore((s) => s.snapshot?.pendingInputRequests ?? EMPTY_INPUTS);
}

export function useWalkthroughActive(): boolean {
  return useWorkspaceStore((s) => s.snapshot?.walkthroughActive ?? false);
}

export function useDeviationCounts(): DeviationCountsSummary {
  return useWorkspaceStore((s) => s.snapshot?.deviationCounts ?? EMPTY_DEVIATIONS);
}

export function useAudio(): { capturing: boolean; bufferedSeconds: number } {
  return useWorkspaceStore((s) => s.snapshot?.audio ?? EMPTY_AUDIO);
}

// --- Attention badge helpers -------------------------------------------------

/** Total attention items: pending deviations + pending input requests + active stuck events. */
export function useAttentionCount(): number {
  return useWorkspaceStore((s) => {
    const snap = s.snapshot;
    if (!snap) return 0;

    const deviations = snap.deviationCounts?.pending ?? 0;
    const inputRequests = snap.pendingInputRequests?.length ?? 0;
    const stuckEvents = snap.channelEvents?.filter(
      (e) => e.eventType === 'stuck' && e.status === 'open',
    ).length ?? 0;
    const needDecision = snap.channelEvents?.filter(
      (e) => e.eventType === 'need-decision' && e.status === 'open',
    ).length ?? 0;

    return deviations + inputRequests + stuckEvents + needDecision;
  });
}
