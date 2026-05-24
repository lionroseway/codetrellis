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

  server.registerTool(
    'update_project_config',
    {
      description:
        'Update the per-project config at <projectRoot>/.codetrellis/config.json. ' +
        'Pass only the fields you want to change — unmentioned fields are preserved. ' +
        'Project-level overrides win over the per-user defaults. Set a field to null to remove the override and fall through to the per-user setting (not yet supported — set the value explicitly for now). ' +
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
      },
    },
    async ({ project_root, plans }) => {
      const patch = plans ? { plans } : {};
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
