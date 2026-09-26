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
  filesMatching,
  filesReaching,
  helperChunks,
  quotedPattern,
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

  test('a quoted name needs its quotes, so prose does not count', () => {
    const p = quotedPattern('project.list');
    assert.ok(p.test("rpc('project.list')"));
    assert.ok(!p.test('the opened project.list would make it impossible'));
  });

  test('a test is credited with what its helper methods reach', () => {
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
    const files = new Map([
      ['a.test.ts', 'await client.getBuildInfo();'],
      ['b.test.ts', "await fetch('/api/build-info')"],
      ['c.test.ts', 'nothing relevant'],
    ]);
    const p = routePattern('/api/build-info');
    assert.deepEqual(filesMatching(p, files), ['b.test.ts']);
    assert.deepEqual(filesReaching(p, files, chunks), ['a.test.ts', 'b.test.ts']);
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
