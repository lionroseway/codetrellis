/**
 * The backend keeps an idle connection for a minute, not five seconds.
 *
 * Node's HTTP server closes a kept-alive socket after `keepAliveTimeout`,
 * 5 s by default. A client that sends on that socket as it closes gets
 * ECONNRESET, before the server ever sees the request: the browser suite's
 * request context did, on a PUT about five seconds after its last call
 * (#211). The window and the harness hold connections between calls, so
 * the server now keeps them for 65 s, and says so in the `Keep-Alive`
 * header it sends with every response.
 */

import http from 'node:http';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Keep-alive', () => {
  let h: Harness;

  test.beforeAll(async () => { h = await setupHarness('keep-alive'); });
  test.afterAll(async () => { await h?.teardown(); });

  const get = (agent: http.Agent) => new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1', port: h.backend.backendPort, path: '/api/health', agent,
      headers: { 'x-codetrellis-token': h.backend.capabilityToken },
    }, (res) => { res.resume(); res.on('end', () => resolve(res)); });
    req.on('error', reject);
  });

  test('the server says it keeps an idle connection for 65 s', async () => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const res = await get(agent);
      expect(res.statusCode).toBe(200);
      expect(res.headers['keep-alive']).toMatch(/timeout=65\b/);
    } finally {
      agent.destroy();
    }
  });

  test('a connection idle for longer than Node\'s old five seconds is still the same one, and still answers', async () => {
    test.setTimeout(30_000);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const first = await get(agent);
      const socket = first.socket;
      await new Promise((r) => setTimeout(r, 6_000));
      const second = await get(agent);
      expect(second.statusCode).toBe(200);
      // Reused: the server did not close it while it sat idle.
      expect(second.socket).toBe(socket);
    } finally {
      agent.destroy();
    }
  });
});
