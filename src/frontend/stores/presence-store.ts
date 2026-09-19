/**
 * Presence store — Zustand state for the Agent Presence Pane.
 *
 * Cards are ephemeral (in-memory only). The store auto-opens the pane
 * when the first card arrives and manages card stack + reply state.
 *
 * Phase 29 §4.16 — "in-memory only" was true of the CLIENT, and that
 * was a bug rather than a design. The backend keeps the cards and
 * serves them from `/api/presence/cards`, which had no caller: the
 * store was filled purely by WebSocket pushes, so a reload started it
 * empty and every card already on screen vanished.
 *
 * That is not cosmetic. A card with `requireAck` is an agent blocked on
 * `await_ack` — refreshing the window made the prompt disappear while
 * the agent went on waiting for an answer the user could no longer
 * give. `hydrate()` fixes that by asking for what the backend still
 * holds.
 */

import { create } from 'zustand';
import type { PresenceCard, UserReply } from '@shared/types';

const MAX_CARDS = 50;

interface PresenceState {
  cards: PresenceCard[];
  visible: boolean;
  minimized: boolean;  // header-only mode, shows unread count
  position: { x: number; y: number } | null;  // null = default corner
  inputPrompt: string | null;  // hint from agent via await_user_input
  replies: UserReply[];

  // Actions
  /** Pull the cards the backend still holds — see the note at the top. */
  hydrate: () => Promise<void>;
  pushCard: (card: PresenceCard) => void;
  ackCard: (cardId: string, via: 'click' | 'speech-end') => void;
  clearCards: () => void;
  setVisible: (v: boolean) => void;
  setMinimized: (m: boolean) => void;
  setPosition: (pos: { x: number; y: number }) => void;
  setInputPrompt: (prompt: string | null) => void;
  pushReply: (reply: UserReply) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  cards: [],
  visible: false,
  minimized: false,
  position: null,
  inputPrompt: null,
  replies: [],

  hydrate: async () => {
    try {
      const res = await fetch('/api/presence/cards');
      if (!res.ok) return;
      const cards = await res.json() as PresenceCard[];
      if (!Array.isArray(cards) || cards.length === 0) return;
      set((s) => {
        // A WebSocket card can land before this resolves, so merge by
        // id rather than replacing — losing a card to a race would be
        // the same bug this is fixing.
        const byId = new Map(cards.map((c) => [c.id, c]));
        for (const existing of s.cards) byId.set(existing.id, existing);
        const merged = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
        const capped = merged.length > MAX_CARDS ? merged.slice(-MAX_CARDS) : merged;
        // Only raise the pane for something still waiting on the user.
        // Re-opening it for cards they already dealt with would make a
        // reload noisier than the session it restored.
        const needsAttention = capped.some((c) => c.requireAck && !c.acked);
        return {
          cards: capped,
          visible: s.visible || needsAttention,
          minimized: needsAttention ? false : s.minimized,
        };
      });
    } catch { /* offline or backend not up yet — WS will fill in */ }
  },

  pushCard: (card) => set((s) => {
    const next = [...s.cards, card];
    // Cap at MAX_CARDS, evict oldest
    const capped = next.length > MAX_CARDS ? next.slice(-MAX_CARDS) : next;
    return { cards: capped, visible: true, minimized: false };
  }),

  ackCard: (cardId, via) => set((s) => ({
    cards: s.cards.map((c) =>
      c.id === cardId
        ? { ...c, acked: true, ackedAt: Date.now(), ackedVia: via }
        : c
    ),
  })),

  clearCards: () => set({ cards: [], inputPrompt: null }),

  setVisible: (v) => set({ visible: v }),

  setMinimized: (m) => set({ minimized: m }),

  setPosition: (pos) => set({ position: pos }),

  setInputPrompt: (prompt) => set({ inputPrompt: prompt }),

  pushReply: (reply) => set((s) => ({
    replies: [...s.replies.slice(-49), reply],
  })),
}));
