/**
 * Agent Presence Pane — MCP tools.
 *
 * v1: present, await_ack, dismiss_presence
 * v2: await_user_input
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { resultWithMeta, authorFromExtra } from '../helpers';

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
        'Returns { acked: true, via: "click"|"speech-end" } on success, or { acked: false, via: "timeout" } on timeout. ' +
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
      if (existing?.acked) {
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
        'Returns { text, at } with the user\'s message, or { text: null, timed_out: true } on timeout. ' +
        'Use after presenting a question to let the user respond without leaving the app.',
      inputSchema: {
        prompt: z.string().optional().describe('Hint text shown in the reply box'),
        timeout_ms: z.number().optional().default(60000).describe('Max wait in ms (default 60s, max 300s)'),
      },
    },
    async ({ prompt, timeout_ms }) => {
      const clampedTimeout = Math.min(timeout_ms ?? 60000, 300000);

      // Broadcast the prompt hint so the UI can show it
      if (prompt) {
        deps.broadcast('presence-input-prompt', { prompt });
      }

      // Check if there's already a queued reply
      const immediate = deps.presenceService.consumeReply();
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
          resolve(JSON.stringify({ text: null, timed_out: true }));
        }, clampedTimeout);
        deps.pendingResponses.set(nonce, {
          resolve,
          reject: () => {}, // never rejects — timeout resolves
          timer,
        });
      });

      // Store the nonce so the REST reply endpoint can find it
      (globalThis as any).__presenceReplyNonce = nonce;

      const resultStr = await p;
      return { content: [{ type: 'text' as const, text: resultStr }] };
    },
  );
}
