/**
 * Phase 17.B / Terminal — Terminal session state store.
 *
 * Manages the list of terminal sessions, active tab, and panel
 * open/closed state. Each session has a corresponding backend PTY;
 * the store talks to the REST API for CRUD and leaves the actual
 * I/O to the WebSocket in TerminalInstance.
 */

import { create } from 'zustand';

export type AgentPreset = 'claude' | 'codex' | 'aider' | 'shell';

export interface TerminalSessionInfo {
  id: string;
  preset: AgentPreset;
  title: string;
  cwd: string;
  pid: number;
  createdAt: number;
  alive: boolean;
}

interface TerminalState {
  sessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  isOpen: boolean;

  setOpen: (open: boolean) => void;
  togglePanel: () => void;
  setActiveSession: (id: string) => void;

  /** Create a new terminal session via the backend API. */
  createSession: (preset?: AgentPreset, opts?: { cwd?: string; title?: string }) => Promise<TerminalSessionInfo | null>;
  /** Kill a terminal session. */
  killSession: (id: string) => Promise<void>;
  /** Inject text into a terminal (for agent prompts). */
  injectPrompt: (id: string, text: string) => Promise<boolean>;
  /** Hydrate from the backend on mount. */
  hydrate: () => Promise<void>;
  /** Mark a session as exited (called from WS exit message). */
  markExited: (id: string) => void;
  /** Called when a terminal-created broadcast arrives (e.g. created by API / MCP). */
  onTerminalCreated: (session: TerminalSessionInfo) => void;
  /** Called when a terminal-killed broadcast arrives. */
  onTerminalKilled: (id: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isOpen: false,

  setOpen: (open) => set({ isOpen: open }),
  togglePanel: () => {
    const s = get();
    if (!s.isOpen && s.sessions.length === 0) {
      // Opening with no sessions — auto-create a shell terminal
      set({ isOpen: true });
      get().createSession('shell');
      return;
    }
    set({ isOpen: !s.isOpen });
  },
  setActiveSession: (id) => set({ activeSessionId: id }),

  createSession: async (preset = 'shell', opts) => {
    try {
      const res = await fetch('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset,
          cwd: opts?.cwd,
          title: opts?.title,
        }),
      });
      if (!res.ok) return null;
      const session: TerminalSessionInfo = await res.json();
      set((s) => {
        // Deduplicate — the WS `terminal-created` broadcast may have
        // already added this session before the fetch response arrived.
        if (s.sessions.some((ss) => ss.id === session.id)) {
          return { activeSessionId: session.id, isOpen: true };
        }
        return {
          sessions: [...s.sessions, session],
          activeSessionId: session.id,
          isOpen: true,
        };
      });
      return session;
    } catch {
      return null;
    }
  },

  killSession: async (id) => {
    try {
      await fetch(`/api/terminals/${id}`, { method: 'DELETE' });
    } catch { /* best effort */ }
    set((s) => {
      const remaining = s.sessions.filter((ss) => ss.id !== id);
      const nextActive = remaining.length > 0
        ? remaining[remaining.length - 1].id
        : null;
      return {
        sessions: remaining,
        activeSessionId: s.activeSessionId === id ? nextActive : s.activeSessionId,
      };
    });
  },

  injectPrompt: async (id, text) => {
    try {
      const res = await fetch(`/api/terminals/${id}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  hydrate: async () => {
    try {
      const res = await fetch('/api/terminals');
      if (!res.ok) return;
      const sessions: TerminalSessionInfo[] = await res.json();
      set((s) => ({
        sessions,
        activeSessionId: s.activeSessionId ?? (sessions.length > 0 ? sessions[0].id : null),
      }));
    } catch { /* */ }
  },

  markExited: (id) => {
    set((s) => ({
      sessions: s.sessions.map((ss) =>
        ss.id === id ? { ...ss, alive: false } : ss,
      ),
    }));
  },

  onTerminalCreated: (session) => {
    set((s) => {
      // Dedup — we may have already added it via createSession()
      if (s.sessions.some((ss) => ss.id === session.id)) return s;
      return {
        sessions: [...s.sessions, session],
      };
    });
  },

  onTerminalKilled: (id) => {
    set((s) => {
      const remaining = s.sessions.filter((ss) => ss.id !== id);
      const nextActive = remaining.length > 0
        ? remaining[remaining.length - 1].id
        : null;
      return {
        sessions: remaining,
        activeSessionId: s.activeSessionId === id ? nextActive : s.activeSessionId,
      };
    });
  },
}));
