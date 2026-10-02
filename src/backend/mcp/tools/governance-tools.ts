/**
 * Governance tools — Phase 6.5 of the CDev target architecture.
 *
 * Freeze periods: mark a project as frozen for non-critical work
 * during release weeks, incident response, etc. Agents that attempt
 * to work on non-exempt plans during a freeze get a warning.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { authorFromExtra } from '../helpers';

/** Said after an agent changes a freeze, so it knows the change is visible. */
const FLAGGED_NOTE = ' Recorded in your name and flagged for a person to review.';
import {
  getFreezeStatus,
  setFreeze,
  isPlanAllowedDuringFreeze,
  exemptPlanFromFreeze,
} from '../../services/freeze-service';
import { verifyRecord } from '../../services/record-chain';

export function register(server: McpServer, deps: ToolDeps): void {
  // --- verify_record (Phase 32 B10.1) ---

  server.registerTool(
    'verify_record',
    {
      description:
        'Is the record intact? Every agent event CodeTrellis keeps (tool calls, and the decisions people make: criteria, ' +
        'breakpoints, signals, spec proposals, rules) is linked into a hash chain as it is written. This walks it and ' +
        'says whether anything kept was changed, removed or added around it since, naming each by number, kind and ' +
        'agent. Read only.',
      inputSchema: {},
    },
    async () => {
      const r = verifyRecord();
      return {
        _meta: { summary: r.ok ? `Record intact: ${r.entries} entries` : `Record changed: ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}` },
        content: [{ type: 'text' as const, text: JSON.stringify({
          ok: r.ok, words: r.words, entries: r.entries, since: r.since, trimmed_through: r.trimmedThrough,
          head: r.head, problems: r.problems.map((p) => ({ seq: p.seq, event_id: p.eventId, kind: p.kind, at: p.at, type: p.type, agent_type: p.agentType })),
        }, null, 2) }],
      };
    },
  );

  // --- get_freeze_status ---

  server.registerTool(
    'get_freeze_status',
    {
      description:
        'Check whether a project is currently under a freeze period. Returns the freeze state, ' +
        'reason, timing, and which plans are exempt. Handles auto-expiry: if the "until" timestamp ' +
        'has passed, the freeze is treated as inactive.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
      },
    },
    async ({ project_path }) => {
      const status = getFreezeStatus(project_path);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(status, null, 2),
        }],
      };
    },
  );

  // --- set_freeze ---

  server.registerTool(
    'set_freeze',
    {
      description:
        'Activate or deactivate a freeze period on a project. During a freeze, agents should not ' +
        'start work on non-exempt plans. Use this during release weeks, incident response, or any ' +
        'period where non-critical changes should be blocked. The freeze is stored in ' +
        '.codetrellis/config.json and committed to the manifest.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
        active: z.boolean().describe('True to activate the freeze, false to lift it.'),
        reason: z.string().optional().describe('Human-readable reason (e.g., "Release v2.3 freeze").'),
        until: z.string().nullable().optional().describe('ISO timestamp when the freeze auto-expires. Null = indefinite.'),
        allowed_plan_uids: z.array(z.string()).optional().describe('Plan UIDs exempt from the freeze.'),
      },
    },
    async ({ project_path, active, reason, until, allowed_plan_uids }, extra: any) => {
      // Allowed, in the agent's own name, and flagged until a person has seen
      // it (owner's decision, Phase 32 §0.4k).
      const { author, authorType } = authorFromExtra(deps, extra);
      const status = setFreeze(project_path, {
        active,
        reason,
        until,
        allowedPlanUids: allowed_plan_uids,
      }, { actor: author, actorType: authorType, channel: 'mcp' });

      deps.broadcast('freeze-changed', { projectRoot: project_path, status });

      const msg = (active
        ? `Freeze activated${reason ? `: ${reason}` : ''}${until ? ` (expires ${until})` : ' (indefinite)'}. ${(allowed_plan_uids ?? []).length} plan(s) exempt.`
        : 'Freeze lifted.') + FLAGGED_NOTE;

      return {
        content: [{ type: 'text' as const, text: msg }],
      };
    },
  );

  // --- check_freeze ---

  server.registerTool(
    'check_freeze',
    {
      description:
        'Check whether a specific plan is allowed to be worked on during an active freeze. ' +
        'Returns true if: no freeze is active, the freeze has expired, or the plan is in the exemption list. ' +
        'Agents should call this before claiming items to respect governance.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
        plan_uid: z.string().describe('UID of the plan to check.'),
      },
    },
    async ({ project_path, plan_uid }) => {
      const allowed = isPlanAllowedDuringFreeze(project_path, plan_uid);
      const status = getFreezeStatus(project_path);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            planUid: plan_uid,
            allowed,
            freezeActive: status.active,
            reason: status.reason,
            until: status.until,
          }, null, 2),
        }],
      };
    },
  );

  // --- exempt_plan_from_freeze ---

  server.registerTool(
    'exempt_plan_from_freeze',
    {
      description:
        'Add a plan to the freeze exemption list without changing the freeze state. ' +
        'Exempt plans can be worked on during a freeze (e.g., hotfix plans during release freeze).',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
        plan_uid: z.string().describe('UID of the plan to exempt.'),
      },
    },
    async ({ project_path, plan_uid }, extra: any) => {
      if (!deps.planService.getPlan(plan_uid)) {
        return { content: [{ type: 'text' as const, text: `Plan not found: ${plan_uid}` }], isError: true };
      }
      const { author, authorType } = authorFromExtra(deps, extra);
      const status = exemptPlanFromFreeze(project_path, plan_uid, { actor: author, actorType: authorType, channel: 'mcp' });
      deps.broadcast('freeze-changed', { projectRoot: project_path, status });

      return {
        content: [{
          type: 'text' as const,
          text: `Plan ${plan_uid} is now exempt from the freeze. ${status.allowedPlanUids.length} plan(s) total exempt.${FLAGGED_NOTE}`,
        }],
      };
    },
  );
}
