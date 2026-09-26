/**
 * Graph visual control tools — focus, select, mode, scope, layout, depth, export, snapshot.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'graph_focus',
    {
      description:
        'Focus the dependency graph on a specific file or directory. Pans and zooms the graph canvas to center the target node. ' +
        'Use this to visually show the user a specific part of the architecture.',
      inputSchema: {
        path: z.string().describe('Relative path of the file or directory to focus on (e.g. "src/backend/services/plan-item-service.ts").'),
        highlight: z.boolean().optional().describe('Briefly highlight the node with a glow effect. Default true.'),
      },
    },
    async ({ path: targetPath, highlight }) => {
      deps.broadcast('ui-graph-focus', { path: targetPath, highlight: highlight !== false });
      return { content: [{ type: 'text' as const, text: `Focused graph on ${targetPath}` }] };
    },
  );

  server.registerTool(
    'graph_set_mode',
    {
      description:
        'Set the graph trellis mode — changes the overlay displayed on the dependency graph. ' +
        '"live" = current state, "baseline" = snapshot comparison, "planned" = show plan targets, "diff" = show changes.',
      inputSchema: {
        mode: z.enum(['live', 'baseline', 'planned', 'diff']).describe('Trellis overlay mode.'),
      },
    },
    async ({ mode }) => {
      // The renderer calls the Baseline view 'current' (TrellisMode). It
      // was sent 'baseline', a mode it doesn't have: no button lit up and
      // the Baseline view never rendered.
      deps.broadcast('ui-graph-mode', { mode: mode === 'baseline' ? 'current' : mode });
      return { content: [{ type: 'text' as const, text: `Set graph mode to ${mode}` }] };
    },
  );

  server.registerTool(
    'graph_set_scope',
    {
      description:
        'Set the graph scope filter to show only files under a specific directory or package path. ' +
        'Pass an empty string to clear the scope and show the full graph.',
      inputSchema: {
        scope_path: z.string().describe('Directory path to scope to (e.g. "src/backend/services"). Empty string to clear.'),
      },
    },
    async ({ scope_path }) => {
      deps.broadcast('ui-graph-scope', { scopePath: scope_path });
      return { content: [{ type: 'text' as const, text: scope_path ? `Scoped graph to ${scope_path}` : 'Cleared graph scope' }] };
    },
  );

  server.registerTool(
    'graph_select',
    {
      description:
        'Select one or more nodes on the dependency graph by their file/directory path. ' +
        'Mirrors shift-click multi-select. Selected nodes can then be used with "Plan these" or "Add to task" actions. ' +
        'Pass an empty array to clear the selection.',
      inputSchema: {
        paths: z.array(z.string()).describe(
          'Array of relative file or directory paths to select (e.g. ["src/backend/server.ts", "src/frontend/App.tsx"]). Empty array to clear.',
        ),
      },
    },
    async ({ paths }) => {
      deps.broadcast('ui-graph-select', { paths });
      const msg = paths.length === 0
        ? 'Cleared graph selection'
        : `Selected ${paths.length} node(s) on graph`;
      return { content: [{ type: 'text' as const, text: msg }] };
    },
  );

  server.registerTool(
    'graph_set_layout',
    {
      description:
        'Switch the graph layout algorithm. "map" = force-directed (d3-force) layout for organic exploration. ' +
        '"tree" = hierarchical (dagre) layout for structured top-down view.',
      inputSchema: {
        layout: z.enum(['map', 'tree']).describe('Layout algorithm: "map" (force-directed) or "tree" (hierarchical dagre).'),
      },
    },
    async ({ layout }) => {
      deps.broadcast('ui-graph-layout', { layout });
      return { content: [{ type: 'text' as const, text: `Set graph layout to ${layout}` }] };
    },
  );

  server.registerTool(
    'graph_set_depth',
    {
      description:
        'Set the graph view depth — controls what level of detail is shown. ' +
        '"package" = show only packages/directories (highest level). ' +
        '"file" = show individual files within packages. ' +
        '"symbol" = show classes, functions, and methods within files (most detailed).',
      inputSchema: {
        depth: z.enum(['package', 'file', 'symbol']).describe('View depth level.'),
      },
    },
    async ({ depth }) => {
      deps.broadcast('ui-graph-depth', { depth });
      return { content: [{ type: 'text' as const, text: `Set graph view depth to ${depth}` }] };
    },
  );

  server.registerTool(
    'graph_toggle_projection',
    {
      description:
        'Toggle the plan projection overlay on the dependency graph. When enabled, the graph highlights files and symbols ' +
        'that are targeted by the active plan (Planned/Diff trellis modes). When disabled, shows the raw dependency graph.',
      inputSchema: {
        enabled: z.boolean().optional().describe('Explicitly set projection on or off. If omitted, toggles the current state.'),
      },
    },
    async ({ enabled }) => {
      deps.broadcast('ui-graph-toggle-projection', { enabled });
      const label = enabled === true ? 'enabled' : enabled === false ? 'disabled' : 'toggled';
      return { content: [{ type: 'text' as const, text: `Projection ${label}` }] };
    },
  );

  server.registerTool(
    'graph_export',
    {
      description:
        'Export the current graph view as a PNG image. Returns the graph canvas as a base64-encoded image. ' +
        'Useful for saving a visual snapshot of the architecture or sharing with team members.',
      inputSchema: {},
    },
    async () => {
      const nonce = `ge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const p = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          deps.pendingResponses.delete(nonce);
          reject(new Error('Graph export timed out — is the CodeTrellis UI open with the graph visible?'));
        }, 10_000);
        deps.pendingResponses.set(nonce, { resolve, reject, timer });
      });

      deps.broadcast('ui-screenshot-request', { nonce, panel: 'graph' });

      try {
        const base64 = await p;
        return {
          content: [{
            type: 'image' as const,
            data: base64,
            mimeType: 'image/png',
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    },
  );

  server.registerTool(
    'graph_snapshot',
    {
      description:
        'Return a structured JSON snapshot of the current graph data — all nodes and edges with their types, ' +
        'paths, and relationships. Use this to programmatically analyse the architecture without needing the visual canvas. ' +
        'Much lighter than a screenshot and gives exact data for reasoning about dependencies.',
      inputSchema: {
        include_metadata: z.boolean().optional().describe('Include full metadata for each node (default false — keeps response compact).'),
      },
    },
    async ({ include_metadata }) => {
      const nonce = `gs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const p = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          deps.pendingResponses.delete(nonce);
          reject(new Error('Graph snapshot timed out — is the CodeTrellis UI open?'));
        }, 10_000);
        deps.pendingResponses.set(nonce, { resolve, reject, timer });
      });

      // Metadata only when asked, as the description says. `!== false`
      // made the "compact" default the full dump.
      deps.broadcast('ui-graph-snapshot-request', { nonce, includeMetadata: include_metadata === true });

      try {
        const json = await p;
        return { content: [{ type: 'text' as const, text: json }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    },
  );
}
