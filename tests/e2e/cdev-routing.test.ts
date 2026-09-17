/**
 * CDev Phase 2.4 — channel routing + dispatcher integration test.
 *
 * Boots a tiny HTTP listener inside the test process to receive
 * webhook deliveries, configures a project with a routing rule
 * targeting that listener, then drives the dispatcher end-to-end:
 *
 *   1. Rule fires on a `stuck` event — webhook receives the JSON
 *      payload with rule metadata + full event row.
 *   2. Rule with a `steer` event_type filter does NOT fire on a
 *      stuck (rule filtering works).
 *   3. The `enabled: false` rule is parsed but not delivered.
 *   4. Per-project config replacement is wholesale on routing — a
 *      re-write with two rules is exactly two rules, not appended.
 */

import { test, expect } from '@playwright/test';
import http from 'node:http';
import { setupHarness } from '../harness';

interface ReceivedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: any;
}

test.describe('CDev Phase 2.4 — channel routing dispatcher', () => {
  test.setTimeout(120_000);

  test('webhook rule fires on matching channel event', async () => {
    const h = await setupHarness('cdev-routing-e2e');
    const received: ReceivedRequest[] = [];

    const listener = await startWebhookListener((req) => received.push(req));
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // Phase 19, finding 20 — a webhook URL comes from a file IN THE
      // REPOSITORY, so by default nothing is delivered anywhere. Delivering to
      // this test's listener means asking for exactly what a developer running
      // a local receiver would ask for: approve the host, and opt in to
      // loopback. Without both, the dispatcher refuses — which is the subject
      // of `webhook-ssrf.test.ts`.
      const listenerHost = new URL(listener.url).hostname;
      await h.client.raw('PUT', '/api/settings', {
        webhooks: { allowedHosts: [listenerHost], allowLoopback: true },
      });
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // 1. Configure a routing rule targeting our listener.
      //    Match on (eventType: 'stuck', status: 'open') so we fire on
      //    the initial post but NOT on the subsequent resolve. Rules
      //    match the event's current state, so without status: 'open'
      //    the rule would re-fire when status changes to resolved.
      const updateRes = await agent.callTool('update_project_config', {
        project_root: h.fixture.projectPath,
        channels: {
          routing: [
            {
              id: 'webhook-on-stuck',
              description: 'Notify the test listener on stuck events',
              when: { eventType: 'stuck', status: 'open' },
              notify: { target: 'webhook', url: listener.url },
            },
            {
              id: 'webhook-on-steer-disabled',
              when: { eventType: 'steer', status: 'open' },
              notify: { target: 'webhook', url: listener.url },
              enabled: false,
            },
          ],
        },
      });
      expect(updateRes.isError).not.toBe(true);

      // 2. Create a plan to post events against.
      const planRes = await agent.callTool('create_plan', {
        title: 'Routing test plan',
        description: 'Drives the dispatcher.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);

      // 3. Post a stuck — should trigger the webhook within the window.
      const stuckRes = await agent.callTool('post_channel_event', {
        plan_uid: plan.uid,
        event_type: 'stuck',
        message: 'Auth flow keeps timing out.',
        attempted: ['retry x3', 'increased timeout'],
      });
      const stuck = JSON.parse(stuckRes.text);

      await waitFor(() => received.length >= 1, 'webhook received the stuck delivery');

      const firstDelivery = received[0];
      expect(firstDelivery.method).toBe('POST');
      expect(firstDelivery.headers['content-type']).toContain('application/json');
      expect(firstDelivery.body.rule.id).toBe('webhook-on-stuck');
      expect(firstDelivery.body.event.uid).toBe(stuck.uid);
      expect(firstDelivery.body.event.eventType).toBe('stuck');
      expect(firstDelivery.body.event.payload.message).toBe('Auth flow keeps timing out.');
      expect(firstDelivery.body.event.payload.attempted).toEqual(['retry x3', 'increased timeout']);

      // 4. Post a steer — the matching rule is disabled, so no extra
      //    delivery should arrive. Brief settle window.
      await agent.callTool('post_channel_event', {
        plan_uid: plan.uid,
        event_type: 'steer',
        message: 'Try the new auth provider directly.',
        responds_to: stuck.uid,
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(received.length).toBe(1);

      // 5. Resolving the stuck doesn't match (no rule on 'resolved').
      await agent.callTool('resolve_channel_event', { event_uid: stuck.uid });
      await new Promise((r) => setTimeout(r, 500));
      expect(received.length).toBe(1);

      // 6. Wholesale routing replacement — set a single rule and
      //    confirm the previous two are gone.
      await agent.callTool('update_project_config', {
        project_root: h.fixture.projectPath,
        channels: {
          routing: [
            {
              id: 'webhook-on-weighin',
              when: { eventType: 'weigh-in', status: 'open' },
              notify: { target: 'webhook', url: listener.url },
            },
          ],
        },
      });

      // Post a stuck — no more rule matches it; receive count unchanged.
      await agent.callTool('post_channel_event', {
        plan_uid: plan.uid,
        event_type: 'stuck',
        message: 'Different reason.',
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(received.length).toBe(1);

      // Post a weigh-in — new rule matches.
      await agent.callTool('post_channel_event', {
        plan_uid: plan.uid,
        event_type: 'weigh-in',
        message: 'Considering an architectural switch.',
      });
      await waitFor(() => received.length >= 2, 'webhook received the weigh-in delivery');
      expect(received[1].body.rule.id).toBe('webhook-on-weighin');
      expect(received[1].body.event.eventType).toBe('weigh-in');
    } finally {
      await listener.close();
      await h.teardown();
    }
  });
});

async function startWebhookListener(onRequest: (req: ReceivedRequest) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: any = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      } catch {
        body = Buffer.concat(chunks).toString('utf-8');
      }
      const headerMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headerMap[k.toLowerCase()] = v;
        else if (Array.isArray(v)) headerMap[k.toLowerCase()] = v.join(', ');
      }
      onRequest({
        method: req.method ?? 'POST',
        url: req.url ?? '/',
        headers: headerMap,
        body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Listener failed to bind a TCP port');
  }
  const url = `http://127.0.0.1:${address.port}/webhook`;

  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, description: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}${lastErr ? ` (last error: ${lastErr})` : ''}`);
}
