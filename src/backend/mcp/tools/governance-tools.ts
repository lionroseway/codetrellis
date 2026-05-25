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
import {
  getFreezeStatus,
  setFreeze,
  isPlanAllowedDuringFreeze,
  exemptPlanFromFreeze,
} from '../../services/freeze-service';

export function register(server: McpServer, deps: ToolDeps): void {
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
    async ({ project_path, active, reason, until, allowed_plan_uids }) => {
      const status = setFreeze(project_path, {
        active,
        reason,
        until,
        allowedPlanUids: allowed_plan_uids,
      });

      deps.broadcast('freeze-changed', { projectRoot: project_path, status });

      const msg = active
        ? `Freeze activated${reason ? `: ${reason}` : ''}${until ? ` (expires ${until})` : ' (indefinite)'}. ${(allowed_plan_uids ?? []).length} plan(s) exempt.`
        : 'Freeze lifted.';

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
    async ({ project_path, plan_uid }) => {
      const status = exemptPlanFromFreeze(project_path, plan_uid);
      deps.broadcast('freeze-changed', { projectRoot: project_path, status });

      return {
        content: [{
          type: 'text' as const,
          text: `Plan ${plan_uid} is now exempt from the freeze. ${status.allowedPlanUids.length} plan(s) total exempt.`,
        }],
      };
    },
  );
}
