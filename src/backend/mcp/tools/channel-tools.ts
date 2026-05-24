/**
 * Channel tools — Phase 1.3 of the CDev target architecture.
 *
 * Six MCP tools for posting and reading channel events: the peer-to-peer
 * team-coordination event log per plan. Both humans and agents can post;
 * both can respond.
 *
 * Events live in the `channel_events` table and are auto-exported to the
 * manifest when the plan is shared (linked to disk). Teammates pull the
 * resulting YAML files via git and the file watcher re-imports them.
 *
 * See docs/cdev/08-agent-collaboration.md.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import {
  postChannelEvent,
  listChannelEvents,
  listThread,
  setChannelEventStatus,
  type PostChannelEventInput,
  type ListChannelEventsOptions,
} from '../../services/channel-event-service';
import { exportChannelEvent } from '../../services/channel-event-file-service';
import { getLinkedPlanDir } from '../../services/plan-file-service';
import { getPlan } from '../../services/plan-service';
import type { ChannelEvent, ChannelEventType, ChannelEventStatus } from '../../../shared/types';
import { CHANNEL_EVENT_TYPES, CHANNEL_EVENT_STATUSES } from '../../../shared/types';

const eventTypeEnum = z.enum([
  'stuck',
  'need-decision',
  'need-context',
  'handing-off',
  'steer',
  'weigh-in',
]);

const statusEnum = z.enum(['open', 'resolved', 'dismissed']);

export function register(server: McpServer, deps: ToolDeps): void {
  // --- post_channel_event ---

  server.registerTool(
    'post_channel_event',
    {
      description:
        'Post a channel event to a plan. Six event types in the peer-to-peer team-coordination vocabulary: ' +
        'stuck (failing repeatedly), need-decision (genuine choice can\'t make alone), need-context (missing knowledge), ' +
        'handing-off (another actor should take over; here\'s what was tried), steer (direction in response), ' +
        'weigh-in (here\'s my thinking — what do others see?). ' +
        'Both humans and agents can post any of these. Events are durable; when the plan is shared (linked to disk), ' +
        'the event is exported to .codetrellis/plans/<slug>/channels/<uid>.yaml and travels via git.',
      inputSchema: {
        plan_uid: z.string().describe('UID of the plan to post the event on.'),
        item_uid: z.string().nullable().optional().describe(
          'Optional UID of the plan item this event anchors to. Useful when a stuck/need-decision is specific to one item.',
        ),
        event_type: eventTypeEnum.describe('One of the six channel event types.'),
        message: z.string().describe('Plain-English description of the event. Required. Used as the headline by readers.'),
        attempted: z.array(z.string()).optional().describe(
          'For stuck / handing-off: short list of what was tried. One entry per attempt.',
        ),
        options: z.array(z.string()).optional().describe(
          'For need-decision: the alternatives the asker has identified.',
        ),
        responds_to: z.string().nullable().optional().describe(
          'UID of the channel event this responds to (for threading). Required when posting a steer that resolves a stuck.',
        ),
      },
    },
    async ({ plan_uid, item_uid, event_type, message, attempted, options, responds_to }, extra: any) => {
      const sessionId =
        extra?.sessionInfo?.sessionId ?? extra?.requestInfo?.headers?.['mcp-session-id'] ?? null;
      const { author, authorType, agentModel } = resolveAttribution(deps, sessionId);

      const payload: PostChannelEventInput['payload'] = { message };
      if (attempted && attempted.length > 0) payload.attempted = attempted;
      if (options && options.length > 0) payload.options = options;

      const created = postChannelEvent({
        planUid: plan_uid,
        itemUid: item_uid ?? null,
        eventType: event_type as ChannelEventType,
        payload,
        author,
        authorType,
        agentModel,
        respondsTo: responds_to ?? null,
      });

      // Auto-export when the plan is shared (its directory exists on disk).
      maybeExportEvent(created);

      deps.broadcast('channel-event-posted', {
        uid: created.uid,
        planUid: created.planUid,
        itemUid: created.itemUid,
        eventType: created.eventType,
        respondsTo: created.respondsTo,
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(created, null, 2) }] };
    },
  );

  // --- list_channel_events ---

  server.registerTool(
    'list_channel_events',
    {
      description:
        'List channel events for a plan, newest-first. Filter by event type, status, or scoped item. ' +
        'Use this to see "what needs my attention" (status=open) or to review the team-coordination history.',
      inputSchema: {
        plan_uid: z.string().describe('UID of the plan to list events for.'),
        event_types: z.array(eventTypeEnum).optional().describe(
          'Filter to these event types. Omit for all.',
        ),
        status: z.array(statusEnum).optional().describe(
          'Filter to these statuses. Omit for all. "open" surfaces "what needs response".',
        ),
        item_uid: z.string().optional().describe(
          'Scope to events anchored to this plan item.',
        ),
        since_ms: z.number().optional().describe(
          'UNIX ms cutoff — only events with created_at >= since_ms. Useful for incremental polling.',
        ),
        limit: z.number().optional().describe('Cap. Default 200.'),
        offset: z.number().optional().describe('Pagination offset. Default 0.'),
      },
    },
    async ({ plan_uid, event_types, status, item_uid, since_ms, limit, offset }) => {
      const opts: ListChannelEventsOptions = {};
      if (event_types && event_types.length > 0) opts.eventTypes = event_types as ChannelEventType[];
      if (status && status.length > 0) opts.status = status as ChannelEventStatus[];
      if (item_uid) opts.itemUid = item_uid;
      if (since_ms !== undefined) opts.sinceMs = since_ms;
      if (limit !== undefined) opts.limit = limit;
      if (offset !== undefined) opts.offset = offset;

      const events = listChannelEvents(plan_uid, opts);
      return { content: [{ type: 'text' as const, text: JSON.stringify(events, null, 2) }] };
    },
  );

  // --- get_channel_thread ---

  server.registerTool(
    'get_channel_thread',
    {
      description:
        'Return a channel event thread — the root event plus all descendant responses, ordered chronologically. ' +
        'Use this to read the full back-and-forth around a stuck / need-decision conversation.',
      inputSchema: {
        root_event_uid: z.string().describe('UID of the thread root (typically a stuck or need-decision event).'),
      },
    },
    async ({ root_event_uid }) => {
      const events = listThread(root_event_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(events, null, 2) }] };
    },
  );

  // --- resolve_channel_event ---

  server.registerTool(
    'resolve_channel_event',
    {
      description:
        'Mark a channel event as resolved. Typically called after a stuck has been steered through, ' +
        'or a need-decision has been answered. Sets status to "resolved" and exports the change to disk.',
      inputSchema: {
        event_uid: z.string().describe('UID of the channel event to resolve.'),
      },
    },
    async ({ event_uid }) => {
      const updated = setChannelEventStatus(event_uid, 'resolved');
      maybeExportEvent(updated);
      deps.broadcast('channel-event-status-changed', {
        uid: updated.uid,
        planUid: updated.planUid,
        status: updated.status,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
    },
  );

  // --- dismiss_channel_event ---

  server.registerTool(
    'dismiss_channel_event',
    {
      description:
        'Mark a channel event as dismissed. Used when an event no longer needs a response (e.g., the underlying ' +
        'issue went away, or the asker abandoned the line of inquiry). The event stays in the history; it just ' +
        'stops appearing in "what needs my attention" lists.',
      inputSchema: {
        event_uid: z.string().describe('UID of the channel event to dismiss.'),
      },
    },
    async ({ event_uid }) => {
      const updated = setChannelEventStatus(event_uid, 'dismissed');
      maybeExportEvent(updated);
      deps.broadcast('channel-event-status-changed', {
        uid: updated.uid,
        planUid: updated.planUid,
        status: updated.status,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
    },
  );
}

// --- helpers ---------------------------------------------------------------

/**
 * Resolve the author for a channel event from the calling session.
 * Falls back to the per-user identity when the session is anonymous.
 */
