/**
 * Architecture query tools — search symbols, dependencies, conformity.
 */

import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { breachWords, checkEdges, edgesIfLoaded, rulesOf, rulesView } from '../../services/architecture-rules';

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'search_symbols',
    {
      description: 'Search for functions, classes, interfaces, and other symbols across the codebase by name',
      inputSchema: {
        query: z.string().describe('Symbol name to search for (substring match)'),
      },
    },
    async ({ query }) => {
      const results = deps.searchSymbols(query);
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'get_dependencies',
    {
      description: 'Get what a file imports and what imports it. Returns incoming and outgoing dependency edges.',
      inputSchema: {
        file_path: z.string().describe('Path to the file: absolute, or relative to the project root'),
      },
    },
    async ({ file_path }) => {
      const result = deps.getFileDependencies(file_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'check_architecture',
    {
      description: 'Query the codebase dependency graph. Returns all file-to-file import edges, showing how the codebase is connected.',
      inputSchema: {
        query: z.string().optional().describe('Optional: filter edges by file path substring'),
      },
    },
    async ({ query }) => {
      let edges = deps.getDependencyEdges();
      if (query) {
        edges = edges.filter(
          (e) => e.sourceRelative.includes(query) || e.targetRelative.includes(query),
        );
      }
      const stats = deps.getDbStats();
      return { content: [{ type: 'text' as const, text: JSON.stringify({ stats, edges }, null, 2) }] };
    },
  );

  server.registerTool(
    'list_cross_system_edges',
    {
      description: 'Cross-system edges — non-import couplings between files inferred from runtime patterns. Today: HTTP fetches in TS/JS matched against FastAPI/Flask routes in Python (more protocols coming: SQL refs, subprocess, env-configured URLs, OpenAPI contracts). Use this to see how the frontend talks to the backend even when no import edges exist.',
      inputSchema: {},
    },
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ stats: deps.getCrossSystemStats(), edges: deps.listCrossSystemEdges() }, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'check_conformity',
    {
      description:
        'Check proposed imports before you write them: whether each would cross one of the team\'s architecture rules ' +
        '("web/ may not import db/", kept in .codetrellis/config.json, with why), or create a direct two-file cycle. ' +
        'A clean result means no rule is broken and no direct cycle made; list_rules shows the rules.',
      inputSchema: {
        proposed_imports: z.array(z.object({
          from: z.string().describe('File that would contain the import (absolute, or relative to the project root)'),
          importing: z.string().describe('File being imported (absolute, or relative to the project root)'),
        })).describe('List of proposed import relationships to check'),
        project_path: z.string().optional().describe('An opened project. Omit for the one open in the app.'),
      },
    },
    async ({ proposed_imports, project_path }) => {
      const root = project_path ?? deps.getActiveProjectPath();
      const edges = deps.getDependencyEdges();
      const edgeSet = new Set(edges.map((e) => `${e.sourceRelative}->${e.targetRelative}`));
      const violations: Array<{ rule: string; message: string; because?: string }> = [];

      // Edges are project-relative. An absolute path matched nothing, so
      // every proposal read as conformant — a false all-clear.
      const rel = (p: string): string => {
        const r = root && path.isAbsolute(p) ? path.relative(root, p) : p;
        return r.split(path.sep).join('/').replace(/^\.\//, '');
      };

      // Phase 32 A7.1 — the team's rules, checked first: they are the ones a person wrote down.
      const rules = root ? rulesOf(root) : [];
      for (const imp of proposed_imports) {
        const from = rel(imp.from);
        const to = rel(imp.importing);
        for (const b of checkEdges(rules, [{ from, to }])) {
          const rule = rules.find((r) => r.id === b.rule)!;
          violations.push({ rule: rule.id, message: breachWords(rule, b), ...(rule.because ? { because: rule.because } : {}) });
        }
        if (edgeSet.has(`${to}->${from}`)) {
          violations.push({
            rule: 'circular-dependency',
            message: `Adding ${imp.from} -> ${imp.importing} would create a circular dependency (${imp.importing} already imports ${imp.from})`,
          });
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            conformant: violations.length === 0,
            violations,
            checkedImports: proposed_imports.length,
            rules: rules.length,
          }, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'list_rules',
    {
      description:
        'The team\'s architecture rules (Phase 32 A7): path boundaries such as "web/ may not import db/ (except db/types.ts): ' +
        'web talks to db through the API", kept in the committed config, each with the imports that break it today. ' +
        'A person sets them in the app; this only reads. Check an import before writing it with check_conformity.',
      inputSchema: {
        project_path: z.string().optional().describe('An opened project. Omit for the one open in the app.'),
      },
    },
    async ({ project_path }) => {
      const root = project_path ?? deps.getActiveProjectPath();
      if (!root) return { isError: true, content: [{ type: 'text' as const, text: 'No project is open.' }] };
      const view = rulesView(root, edgesIfLoaded(root, deps.getActiveProjectPath(), deps.getDependencyEdges));
      return { content: [{ type: 'text' as const, text: JSON.stringify({ rules: view }, null, 2) }] };
    },
  );

}
