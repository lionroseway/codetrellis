/**
 * Project-config tools — Phase 1.1 of the CDev target architecture.
 *
 * Two tools (`get_project_config`, `update_project_config`) exposing the
 * per-project config that lives at `<projectRoot>/.codetrellis/config.json`.
 * Effective settings resolve per-item > per-project > per-user; these
 * tools manage the per-project layer.
 *
 * See docs/cdev/14-configuration-and-personal-continuity.md.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';

export function register(server: McpServer, deps: ToolDeps): void {
  // --- get_project_config ---

  server.registerTool(
    'get_project_config',
    {
      description:
        'Read the per-project config at <projectRoot>/.codetrellis/config.json. ' +
        'Returns the project-level overrides (currently: plan default visibility, attachment location) ' +
        'and the effective values after resolving precedence per-project > per-user. ' +
        'Use this to see what conventions the team has agreed on for the project, and how they ' +
        'differ from your per-user defaults.',
      inputSchema: {
        project_root: z.string().describe(
          'Absolute path to the project root. The config is read from <project_root>/.codetrellis/config.json.',
        ),
      },
    },
    async ({ project_root }) => {
      const config = deps.projectConfigService.getProjectConfig(project_root);
      const effective = {
        plans: {
          defaultVisibility: deps.projectConfigService.getEffectiveDefaultVisibility(project_root),
          attachmentLocation: deps.projectConfigService.getEffectiveAttachmentLocation(project_root),
        },
      };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ projectConfig: config, effective }, null, 2),
          },
        ],
      };
    },
  );

  // --- update_project_config ---

  const channelRouteWhenSchema = z.object({
    eventType: z.enum(['stuck', 'need-decision', 'need-context', 'handing-off', 'steer', 'weigh-in']).optional(),
    status: z.enum(['open', 'resolved', 'dismissed']).optional(),
    planUid: z.string().optional(),
    itemUid: z.string().optional(),
    minAgeMs: z.number().optional(),
  });

  const channelRouteToastSchema = z.object({
    target: z.literal('in-app-toast'),
    tone: z.enum(['info', 'warning', 'error']).optional(),
    sticky: z.boolean().optional(),
  });

  const channelRouteWebhookSchema = z.object({
    target: z.literal('webhook'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  });

  const channelRoutingRuleSchema = z.object({
    id: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    when: channelRouteWhenSchema,
    notify: z.union([channelRouteToastSchema, channelRouteWebhookSchema]),
  });

  server.registerTool(
    'update_project_config',
    {
      description:
        'Update the per-project config at <projectRoot>/.codetrellis/config.json. ' +
        'Pass only the fields you want to change — unmentioned top-level sections are preserved. ' +
        '`channels.routing` is replaced wholesale when present (no array merge), so callers wanting to add ' +
        'a rule should read the current list first and write it back with the new rule appended. ' +
        'Project-level overrides win over the per-user defaults. ' +
        'The config file is committed to the manifest like any other plan content; teams can review changes through normal PR flow.',
      inputSchema: {
        project_root: z.string().describe(
          'Absolute path to the project root. The config is written to <project_root>/.codetrellis/config.json.',
        ),
        plans: z
          .object({
            defaultVisibility: z
              .enum(['shared', 'local'])
              .optional()
              .describe('Override the default visibility of new plans. "shared" = export to .codetrellis/plans/, "local" = DB-only.'),
            attachmentLocation: z
              .enum(['project', 'user'])
              .optional()
              .describe('Override where binary attachments live. "project" = in the repo, "user" = in the user data dir.'),
          })
          .optional()
          .describe('Plan-related project-level overrides.'),
        channels: z
          .object({
            routing: z.array(channelRoutingRuleSchema).optional().describe(
              'Channel routing rules — list of {when, notify} rules evaluated when a channel event is posted. ' +
                'Each rule has a `when` clause (filters by eventType / status / planUid / itemUid / minAgeMs) and a ' +
                '`notify` target (`in-app-toast` for elevated toasts, or `webhook` for an HTTP POST to a user-controlled URL). ' +
                'Set `enabled: false` to keep a rule parsed but inactive. Replacement is wholesale; pass the full intended array.',
            ),
          })
          .optional()
          .describe('Channel-related project-level overrides.'),
      },
    },
    async ({ project_root, plans, channels }) => {
      const patch: any = {};
      if (plans) patch.plans = plans;
      if (channels) patch.channels = channels;
      const updated = deps.projectConfigService.updateProjectConfig(project_root, patch);
      deps.broadcast('project-config-changed', { projectRoot: project_root, config: updated });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ projectConfig: updated }, null, 2),
          },
        ],
      };
    },
  );
}
