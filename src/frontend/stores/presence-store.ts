/**
 * Presence store — Zustand state for the Agent Presence Pane.
 *
 * Cards are ephemeral (in-memory only). The store auto-opens the pane
 * when the first card arrives and manages card stack + reply state.
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
