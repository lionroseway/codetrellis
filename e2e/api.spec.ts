import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

test.describe('Backend API', () => {
  test('health check returns ok', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('stats endpoint returns counts', async ({ request }) => {
    const res = await request.get(`${API}/stats`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('fileCount');
    expect(body).toHaveProperty('symbolCount');
  });

  test('MCP status returns running', async ({ request }) => {
    const res = await request.get(`${API}/mcp/status`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.running).toBe(true);
    expect(body.port).toBe(19432);
  });

  test('MCP config returns SSE URL', async ({ request }) => {
    const res = await request.get(`${API}/mcp/config`);
    const body = await res.json();
    expect(body.codetrellis.type).toBe('sse');
    expect(body.codetrellis.url).toContain('19432');
  });
});
