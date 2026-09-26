/**
 * The graph through MCP (Phase 32 §0.4b).
 *
 * Two halves:
 *
 * - The QUERY tools (search_symbols, get_dependencies, check_architecture,
 *   check_conformity, list_cross_system_edges) answer from the backend.
 *   The only earlier test of four of them asserted `toBeTruthy()` on the
 *   result, which an error result also passes. These assert the answers,
 *   including in the path form an agent is likely to send.
 *
 * - The VIEW tools (graph_focus … graph_toggle_projection) only broadcast
 *   to the renderer, and graph_snapshot / graph_export / ui_ready wait for
 *   the renderer to answer. Here the harness plays the renderer: it
 *   asserts each broadcast and answers the requests. The browser half is
 *   e2e/graph/mcp-view-tools.spec.ts.
 */

import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { setupHarness, openEventStream, type Harness, type EventStream, type ScriptedAgent } from '../harness';

const IMPORTER = 'packages/web/src/UserList.tsx';
const IMPORTED = 'packages/web/src/api.ts';

interface Deps {
  imports: Array<{ relativePath: string }>;
  importedBy: Array<{ relativePath: string }>;
}

test.describe.serial('Graph through MCP', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let events: EventStream;
  let agent: ScriptedAgent;
  let root: string;

  test.beforeAll(async () => {
    h = await setupHarness('graph-tools');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    events = await openEventStream(h.backend);
    agent = await h.spawnAgent({ agentType: 'graph-agent' });
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  // ── Queries ────────────────────────────────────────────────────────

  test('search_symbols finds a known function with its file', async () => {
    const res = await agent.callTool('search_symbols', { query: 'validateCreateUser' });
    expect(res.isError, res.text).not.toBe(true);
    const hits = JSON.parse(res.text) as Array<{ name: string; relativePath?: string; filePath?: string }>;
    const hit = hits.find((s) => s.name === 'validateCreateUser');
    expect(hit, res.text).toBeTruthy();
    expect(JSON.stringify(hit)).toContain('packages/shared/src/validators.ts');
  });

  test('get_dependencies answers for an absolute path', async () => {
    const res = await agent.callTool('get_dependencies', { file_path: path.join(root, IMPORTER) });
    const deps = JSON.parse(res.text) as Deps;
    expect(deps.imports.map((d) => d.relativePath)).toContain(IMPORTED);
  });

  test('get_dependencies answers the same for a project-relative path', async () => {
    // Agents speak in project-relative paths; so do the other graph tools.
    // This used to return empty lists, i.e. "no dependencies" — wrong.
    const abs = JSON.parse((await agent.callTool('get_dependencies', { file_path: path.join(root, IMPORTED) })).text) as Deps;
    const rel = JSON.parse((await agent.callTool('get_dependencies', { file_path: IMPORTED })).text) as Deps;
    expect(abs.importedBy.map((d) => d.relativePath)).toContain(IMPORTER);
    expect(rel).toEqual(abs);
  });

  test('GET /api/dependencies/file matches get_dependencies', async () => {
    const res = await h.client.raw('GET', `/api/dependencies/file?path=${encodeURIComponent(path.join(root, IMPORTER))}`);
    expect(res.ok).toBe(true);
    const viaRest = (await res.json()) as Deps;
    const viaMcp = JSON.parse((await agent.callTool('get_dependencies', { file_path: path.join(root, IMPORTER) })).text) as Deps;
    expect(viaRest).toEqual(viaMcp);
    expect(viaRest.imports.length).toBeGreaterThan(0);
  });

  test('check_architecture returns every edge, and a query narrows them', async () => {
    const all = JSON.parse((await agent.callTool('check_architecture', {})).text) as {
      stats: { fileCount: number }; edges: Array<{ sourceRelative: string; targetRelative: string }>;
    };
    expect(all.stats.fileCount).toBeGreaterThan(20);
    expect(all.edges).toContainEqual(expect.objectContaining({ sourceRelative: IMPORTER, targetRelative: IMPORTED }));

    const some = JSON.parse((await agent.callTool('check_architecture', { query: 'packages/web/' })).text) as typeof all;
    expect(some.edges.length).toBeGreaterThan(0);
    expect(some.edges.length).toBeLessThan(all.edges.length);
    for (const e of some.edges) expect(`${e.sourceRelative} ${e.targetRelative}`).toContain('packages/web/');
  });

  test('check_conformity flags the reverse of an existing import, and passes an unrelated one', async () => {
    const res = JSON.parse((await agent.callTool('check_conformity', {
      proposed_imports: [
        { from: IMPORTED, importing: IMPORTER },
        { from: 'packages/shared/src/types.ts', importing: 'packages/web/src/OrderList.tsx' },
      ],
    })).text) as { conformant: boolean; violations: Array<{ rule: string }>; checkedImports: number };
    expect(res.checkedImports).toBe(2);
    expect(res.conformant).toBe(false);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0].rule).toBe('circular-dependency');
  });

  test('check_conformity sees the same cycle when given absolute paths', async () => {
    // With absolute paths nothing matched the relative edge set, so every
    // proposal read as conformant — a false all-clear.
    const res = JSON.parse((await agent.callTool('check_conformity', {
      proposed_imports: [{ from: path.join(root, IMPORTED), importing: path.join(root, IMPORTER) }],
    })).text) as { conformant: boolean };
    expect(res.conformant).toBe(false);
  });

  test('list_cross_system_edges returns the fixture\'s HTTP pairings', async () => {
    const res = JSON.parse((await agent.callTool('list_cross_system_edges', {})).text) as {
      stats: Record<string, unknown>; edges: Array<{ label?: string }>;
    };
    expect(res.edges.length).toBeGreaterThan(0);
    expect(res.stats).toBeTruthy();
  });

  // ── View tools: the broadcast is the whole effect ─────────────────

  const VIEW: Array<[string, Record<string, unknown>, string, Record<string, unknown>]> = [
    ['graph_focus', { path: IMPORTER }, 'ui-graph-focus', { path: IMPORTER, highlight: true }],
    ['graph_focus', { path: IMPORTER, highlight: false }, 'ui-graph-focus', { path: IMPORTER, highlight: false }],
    ['graph_set_mode', { mode: 'planned' }, 'ui-graph-mode', { mode: 'planned' }],
    // The renderer's name for the Baseline view is 'current'.
    ['graph_set_mode', { mode: 'baseline' }, 'ui-graph-mode', { mode: 'current' }],
    ['graph_set_scope', { scope_path: 'packages/web' }, 'ui-graph-scope', { scopePath: 'packages/web' }],
    ['graph_set_scope', { scope_path: '' }, 'ui-graph-scope', { scopePath: '' }],
    ['graph_select', { paths: [IMPORTER, IMPORTED] }, 'ui-graph-select', { paths: [IMPORTER, IMPORTED] }],
    ['graph_set_layout', { layout: 'tree' }, 'ui-graph-layout', { layout: 'tree' }],
    ['graph_set_depth', { depth: 'symbol' }, 'ui-graph-depth', { depth: 'symbol' }],
    ['graph_toggle_projection', { enabled: true }, 'ui-graph-toggle-projection', { enabled: true }],
  ];

  for (const [tool, args, type, payload] of VIEW) {
    test(`${tool}(${JSON.stringify(args)}) broadcasts ${type}`, async () => {
      const before = events.ofType(type).length;
      const res = await agent.callTool(tool, args);
      expect(res.isError, res.text).not.toBe(true);
      await expect.poll(() => events.ofType(type).length).toBeGreaterThan(before);
      expect(events.ofType(type).at(-1)!.payload).toEqual(payload);
    });
  }

  test('the view tools reject values the renderer cannot apply', async () => {
    for (const [tool, args] of [
      ['graph_set_mode', { mode: 'sideways' }],
      ['graph_set_layout', { layout: 'spiral' }],
      ['graph_set_depth', { depth: 'atom' }],
    ] as const) {
      const res = await agent.callTool(tool, args);
      expect(res.isError, `${tool} accepted ${JSON.stringify(args)}`).toBe(true);
    }
  });

  // ── Request/response tools: the harness answers as the renderer ────

  async function answerNext(type: string, data: string): Promise<Record<string, unknown>> {
    const before = events.ofType(type).length;
    await expect.poll(() => events.ofType(type).length, { timeout: 5000 }).toBeGreaterThan(before);
    const payload = events.ofType(type).at(-1)!.payload as Record<string, unknown>;
    const res = await h.client.raw('POST', '/api/screenshot-response', { nonce: payload.nonce, data });
    expect(res.ok).toBe(true);
    return payload;
  }

  test('graph_snapshot returns what the renderer sends, and asks for metadata only when told to', async () => {
    const snapshot = JSON.stringify({ nodeCount: 1, edgeCount: 0, nodes: [{ id: IMPORTER }], edges: [] });

    const compact = agent.callTool('graph_snapshot', {});
    const asked = await answerNext('ui-graph-snapshot-request', snapshot);
    const res = await compact;
    expect(res.isError, res.text).not.toBe(true);
    expect(res.text).toBe(snapshot);
    // The description promises "default false — keeps response compact".
    expect(asked.includeMetadata).toBe(false);

    const full = agent.callTool('graph_snapshot', { include_metadata: true });
    expect((await answerNext('ui-graph-snapshot-request', snapshot)).includeMetadata).toBe(true);
    await full;
  });

  test('graph_export returns the renderer\'s PNG as an image', async () => {
    const png = Buffer.from('fake-png-bytes').toString('base64');
    const pending = agent.callTool('graph_export', {});
    const asked = await answerNext('ui-screenshot-request', png);
    expect(asked.panel).toBe('graph');
    const res = await pending;
    expect(res.isError, res.text).not.toBe(true);
    expect(res.content).toContainEqual(expect.objectContaining({ type: 'image', data: png, mimeType: 'image/png' }));
  });

  test('ui_ready passes the renderer\'s answer through', async () => {
    const answer = JSON.stringify({ ready: true, projectOpen: true });
    const pending = agent.callTool('ui_ready', {});
    await answerNext('ui-ready-request', answer);
    const res = await pending;
    expect(res.isError, res.text).not.toBe(true);
    expect(res.text).toBe(answer);
  });

  test('ui_ready with no window answering says so, rather than hanging', async () => {
    const started = Date.now();
    const res = await agent.callTool('ui_ready', {});
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.text)).toMatchObject({ ready: false });
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
