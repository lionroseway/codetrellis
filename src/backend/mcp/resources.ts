/**
 * MCP resource registrations — skill guides, graph data, plan list, sessions, stats.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './types';

export function register(server: McpServer, deps: ToolDeps): void {
  // Agent skill / "how to use this product" guides. Agents can fetch
  // these on connect so they don't need out-of-band briefing on what
  // CodeTrellis is or how to operate it. Three flavors:
  //   - codetrellis://skill              → project-state-tailored summary
  //   - codetrellis://skill/quickstart   → first-time agent flow
  //   - codetrellis://skill/power-user   → deep usage (phases, drift, multi-agent)

  server.registerResource(
    'codetrellis://skill',
    'codetrellis://skill',
    {
      description: 'How to use CodeTrellis — tailored summary of plans, spec docs, systems, and active sessions in this project.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://skill',
        mimeType: 'text/markdown',
        text: deps.buildSkillGuide('summary'),
      }],
    }),
  );

  server.registerResource(
    'codetrellis://skill/quickstart',
    'codetrellis://skill/quickstart',
    {
      description: 'CodeTrellis quickstart for AI coding agents — basic flow: read the active plan, claim a task, do the work, mark it done.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://skill/quickstart',
        mimeType: 'text/markdown',
        text: deps.buildSkillGuide('quickstart'),
      }],
    }),
  );

  server.registerResource(
    'codetrellis://skill/power-user',
    'codetrellis://skill/power-user',
    {
      description: 'CodeTrellis power-user guide for AI coding agents — spec docs, drift verification, multi-agent coordination, granular task fields.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://skill/power-user',
        mimeType: 'text/markdown',
        text: deps.buildSkillGuide('power-user'),
      }],
    }),
  );

  server.registerResource(
    'codetrellis://skill/ui-nav',
    'codetrellis://skill/ui-nav',
    {
      description: 'CodeTrellis UI navigator skill — focused guide for a sub-agent that drives the UI while the primary agent works. Covers views, graph control, item navigation, and common sequences.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://skill/ui-nav',
        mimeType: 'text/markdown',
        text: deps.buildSkillGuide('ui-nav'),
      }],
    }),
  );

  server.registerResource(
    'project://graph',
    'project://graph',
    {
      description: 'Current dependency graph as JSON — all file-to-file import edges',
      mimeType: 'application/json',
    },
    async () => {
      const edges = deps.getDependencyEdges();
      const stats = deps.getDbStats();
      return {
        contents: [{
          uri: 'project://graph',
          mimeType: 'application/json',
          text: JSON.stringify({ stats, edges }, null, 2),
        }],
      };
    },
  );

  server.registerResource(
    'codetrellis://plans',
    'codetrellis://plans',
    {
      description: 'List of all plans in CodeTrellis',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://plans',
        mimeType: 'application/json',
        text: JSON.stringify(deps.planService.listPlans(), null, 2),
      }],
    }),
  );

  server.registerResource(
    'codetrellis://sessions',
    'codetrellis://sessions',
    {
      description: 'Active agent sessions connected to CodeTrellis',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://sessions',
        mimeType: 'application/json',
        text: JSON.stringify(deps.sessionService.getActiveSessions(), null, 2),
      }],
    }),
  );

  server.registerResource(
    'project://stats',
    'project://stats',
    {
      description: 'Database statistics — file count, symbol count, import count',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'project://stats',
        mimeType: 'application/json',
        text: JSON.stringify(deps.getDbStats(), null, 2),
      }],
    }),
  );
}
