import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';
const PROJECT_PATH = process.cwd();

test.describe('Project scanning', () => {
  test('scan project returns file tree and AST stats', async ({ request }) => {
    const res = await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.fileCount).toBeGreaterThan(0);
    expect(body.fileTree).toBeTruthy();
    expect(body.astStats).toBeTruthy();
    expect(body.astStats.symbolCount).toBeGreaterThan(0);
  });

  test('dependencies are resolved after scan', async ({ request }) => {
    const res = await request.get(`${API}/dependencies`);
    const edges = await res.json();
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0]).toHaveProperty('sourceRelative');
    expect(edges[0]).toHaveProperty('targetRelative');
  });

  test('symbol search returns results', async ({ request }) => {
    const res = await request.get(`${API}/symbols/search?q=broadcast`);
    const symbols = await res.json();
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols[0].name).toBe('broadcast');
  });

  test('file symbols returns parsed functions', async ({ request }) => {
    const res = await request.get(`${API}/symbols/file?path=${PROJECT_PATH}/src/backend/server.ts`);
    const symbols = await res.json();
    expect(symbols.length).toBeGreaterThan(0);
    const names = symbols.map((s: any) => s.name);
    expect(names).toContain('broadcast');
  });

  test('git branch detection works', async ({ request }) => {
    const res = await request.get(`${API}/git/branch?path=${PROJECT_PATH}`);
    const body = await res.json();
    expect(body.branch).toBeTruthy();
  });

  test('directory browse works', async ({ request }) => {
    const res = await request.get(`${API}/fs/browse?path=${PROJECT_PATH}`);
    const body = await res.json();
    expect(body.current).toBe(PROJECT_PATH);
    expect(body.dirs.length).toBeGreaterThan(0);
  });
});
