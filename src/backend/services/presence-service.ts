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

/**
 * Post a reply. `queue: false` when it answered an agent that was waiting:
 * that agent has it, so it is not left queued for whoever asks next.
 */
export function postReply(text: string, opts: { queue?: boolean } = {}): UserReply {
  const reply: UserReply = {
    id: generateId('pr'),
    text,
    createdAt: Date.now(),
  };
  if (opts.queue !== false) pendingReplies.push(reply);
  return reply;
}

// --- Who is waiting for a reply (Phase 32 §0.4f, bug 25) ---
//
// The pane has one reply box, showing the latest question. So one agent at
// a time waits on it: a new question replaces the old, and the agent that
// asked the old one must be told, not left to sit out its timeout. This
// was a single global the tool overwrote without a word.

let replyWaiter: string | null = null;

/** Register the agent now waiting; returns the one it replaced, if any. */
export function setReplyWaiter(nonce: string): string | null {
  const previous = replyWaiter;
  replyWaiter = nonce;
  return previous;
}

/** The waiting agent, handed to whoever answers it (and no longer waiting). */
export function takeReplyWaiter(): string | null {
  const nonce = replyWaiter;
  replyWaiter = null;
  return nonce;
}

/** A wait that ended on its own (timeout): forget it if it is still the current one. */
export function clearReplyWaiter(nonce: string): void {
  if (replyWaiter === nonce) replyWaiter = null;
}

/**
 * Consume the oldest pending reply created at or after `since`.
 *
 * Replies older than `since` answered an earlier prompt — they are
 * discarded rather than returned, so await_user_input never replays a
 * stale reply buffered before its prompt was shown. The queue is ordered
 * by creation time (push order), so all stale entries sit at the front.
 */
export function consumeReply(since = 0): UserReply | null {
  while (pendingReplies.length > 0 && pendingReplies[0].createdAt < since) {
    pendingReplies.shift();
  }
  return pendingReplies.shift() ?? null;
}

/** Peek at how many replies are queued (for diagnostics). */
export function pendingReplyCount(): number {
  return pendingReplies.length;
}
