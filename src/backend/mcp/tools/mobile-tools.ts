/**
 * Mobile companion control — MCP tools that let an agent drive a connected
 * phone: navigate it to a view, screenshot it, or present a narration card.
 *
 * Commands ride the existing WebRTC `control` channel (see mobile-rpc-service
 * for the desktop→mobile push + screenshot round-trip).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { resultWithMeta, authorFromExtra } from '../helpers';
import {
  navigateMobile,
  requestMobileScreenshot,
  mobileConnected,
} from '../../services/mobile-rpc-service';

const VIEW_ROUTES: Record<string, string> = {
  home: '/(tabs)',
  plans: '/(tabs)/plans',
  graph: '/(tabs)/graph',
  terminals: '/(tabs)/terminals',
  activity: '/(tabs)/activity',
};

export function register(server: McpServer, deps: ToolDeps): void {
  // --- mobile_navigate ---
  server.registerTool(
    'mobile_navigate',
    {
      description:
        'Drive a connected phone (CodeTrellis mobile companion) to a view. ' +
        'Use to walk a teammate through something on their device. Provide a `view` ' +
        '(home/plans/graph/terminals/activity), or a `plan_uid` to open a plan, or ' +
        'an `item_uid` (+ plan_uid) to open a plan item. `route` overrides everything ' +
        'with a raw Expo Router path. Requires a paired phone to be connected.',
      inputSchema: {
        view: z.enum(['home', 'plans', 'graph', 'terminals', 'activity']).optional()
          .describe('A top-level mobile view to switch to.'),
        plan_uid: z.string().optional().describe('Open this plan on the phone.'),
        item_uid: z.string().optional().describe('Open this plan item on the phone (pair with plan_uid).'),
        route: z.string().optional().describe('Raw Expo Router path, e.g. "/graph" or "/plan-detail?uid=…".'),
      },
    },
    async ({ view, plan_uid, item_uid, route }) => {
      if (!mobileConnected()) {
        return { content: [{ type: 'text' as const, text: 'No mobile device is connected. Pair + connect a phone first.' }], isError: true };
      }
      let target = route;
      if (!target && item_uid) {
        target = `/item-detail?uid=${encodeURIComponent(item_uid)}${plan_uid ? `&planUid=${encodeURIComponent(plan_uid)}` : ''}`;
      }
      if (!target && plan_uid) target = `/plan-detail?uid=${encodeURIComponent(plan_uid)}`;
      if (!target && view) target = VIEW_ROUTES[view];
      if (!target) {
        return { content: [{ type: 'text' as const, text: 'Provide a view, plan_uid, item_uid, or route.' }], isError: true };
      }
      const reached = navigateMobile(target);
      return { content: [{ type: 'text' as const, text: `Navigated ${reached} phone(s) to ${target}` }] };
    },
  );

  // --- mobile_screenshot ---
  server.registerTool(
    'mobile_screenshot',
    {
      description:
        'Capture a screenshot of a connected phone (CodeTrellis mobile companion) and ' +
        'return it as a PNG. Use to see what the user sees on their device — e.g. after ' +
        'mobile_navigate, to confirm a walkthrough step. Requires a connected phone.',
      inputSchema: {},
    },
    async () => {
      if (!mobileConnected()) {
        return { content: [{ type: 'text' as const, text: 'No mobile device is connected.' }], isError: true };
      }
      try {
        const base64 = await requestMobileScreenshot();
        if (!base64) {
          return { content: [{ type: 'text' as const, text: 'The phone returned an empty image (screenshot support may not be built into this dev client yet).' }], isError: true };
        }
        return { content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    },
  );

  // --- mobile_present ---
  // Presence cards already fan out to every connected surface (incl. the phone)
  // via the workspace snapshot, so this reuses the same path as `present`.
  server.registerTool(
    'mobile_present',
    {
      description:
        'Show a narration card on a connected phone (and the desktop). Use to guide a ' +
        'teammate through a mobile walkthrough. Supports basic markdown.',
      inputSchema: {
        text: z.string().describe('Card body — supports **bold**, `code`, links.'),
        tone: z.enum(['neutral', 'success', 'warning', 'question']).optional().default('neutral'),
      },
    },
    async ({ text, tone }, extra: any) => {
      const { author } = authorFromExtra(deps, extra);
      const card = deps.presenceService.postCard({
        text,
        speak: false,
        requireAck: false,
        tone,
        linkTo: null,
        agentId: author,
      });
      const n = deps.broadcast('presence-card', { card });
      return resultWithMeta({ card_id: card.id, mobile: mobileConnected() }, n);
    },
  );
}
