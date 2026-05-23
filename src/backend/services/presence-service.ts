/**
 * Presence service — in-memory card store for agent narration.
 *
 * No database. No persistence across restart. Cards are ephemeral
 * session state, capped at 50 (oldest evicted). The pin-to-item
 * promotion path (v3) will use the existing comment system for
 * durability.
 */

import type { PresenceCard, UserReply } from '../../shared/types';

const MAX_CARDS = 50;

const cards = new Map<string, PresenceCard>();

/** User replies waiting to be consumed by await_user_input. */
const pendingReplies: UserReply[] = [];

// --- Cards ---

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function postCard(input: {
  text: string;
  speak?: boolean;
  requireAck?: boolean;
  tone?: PresenceCard['tone'];
  linkTo?: string | null;
  agentId?: string | null;
}): PresenceCard {
  const card: PresenceCard = {
    id: generateId('pc'),
    text: input.text,
    speak: input.speak ?? false,
    requireAck: input.requireAck ?? false,
    tone: input.tone ?? 'neutral',
    linkTo: input.linkTo ?? null,
    agentId: input.agentId ?? null,
    createdAt: Date.now(),
    acked: false,
    ackedAt: null,
    ackedVia: null,
  };

  // Evict oldest if at cap
  if (cards.size >= MAX_CARDS) {
    const oldest = cards.keys().next().value;
    if (oldest) cards.delete(oldest);
  }

  cards.set(card.id, card);
  return card;
}

export function ackCard(cardId: string, via: 'click' | 'speech-end'): PresenceCard | null {
  const card = cards.get(cardId);
  if (!card) return null;
  card.acked = true;
  card.ackedAt = Date.now();
  card.ackedVia = via;
  return card;
}

export function getCard(cardId: string): PresenceCard | null {
  return cards.get(cardId) ?? null;
}

export function getCards(): PresenceCard[] {
  return [...cards.values()];
}

export function clearCards(): void {
  cards.clear();
}

// --- User replies (v2) ---

export function postReply(text: string): UserReply {
  const reply: UserReply = {
    id: generateId('pr'),
    text,
    createdAt: Date.now(),
  };
  pendingReplies.push(reply);
  return reply;
}

/**
 * Consume the oldest pending reply. Returns null if none waiting.
 * Used by await_user_input to drain the reply queue.
 */
export function consumeReply(): UserReply | null {
  return pendingReplies.shift() ?? null;
}

/** Peek at how many replies are queued (for diagnostics). */
export function pendingReplyCount(): number {
  return pendingReplies.length;
}
