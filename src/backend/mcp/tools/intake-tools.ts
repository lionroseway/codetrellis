/**
 * SDLC intake tools — Phase 24.
 *
 * See [docs/PHASE-24-SDLC-INTAKE.md](../../../../docs/PHASE-24-SDLC-INTAKE.md).
 *
 * The contract an agent fulfils, rather than an integration we own.
 *
 * The flow these tools are shaped for: an agent holding both a tracker's
 * MCP server and ours reads an epic, calls `create_plan_from_external`
 * with the tree it fetched, works the plan, then calls
 * `get_external_sync_state` and writes the transitions back with its own
 * tracker credentials. Nothing here ever makes an outbound call, and no
 * credential comes near this process.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { authorFromExtra } from '../helpers';
import {
  flattenIntake,
  intakeBody,
  intakeKind,
  keyFromUrl,
  setPlanExternalRef,
  getPlanExternalRefs,
  getSyncState,
  markSynced,
  MAX_INTAKE_DEPTH,
  type IntakeNode,
} from '../../services/external-intake-service';
import { createExternalRef } from '../../services/external-refs-service';

const externalSchema = z.object({
  url: z.string().describe('Link to the ticket / issue / page.'),
  key: z.string().nullable().optional().describe('Ticket key, e.g. PROJ-412. Derived from the URL when omitted.'),
  title: z.string().optional(),
});

/**
 * Recursive shape, declared to a fixed depth because JSON Schema
 * generation from a z.lazy() recursive type is not reliably supported by
 * every MCP client. Three levels is the cap the service enforces anyway
 * (epic → story → task), so nothing is lost by saying so explicitly.
 */
const leafSchema = z.object({
  external: externalSchema.nullable().optional(),
  title: z.string(),
  body: z.string().optional(),
  acceptance: z.array(z.string()).optional(),
  kind: z.enum(['object', 'action']).optional(),
});
const midSchema = leafSchema.extend({ children: z.array(leafSchema).optional() });
const rootSchema = leafSchema.extend({ children: z.array(midSchema).optional() });

