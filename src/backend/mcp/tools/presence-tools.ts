/**
 * Agent Presence Pane — MCP tools.
 *
 * v1: present, await_ack, dismiss_presence
 * v2: await_user_input
 * Phase 32 B4: await_decision
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { resultWithMeta, authorFromExtra } from '../helpers';
import { getHit, decisionView } from '../../services/breakpoint-service';

export function register(server: McpServer, deps: ToolDeps): void {

  // --- v1: present ---

  server.registerTool(
    'present',
    {
      description:
        'Post a narration card to the Agent Presence Pane — a floating overlay in the CodeTrellis UI. ' +
        'Use this to explain what you\'re doing, narrate a walkthrough, or ask the user a question. ' +
        'Cards support basic markdown (bold, inline code, links). ' +
        'Set speak=true to have the card read aloud via text-to-speech. ' +
        'Set require_ack=true to make the card show a "Got it" button — pair with await_ack to pace a walkthrough.',
      inputSchema: {
        text: z.string().describe('Card body — supports **bold**, `code`, and [links](url)'),
        speak: z.boolean().optional().default(false).describe('Speak the card aloud via built-in TTS'),
        require_ack: z.boolean().optional().default(false).describe('Show a "Got it" button the user must click before you advance'),
        tone: z.enum(['neutral', 'success', 'warning', 'question']).optional().default('neutral').describe('Visual tone — controls the card\'s accent color'),
        link_to: z.string().optional().describe('Node ID or plan item UID to visually anchor the card to'),
      },
    },
    async ({ text, speak, require_ack, tone, link_to }, extra: any) => {
      const { author } = authorFromExtra(deps, extra);
      const card = deps.presenceService.postCard({
        text,
        speak,
        requireAck: require_ack,
        tone,
        linkTo: link_to ?? null,
        agentId: author,
      });
      const n = deps.broadcast('presence-card', { card });
      return resultWithMeta({ card_id: card.id }, n);
    },
  );

  // --- v1: await_ack ---

  server.registerTool(
    'await_ack',
    {
      description:
        'Block until the user acknowledges a presence card (clicks "Got it" or speech finishes). ' +
        'Returns { acked: true, via: "click"|"speech-end" } on success, { acked: false, via: "timeout" } on timeout, or ' +
        '{ acked: false, via: "dismissed" } if the pane was dismissed first. An unknown card_id is an error. ' +
        'Use this after present(require_ack=true) to pace a walkthrough — the agent waits for the human before advancing.',
      inputSchema: {
        card_id: z.string().describe('ID of the card to wait for (returned by present)'),
        timeout_ms: z.number().optional().default(30000).describe('Max wait in ms (default 30s, max 120s)'),
      },
    },
    async ({ card_id, timeout_ms }) => {
      const clampedTimeout = Math.min(timeout_ms ?? 30000, 120000);

      // Already acked? Return immediately.
      const existing = deps.presenceService.getCard(card_id);
      if (!existing) {
        // Waiting would only sit out the timeout: nothing can acknowledge it (bug 25).
        return { content: [{ type: 'text' as const, text:
          `No presence card ${card_id}. Use the card_id that present returned; cards are cleared when the pane is ` +
          'dismissed and when CodeTrellis restarts.' }], isError: true };
      }
      if (existing.acked) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          acked: true, via: existing.ackedVia, card_id,
        }, null, 2) }] };
      }

      // Not yet acked — block on pendingResponses
      const nonce = `ack-${card_id}`;

      const p = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          deps.pendingResponses.delete(nonce);
          resolve(JSON.stringify({ acked: false, via: 'timeout', card_id }));
        }, clampedTimeout);
        deps.pendingResponses.set(nonce, { resolve, reject, timer });
      });

      const resultStr = await p;
      return { content: [{ type: 'text' as const, text: resultStr }] };
    },
  );

  // --- v1: dismiss_presence ---

  server.registerTool(
    'dismiss_presence',
    {
      description: 'Close the Agent Presence Pane and clear all cards. Use when a walkthrough or narration session is complete.',
      inputSchema: {},
    },
    async () => {
      // Anyone waiting on a card is released now, not at its timeout (bug 25).
      for (const card of deps.presenceService.getCards()) {
        const nonce = `ack-${card.id}`;
        const pending = deps.pendingResponses.get(nonce);
        if (!pending) continue;
        clearTimeout(pending.timer);
        deps.pendingResponses.delete(nonce);
        pending.resolve(JSON.stringify({ acked: false, via: 'dismissed', card_id: card.id }));
      }
      deps.presenceService.clearCards();
      const n = deps.broadcast('presence-dismissed', {});
      return resultWithMeta({ ok: true }, n);
    },
  );

  // --- v2: await_user_input ---

  server.registerTool(
    'await_user_input',
    {
      description:
        'Block until the user types a reply in the Presence Pane, or timeout. ' +
        'Returns { text, at } with the user\'s message, { text: null, timed_out: true } on timeout, or ' +
        '{ text: null, superseded: true } if another question replaced yours before the person answered. ' +
        'Use after presenting a question to let the user respond without leaving the app.',
      inputSchema: {
        prompt: z.string().optional().describe('Hint text shown in the reply box'),
        timeout_ms: z.number().optional().default(60000).describe('Max wait in ms (default 60s, max 300s)'),
      },
    },
    async ({ prompt, timeout_ms }) => {
      const clampedTimeout = Math.min(timeout_ms ?? 60000, 300000);
      const startedAt = Date.now();

      // Broadcast the prompt hint so the UI can show it
      if (prompt) {
        deps.broadcast('presence-input-prompt', { prompt });
      }

      // Only honour a reply entered at/after this prompt was shown —
      // never replay a stale reply buffered from an earlier question.
      const immediate = deps.presenceService.consumeReply(startedAt);
      if (immediate) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          text: immediate.text, at: immediate.createdAt,
        }, null, 2) }] };
      }

      // Block on pendingResponses
      const nonce = `reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const p = new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          deps.pendingResponses.delete(nonce);
          deps.presenceService.clearReplyWaiter(nonce);
          resolve(JSON.stringify({ text: null, timed_out: true }));
        }, clampedTimeout);
        deps.pendingResponses.set(nonce, {
          resolve,
          reject: () => {}, // never rejects — timeout resolves
          timer,
        });
      });

      // The reply box now asks this question. Whoever was waiting on the
      // previous one is told so now, not left to sit out its timeout (bug 25).
      const replaced = deps.presenceService.setReplyWaiter(nonce);
      const previous = replaced ? deps.pendingResponses.get(replaced) : undefined;
      if (replaced && previous) {
        clearTimeout(previous.timer);
        deps.pendingResponses.delete(replaced);
        previous.resolve(JSON.stringify({
          text: null,
          superseded: true,
          note: 'Another question replaced yours in the reply box before the person answered. Ask again if you still need it.',
        }));
      }

      const resultStr = await p;
      return { content: [{ type: 'text' as const, text: resultStr }] };
    },
  );

  // --- Phase 32 B4: await_decision ---

  server.registerTool(
    'await_decision',
    {
      description:
        'Wait for a person to answer a breakpoint. When a call returns "paused: waiting for a decision" with a ref, ' +
        'call this with that ref. Returns { status: "answered", decision: "continue" | "steer" | "stop", note } once they ' +
        'answer, or { status: "waiting" } after wait_seconds; then call it again with the same ref. The wait is kept by ' +
        'CodeTrellis, not by this call, so it survives timeouts, reconnects and restarts: an answer can take hours. ' +
        'On continue or steer, make the paused call again (a steer is a note to follow); on stop, do not.',
      inputSchema: {
        ref: z.string().describe('The ref from the paused result'),
        wait_seconds: z.number().min(0).max(55).optional().describe('How long to wait in this call (default 25, max 55)'),
      },
    },
    async ({ ref, wait_seconds }, extra: any) => {
      let hit = getHit(ref);
      if (!hit) {
        return { content: [{ type: 'text' as const, text: `No breakpoint is waiting with ref ${ref}.` }], isError: true };
      }
      const deadline = Date.now() + Math.min(wait_seconds ?? 25, 55) * 1000;
      while (hit.answeredAt === null && Date.now() < deadline && !extra?.signal?.aborted) {
        await new Promise((r) => setTimeout(r, 250));
        hit = getHit(ref) ?? hit;
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(decisionView(hit), null, 2) }] };
    },
  );
}
