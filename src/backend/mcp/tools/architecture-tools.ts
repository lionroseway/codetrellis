/**
 * Architecture query tools — search symbols, dependencies, conformity.
 */

import path from 'node:path';
import { z } from 'zod';
import { debtByRule } from '../../services/rules-overview';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { breachWords, checkEdges, edgesIfLoaded, findRule, proposedRule, RuleError, rulesOf, rulesView } from '../../services/architecture-rules';
import { previewChange, previewJson } from '../../services/rule-preview';
import { parseScope, scopeRules } from '../../services/rule-scope';
import { addRuleProposal } from '../../services/rule-proposals';
import { authorFromExtra } from '../helpers';

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
        '("web/ may not import db/", kept in .codetrellis/rules/<suite>.yaml, with why), or create a direct two-file cycle. ' +
        'suite, rule or path limits it to part of the rulebook. ' +
        'A clean result means no rule is broken and no direct cycle made; list_rules shows the rules.',
      inputSchema: {
        proposed_imports: z.array(z.object({
          from: z.string().describe('File that would contain the import (absolute, or relative to the project root)'),
          importing: z.string().describe('File being imported (absolute, or relative to the project root)'),
        })).describe('List of proposed import relationships to check'),
        project_path: z.string().optional().describe('An opened project. Omit for the one open in the app.'),
        suite: z.string().max(500).optional().describe('Check only these suites\' rules (comma-separated, like payments).'),
        rule: z.string().max(500).optional().describe('Check only these rules, by id (comma-separated).'),
        path: z.string().max(500).optional().describe('Check only the rules about these paths (comma-separated).'),
      },
    },
    async ({ proposed_imports, project_path, suite, rule: ruleIds, path: scopePath }) => {
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
      const rules = root ? scopeRules(rulesOf(root), parseScope({ suite, rule: ruleIds, path: scopePath })) : [];
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
        'web talks to db through the API", kept in committed suite files (.codetrellis/rules/<suite>.yaml), each with the imports that break it today. ' +
        'A person sets them in the app; this only reads. Check an import before writing it with check_conformity.',
      inputSchema: {
        project_path: z.string().optional().describe('An opened project. Omit for the one open in the app.'),
      },
    },
    async ({ project_path }) => {
      const root = project_path ?? deps.getActiveProjectPath();
      if (!root) return { isError: true, content: [{ type: 'text' as const, text: 'No project is open.' }] };
      const view = rulesView(root, edgesIfLoaded(root, deps.getActiveProjectPath(), deps.getDependencyEdges));
      // G7: each rule's debt (the baseline's old breaches), as the Rules view shows it.
      const debt = debtByRule(root);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ rules: view.map((v) => ({ ...v, debt: debt.get(v.rule.id) ?? 0 })) }, null, 2) }] };
    },
  );

  server.registerTool(
    'propose_rule',
    {
      description:
        'Propose a change to one of the team\'s architecture rules (Phase 33 R3): a new rule, a changed one, or stopping one (remove). ' +
        'Nothing changes: the proposal waits for a person, who sees what it would do against the code and accepts or rejects it in the app. ' +
        'Returns what it would do now, in the words the check uses. You cannot change a rule yourself, and editing .codetrellis/rules/ directly is ' +
        'caught by the check, which judges a branch by its base\'s rules.',
      inputSchema: {
        id: z.string().min(1).max(63).describe('The rule\'s id, a short slug like web-not-db: an existing rule to change or stop, or a new one.'),
        kind: z.enum(['imports', 'package', 'symbol', 'calls', 'folder', 'grep']).optional().describe('imports (the default): files in from may not import files in may_not_import. package: only the files in only may import the outside package named in package. symbol: only the files in only may import the export named in symbol, directly or through a barrel. calls: only the files in only may make the call named in calls. folder: the files in folder are named to files, of kinds, and export one name each when exports is one. grep: no line of the files in in may hold must_not, or each must hold must.'),
        from: z.string().max(300).optional().describe('The files it is about: a folder ending in / or a pattern. Required for an imports rule unless remove; for a package rule, where it applies (everywhere if omitted).'),
        may_not_import: z.string().max(300).optional().describe('What they may not import. Required for an imports rule unless remove.'),
        package: z.string().max(300).optional().describe('A package rule\'s outside package, ecosystem and name: npm:stripe, pypi:requests, go:github.com/stripe/stripe-go, maven:com.stripe.'),
        symbol: z.string().max(300).optional().describe('A symbol rule\'s export, a file and a name: src/payments/charge.ts#createCharge.'),
        calls: z.string().max(300).optional().describe('A call rule\'s call: http: and a host or path (http:api.stripe.com, http:/api/admin), or sql: and a table (sql:payments). A * makes it a glob: http:*.stripe.com, sql:payments_*.'),
        match: z.enum(['exact', 'glob', 'regex']).optional().describe('How a package, symbol or call rule\'s target is matched (B1): exact (the default), glob (a * in the target says so too), or regex over the whole entry, like http:api\\.(stripe|paypal)\\.com(/.*)?. For a grep rule, how its text is: exact (the default, literal, a * is a *), glob, or regex searched in each line.'),
        in: z.array(z.string().max(300)).max(50).optional().describe('A grep rule\'s files, like src/backend/ or src/routes/*.ts.'),
        must_not: z.string().max(200).optional().describe('A grep rule\'s text no line may hold, like console.log(.'),
        must: z.string().max(200).optional().describe('A grep rule\'s text each file must hold on some line, like requireAuth.'),
        ignore_case: z.boolean().optional().describe('A grep rule: read its text in any case.'),
        folder: z.string().max(300).optional().describe('A folder rule\'s folder, like src/backend/services/.'),
        files: z.array(z.string().max(100)).max(20).optional().describe('A folder rule\'s name patterns, like *-service.ts.'),
        kinds: z.array(z.string().max(20)).max(20).optional().describe('A folder rule\'s file kinds, by extension, like ts.'),
        exports: z.enum(['one']).optional().describe('A folder rule: one, each file exports one name.'),
        guide: z.string().max(1000).optional().describe('A folder rule\'s judgement half, in prose: shown to people and agents, never checked.'),
        only: z.array(z.string().max(300)).max(50).optional().describe('A package, symbol or call rule\'s files that alone may import it or make the call, like src/payments/index.ts.'),
        except: z.array(z.string().max(300)).max(50).optional().describe('Files they may import all the same.'),
        because: z.string().max(200).optional().describe('Why the rule exists, in the team\'s words.'),
        strength: z.enum(['block', 'warn', 'guide']).optional().describe('block fails the check; warn is said; guide is never checked. A new rule starts at warn.'),
        suite: z.string().max(63).optional().describe('The suite file it belongs in, like payments.'),
        remove: z.boolean().optional().describe('Propose stopping the rule.'),
        why: z.string().min(1).max(1000).describe('Why you propose it: what you found, and the evidence.'),
        project_path: z.string().optional().describe('An opened project. Omit for the one open in the app.'),
      },
    },
    async (args, extra: any) => {
      const root = args.project_path ?? deps.getActiveProjectPath();
      if (!root) return { isError: true, content: [{ type: 'text' as const, text: 'No project is open.' }] };
      const id = authorFromExtra(deps, extra);
      const body = args.remove ? null : {
        from: args.from, mayNotImport: args.may_not_import, except: args.except, because: args.because, strength: args.strength, suite: args.suite,
        ...(args.kind ? { kind: args.kind } : {}), ...(args.package ? { package: args.package } : {}), ...(args.only ? { only: args.only } : {}),
        ...(args.symbol ? { symbol: args.symbol } : {}), ...(args.calls ? { calls: args.calls } : {}), ...(args.match ? { match: args.match } : {}),
        ...(args.folder ? { folder: args.folder } : {}), ...(args.files ? { files: args.files } : {}), ...(args.kinds ? { kinds: args.kinds } : {}),
        ...(args.exports ? { exports: args.exports } : {}), ...(args.guide ? { guide: args.guide } : {}),
        ...(args.in ? { in: args.in } : {}), ...(args.must_not !== undefined ? { mustNot: args.must_not } : {}),
        ...(args.must !== undefined ? { must: args.must } : {}), ...(args.ignore_case !== undefined ? { ignoreCase: args.ignore_case } : {}),
      };
      try {
        if (!body && !findRule(root, args.id)) return { isError: true, content: [{ type: 'text' as const, text: `No architecture rule "${args.id}" in this project to stop.` }] };
        const next = body ? proposedRule(root, { ...body, id: args.id }, id.author).rule : null;
        const preview = previewChange(root, args.id, next, edgesIfLoaded(root, deps.getActiveProjectPath(), deps.getDependencyEdges, undefined, next ? [next] : []));
        if (!preview.change) return { isError: true, content: [{ type: 'text' as const, text: `${preview.words} Nothing to propose.` }] };
        const proposal = addRuleProposal({
          projectRoot: root, ruleId: args.id, body: body as Record<string, unknown> | null, why: args.why,
          effect: preview.change.effect, words: preview.words, author: id.author, authorType: id.authorType, sessionId: deps.sessionId ?? null,
        });
        deps.broadcast?.('rules-changed', { project: root });
        return {
          _meta: { summary: `Proposed a change to ${args.id}; a person decides` },
          content: [{ type: 'text' as const, text: JSON.stringify({
            proposal: proposal.uid, status: proposal.status, ...previewJson(preview),
            next: 'A person decides in the app. Until then the rule is as it was; carry on under it.',
          }, null, 2) }],
        };
      } catch (err) {
        if (err instanceof RuleError) return { isError: true, content: [{ type: 'text' as const, text: err.message }] };
        throw err;
      }
    },
  );
}