export function register(server: McpServer, deps: ToolDeps): void {
  // --- create_plan_from_external ---

  server.registerTool(
    'create_plan_from_external',
    {
      description:
        'Turn a ticket hierarchy you have already fetched (Jira epic + stories, a Linear project, a set of ' +
        'GitHub issues) into a CodeTrellis plan with nested items, each carrying its ticket key. YOU fetch ' +
        'with your own tracker credentials; CodeTrellis never calls out. Re-importing the same epic updates ' +
        'the plan rather than duplicating it. Acceptance criteria land as a checklist in each item body. ' +
        `Depth is capped at ${MAX_INTAKE_DEPTH} (epic → story → task); anything deeper is levelled rather ` +
        'than dropped.',
      inputSchema: {
        title: z.string().describe('Plan title — usually the epic summary.'),
        description: z.string().optional(),
        external: externalSchema.optional().describe('The epic / parent ticket this plan represents.'),
        items: z.array(rootSchema).describe('The ticket tree, already fetched.'),
      },
    },
    async (args, extra: any) => {
      const author = authorFromExtra(deps, extra);

      const plan = deps.planService.createPlan(
        { title: args.title, description: args.description ?? '', tasks: [] },
        author.author,
        author.authorType,
        '',
      );

      if (args.external) {
        setPlanExternalRef({
          planUid: plan.uid,
          url: args.external.url,
          key: args.external.key ?? undefined,
          title: args.external.title,
          author: author.author,
          authorType: author.authorType,
        });
      }

      const flat = flattenIntake(args.items as IntakeNode[]);
      const uidByIndex: Array<string | null> = [];
      let created = 0;
      let linked = 0;

      for (let i = 0; i < flat.length; i++) {
        const { node, depth, parentIndex } = flat[i];
        const parentUid = parentIndex === null ? null : uidByIndex[parentIndex];

        const item = deps.planItemService.createItem({
          planUid: plan.uid,
          kind: intakeKind(node, depth),
          title: node.title,
          body: intakeBody(node),
          parentUid: parentUid ?? undefined,
          author: author.author,
          authorType: author.authorType,
        });

        uidByIndex.push(item?.uid ?? null);
        if (!item) continue;
        created++;

        if (node.external?.url) {
          createExternalRef({
            itemUid: item.uid,
            url: node.external.url,
            title: node.external.title,
            externalKey: node.external.key ?? keyFromUrl(node.external.url),
            author: author.author,
            authorType: author.authorType,
          });
          linked++;
        }
      }

      const n = deps.broadcast('plan-created', { plan });
      deps.saveNow(() => deps.exportDatabase());

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: true,
              plan_uid: plan.uid,
              items_created: created,
              items_with_tickets: linked,
              depth_cap: MAX_INTAKE_DEPTH,
              broadcastTo: n,
              next: 'Work the plan as usual. Call get_external_sync_state when you want to write statuses back.',
            },
            null,
            2,
          ),
        }],
      };
    },
  );

  // --- set_plan_external_ref ---

  server.registerTool(
    'set_plan_external_ref',
    {
      description:
        'Attach (or update) the ticket a plan represents — an epic, a project, a milestone. Idempotent on ' +
        'the ticket key, so calling it twice updates rather than duplicating. Item-level tickets use ' +
        'add_external_ref instead.',
      inputSchema: {
        plan_uid: z.string(),
        url: z.string(),
        key: z.string().optional(),
        title: z.string().optional(),
      },
    },
    async ({ plan_uid, url, key, title }) => {
      const ref = setPlanExternalRef({ planUid: plan_uid, url, key, title });
      return { content: [{ type: 'text' as const, text: JSON.stringify(ref, null, 2) }] };
    },
  );

  // --- get_external_sync_state ---

  server.registerTool(
    'get_external_sync_state',
    {
      description:
        'What has changed in this plan since the last write-back: every item carrying a ticket key whose ' +
        'status moved, with the key, the current status and a SUGGESTED transition name. Read this, write ' +
        'the transitions with your own tracker MCP, then call mark_external_synced. Reading does not ' +
        'advance the watermark — an agent that read the list and then failed to write would otherwise lose ' +
        'those transitions silently. The suggested transition is advisory: every tracker has its own ' +
        'workflow, and you can see the real transition names; we cannot.',
      inputSchema: {
        plan_uid: z.string(),
      },
    },
    async ({ plan_uid }) => {
      const state = getSyncState(plan_uid);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(
            {
              plan_uid: state.planUid,
              last_synced_at: state.lastSyncedAt,
              never_synced: state.lastSyncedAt === null,
              plan_tickets: state.planRefs.map((r) => ({ key: r.externalKey, url: r.url, title: r.title })),
              changed: state.changed.map((c) => ({
                item_uid: c.itemUid,
                title: c.title,
                status: c.status,
                external_key: c.externalKey,
                url: c.url,
                suggested_transition: c.suggestedTransition,
              })),
            },
            null,
            2,
          ),
        }],
      };
    },
  );

  // --- mark_external_synced ---

  server.registerTool(
    'mark_external_synced',
    {
      description:
        'Record that you have written this plan\'s status changes back to the tracker. Advances the ' +
        'watermark, so the next get_external_sync_state returns only what changed after this point. ' +
        'Call it only once the writes actually succeeded.',
      inputSchema: {
        plan_uid: z.string(),
        note: z.string().optional().describe('What you wrote back, for the audit trail.'),
      },
    },
    async ({ plan_uid, note }, extra: any) => {
      const author = authorFromExtra(deps, extra);
      const result = markSynced(plan_uid, author.author, note);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: true, plan_uid, ...result }, null, 2),
        }],
      };
    },
  );

  // --- list_plan_external_refs ---

  server.registerTool(
    'list_plan_external_refs',
    {
      description: 'The tickets attached to a plan itself (as opposed to its items).',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(getPlanExternalRefs(plan_uid), null, 2) }],
    }),
  );
}
