/**
 * Phase 32 stage 0.2 — the inventory is correct, complete and current.
 *
 * The extractors are tested on small fixtures. The last two tests run the
 * real thing: every row has a domain, and the committed matrix is what the
 * generator produces today, so the matrix can't silently drift from the code.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  domainForComponent,
  domainForRoute,
  domainForRpc,
  domainForTool,
  extractRoutes,
  extractRpcMethods,
  extractSettingsSections,
  extractToolSections,
  callsIn,
  callsRoute,
  filesCalling,
  helperChunks,
  invokedNames,
  reconcileTools,
  routePattern,
} from './extract';

describe('extraction', () => {
  test('routes: every verb, single- and multi-line, any quote', () => {
    const src = [
      "app.get('/api/plans', h);",
      'app.post(\n  "/api/plans/:uid/claim",\n  h);',
      'app.delete(`/api/items/:uid`, h);',
      "router.get('/not-app', h);",
    ].join('\n');
    assert.deepEqual(extractRoutes(src), [
      { method: 'GET', path: '/api/plans' },
      { method: 'POST', path: '/api/plans/:uid/claim' },
      { method: 'DELETE', path: '/api/items/:uid' },
    ]);
  });

  test('tool sections follow the ── <file>-tools ── headings', () => {
    const src = `export const TOOL_CAPABILITIES = Object.freeze({
  // ── plan-tools ──────────
  list_plans: 'read',
  create_plan: 'write',
  // ── terminal-tools ──────
  terminal_create: 'terminal',
});`;
    const m = extractToolSections(src);
    assert.equal(m.get('list_plans'), 'plan');
    assert.equal(m.get('create_plan'), 'plan');
    assert.equal(m.get('terminal_create'), 'terminal');
    assert.equal(m.size, 3);
  });

  test('RPC methods with their capability', () => {
    const src = `export const METHOD_CAPABILITIES = Object.freeze({
  // ── read ──
  'plan.list': 'read',
  'terminal.write': 'terminal',
});`;
    assert.deepEqual(extractRpcMethods(src), [
      { method: 'plan.list', capability: 'read' },
      { method: 'terminal.write', capability: 'terminal' },
    ]);
  });

  test('settings sections from the Section union', () => {
    assert.deepEqual(extractSettingsSections("type Section = 'identity' | 'mcp' | 'about';"), ['identity', 'mcp', 'about']);
    assert.deepEqual(extractSettingsSections('nothing here'), []);
  });
});

describe('domains', () => {
  test('routes by first /api segment; unknown is null, never guessed', () => {
    assert.equal(domainForRoute('/api/plans/:uid'), 'c');
    assert.equal(domainForRoute('/api/criteria/:uid/decide'), 'd');
    assert.equal(domainForRoute('/api/no-such-area'), null);
    // Nested under a plan by URL, owned by another domain.
    assert.equal(domainForRoute('/api/plans/:uid/signoff-pack.html'), 'd');
    assert.equal(domainForRoute('/api/plans/:uid/worklist'), 'd');
    assert.equal(domainForRoute('/api/plans/:uid/budget/check'), 'g');
    assert.equal(domainForRoute('/api/items/:uid/artefacts'), 'e');
  });

  test('tools: name overrides beat the registering file', () => {
    assert.equal(domainForTool('submit_criterion', 'plan-item'), 'd');
    assert.equal(domainForTool('get_brief', 'plan-item'), 'e');
    assert.equal(domainForTool('claim_item', 'plan-item'), 'c');
    assert.equal(domainForTool('mystery', undefined), null);
    // Project lifecycle, whichever file registers it; not graph projection.
    assert.equal(domainForTool('rescan_project', 'session'), 'a');
    assert.equal(domainForTool('open_project', 'ui'), 'a');
    assert.equal(domainForTool('list_recent_projects', 'session'), 'a');
    assert.equal(domainForTool('refresh_repo_origin', 'session'), 'a');
    assert.equal(domainForTool('graph_toggle_projection', 'graph'), 'b');
  });

  test('RPC by area prefix; components by top directory, root files are g', () => {
    assert.equal(domainForRpc('terminal.write'), 'i');
    assert.equal(domainForRpc('nope.x'), null);
    assert.equal(domainForComponent('plan/v2/PlanSwitcher.tsx'), 'c');
    assert.equal(domainForComponent('App.tsx'), 'g');
  });
});

describe('test references', () => {
  test('a route pattern matches strings and template literals, one segment per param', () => {
    const p = routePattern('/api/plans/:uid');
    assert.ok(p.test("get('/api/plans/abc')"));
    assert.ok(p.test('get(`/api/plans/${uid}`)'));
    assert.ok(p.test("get('/api/plans/abc?x=1')"));
    assert.ok(!p.test('get(`/api/plans/${uid}/timeline`)'), 'a longer path is a different route');
    assert.ok(!routePattern('/api/plans').test('get(`/api/plans/${uid}`)'));
  });

  test('a test is credited with what its helper methods send', () => {
    const helper = `export function createClient() {
  return {
    async getBuildInfo() {
      return json('GET', '/api/build-info');
    },
    async getPlan(uid) {
      return json('GET', \`/api/plans/\${uid}\`);
    },
  };
}`;
    const chunks = helperChunks(helper);
    assert.deepEqual(chunks.map((c) => c.name).filter((n) => n !== 'createClient'), ['getBuildInfo', 'getPlan']);
    const helpers = chunks.map((c) => ({ name: c.name, calls: callsIn(c.body) }));
    const files = new Map(
      [
        ['a.test.ts', 'await client.getBuildInfo();'],
        ['b.test.ts', "await fetch('/api/build-info')"],
        ['c.test.ts', "// nothing relevant, though it mentions '/api/build-info'"],
      ].map(([f, text]) => [f, { text, calls: callsIn(text) }]),
    );
    const hit = (c: ReturnType<typeof callsIn>) => callsRoute(c, 'GET', '/api/build-info');
    assert.deepEqual(filesCalling(hit, files), ['b.test.ts']);
    assert.deepEqual(filesCalling(hit, files, helpers), ['a.test.ts', 'b.test.ts']);
  });
});

describe('reconciliation', () => {
  test('stale rows and unauthorised tools are both named', () => {
    const r = reconcileTools(['a', 'b', 'c'], ['b', 'c', 'd']);
    assert.deepEqual(r.staleRows, ['d']);
    assert.deepEqual(r.unauthorised, ['a']);
    assert.equal(r.registered, 3);
    assert.equal(r.matrixRows, 3);
  });
});

describe('the committed matrix', () => {
  test('every row has a domain, and docs/PHASE-32-VERIFICATION.md is current', async () => {
    const { build } = await import('./run');
    const { markdown, unmapped } = await build();
    assert.deepEqual(
      unmapped.map((r) => `${r.surface} ${r.id}`),
      [],
      'rows with no domain — add them to tools/inventory/extract.ts',
    );
    const committed = fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'PHASE-32-VERIFICATION.md'), 'utf8');
    assert.ok(committed === markdown, 'docs/PHASE-32-VERIFICATION.md is stale — run `npm run inventory` and commit it');
  });
});

describe('a test is credited with what it sends, not what it mentions (bug 49)', () => {
  test('a tool or RPC name counts where it is sent, not where a fixture or a check names it', () => {
    const names = invokedNames(`
      await agent.callTool('create_plan', { title: 'x' });
      await phone.rpc('plan.list');
      await phone.rpcError('plan.delete', { uid });
      await client.callTool({ name: 'list_recent_projects', arguments: {} });
      await mobile.handleBudgetMethod('budget.get', params);
      const e = toolCall('search_items', { query: 'EMEA' }, 1000);
      assertMcpMayCall('get_brief', grants);
      expect(names).toContain('claim_item');
      // agent.callTool('in_a_comment')
    `);
    assert.deepEqual([...names].sort(), ['budget.get', 'create_plan', 'list_recent_projects', 'plan.delete', 'plan.list']);
  });

  test('a call with type arguments is a call: phone.rpc<T>(…) is credited, a comparison is not (A4.2)', () => {
    const names = invokedNames(`
      const got = await phone.rpc<{ hits: Hit[]; map: Map<string, (x: number) => void> }>('awareness.needsYou');
      const one = await phone.rpc<Detail>('awareness.signal', { id });
      if (rpc < limit) log('not.a.call');
    `);
    assert.deepEqual([...names].sort(), ['awareness.needsYou', 'awareness.signal']);
  });

  test("a test's own wrappers around callTool are callers, a wrapper of a wrapper too", () => {
    const names = invokedNames(`
      const json = async (tool: string, args: Record<string, unknown>) => {
        const res = await agent.callTool(tool, args);
        return JSON.parse(res.text);
      };
      const refused = (tool, args) => json(tool, args).catch(() => null);
      function viaAgent(a, tool) { return a.callTool(tool, {}); }
      await json('get_plan', { uid });
      await refused('delete_plan', {});
      await viaAgent(other, 'list_plans');
    `);
    assert.deepEqual([...names].sort(), ['delete_plan', 'get_plan', 'list_plans']);
  });

  test('a loop sends every name it passes to a caller; a table sends the column it passes', () => {
    const names = invokedNames(`
      for (const tool of ['open_plan', 'refresh_ui']) await agent.callTool(tool, {});
      const cases = [
        ['graph_focus', { path: 'a' }, 'ui-graph-focus'],
        ['graph_select', { paths: [] }, 'ui-graph-select'],
      ];
      for (const [tool, args, event] of cases) {
        await agent.callTool(tool, args);
        await events.waitFor(event);
      }
      for (const required of ['register_session', 'claim_item']) {
        expect(listed).toContain(required);
      }
    `);
    assert.deepEqual([...names].sort(), ['graph_focus', 'graph_select', 'open_plan', 'refresh_ui']);
  });

  test('a request counts for the method it sends, so GET does not cover PUT on the same path', () => {
    const calls = callsIn(`
      await h.client.raw('GET', \`/api/plans/\${uid}/budget\`);
      const req = async (method: string, url: string) => (await h.client.raw(method, url)).json();
      await req('DELETE', \`/api/items/\${uid}\`);
      await get('/api/artefacts/abc/content');
      await fetch(h.backend.baseUrl + \`/api/plans/\${uid}/signoff-pack/verify\`, { method: 'POST', body });
      await authFetch(h.backend, '/api/health');
    `);
    assert.ok(callsRoute(calls, 'GET', '/api/plans/:uid/budget'));
    assert.ok(!callsRoute(calls, 'PUT', '/api/plans/:uid/budget'));
    assert.ok(callsRoute(calls, 'DELETE', '/api/items/:uid'));
    assert.ok(!callsRoute(calls, 'GET', '/api/items/:uid'));
    assert.ok(callsRoute(calls, 'GET', '/api/artefacts/:uid/content'));
    assert.ok(callsRoute(calls, 'POST', '/api/plans/:uid/signoff-pack/verify'));
    assert.ok(callsRoute(calls, 'GET', '/api/health'));
  });

  test('a route defined in a fixture is not a request; a table of endpoints its loop requests is', () => {
    const calls = callsIn(`
      app.post('/api/terminals', handler);
      router.get('/api/recent-projects', handler);
      const rows = [{ method: 'GET', url: '/api/health' }];
      const ENDPOINTS = [
        { name: 'systems', path: () => '/api/systems' },
        { name: 'review', path: (uid: string) => \`/api/plans/\${uid}/review\` },
      ];
      for (const ep of ENDPOINTS) {
        const res = await h.client.raw('GET', ep.path(uid));
      }
    `);
    assert.ok(!callsRoute(calls, 'POST', '/api/terminals'));
    assert.ok(!callsRoute(calls, 'GET', '/api/recent-projects'));
    assert.ok(callsRoute(calls, 'GET', '/api/health'));
    assert.ok(callsRoute(calls, 'GET', '/api/systems'));
    assert.ok(callsRoute(calls, 'GET', '/api/plans/:uid/review'));
  });
});