function resolveAttribution(
  deps: ToolDeps,
  sessionId: string | null,
): { author: string; authorType: string; agentModel: string | null } {
  const settings = deps.getSettings();
  const humanAuthor = settings.identity.email || 'human';

  if (!sessionId) {
    return { author: humanAuthor, authorType: 'human', agentModel: null };
  }

  const sessions = deps.sessionService.getActiveSessions();
  const match = sessions.find((s) => s.sessionId === sessionId);
  if (!match) {
    return { author: humanAuthor, authorType: 'human', agentModel: null };
  }
  return {
    author: humanAuthor,
    authorType: match.agentType || 'human',
    agentModel: match.model ?? null,
  };
}

/**
 * Export the event to disk if the plan is shared (linked). No-op when
 * the plan stays DB-only — the event just doesn't travel via git.
 */
function maybeExportEvent(event: ChannelEvent): void {
  const plan = getPlan(event.planUid);
  if (!plan) return;
  const linkedDir = getLinkedPlanDir(event.planUid, plan.projectPath);
  if (!linkedDir) return;
  try {
    exportChannelEvent(event, plan.projectPath);
  } catch (err) {
    console.warn(`[ChannelTools] Failed to export event ${event.uid} to disk:`, err);
  }
}

// Keep the imports referenced for the registration map; tools surface
// only the values the SDK needs.
void CHANNEL_EVENT_TYPES;
void CHANNEL_EVENT_STATUSES;
