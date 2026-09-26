/**
 * MCP graph/analysis tools — search_symbols, get_dependencies,
 * list_cross_system_edges, check_architecture, check_conformity.
 *
 * They answer about whichever project was scanned LAST (the backend holds
 * one graph), so this spec opens the sample app itself and runs serially
 * (playwright.config SERIAL_SPECS). It used to assert only `toBeTruthy()`
 * — which an error result, or an answer about the wrong project, also
 * passes. tests/e2e/graph-tools.test.ts checks the same tools in depth
 * (Phase 32 §0.4b).
 */

import { test, expect } from '@playwright/test';
import { createMcpClient } from '../helpers/mcp-client';
import { openProject } from '../helpers/setup';
import { FIXTURE_PATH } from '../live-agent/helpers/fixture-reset';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await openProject(FIXTURE_PATH);
});

function json(result: any): any {
  expect(result?.isError, JSON.stringify(result)).not.toBe(true);
  const text = (result?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  return JSON.parse(text);
}

test.describe('MCP graph tools', () => {
  test('search_symbols finds a known function', async () => {
    const client = await createMcpClient();
    const hits = json(await client.callTool('search_symbols', { query: 'validateCreateUser' }));
    expect(hits.some((s: any) => s.name === 'validateCreateUser')).toBe(true);
    client.close();
  });

  test('get_dependencies answers for a project-relative path', async () => {
    const client = await createMcpClient();
    const deps = json(await client.callTool('get_dependencies', { file_path: 'packages/web/src/UserList.tsx' }));
    expect(deps.imports.map((d: any) => d.relativePath)).toContain('packages/web/src/api.ts');
    client.close();
  });

  test('list_cross_system_edges returns stats and edges', async () => {
    const client = await createMcpClient();
    const res = json(await client.callTool('list_cross_system_edges', {}));
    expect(res.stats).toBeTruthy();
    expect(Array.isArray(res.edges)).toBe(true);
    client.close();
  });

  test('check_architecture returns edges, narrowed by a query', async () => {
    const client = await createMcpClient();
    const all = json(await client.callTool('check_architecture', {}));
    const some = json(await client.callTool('check_architecture', { query: 'packages/web/' }));
    expect(all.edges.length).toBeGreaterThan(some.edges.length);
    expect(some.edges.length).toBeGreaterThan(0);
    client.close();
  });

  test('check_conformity flags the reverse of an existing import', async () => {
    const client = await createMcpClient();
    const { edges } = json(await client.callTool('check_architecture', { query: 'packages/web/src/UserList.tsx' }));
    const edge = edges.find((e: any) => e.sourceRelative === 'packages/web/src/UserList.tsx');
    expect(edge).toBeTruthy();
    const res = json(await client.callTool('check_conformity', {
      proposed_imports: [{ from: edge.targetRelative, importing: edge.sourceRelative }],
    }));
    expect(res.conformant).toBe(false);
    client.close();
  });
});
