/**
 * Every record says who made it, from how the request arrived (Phase 32,
 * carried item 2; the rule is §0.4d, the owner's decision).
 *
 *   plain HTTP with the token   `unverified` (a person in a browser, or a script)
 *   an MCP agent                that agent, never the person
 *   a name in the request       ignored
 *
 * Before: about twenty REST handlers wrote `human` whoever called; plan docs,
 * doc edits and plans from a template took `author` from the body; and a
 * channel post from an agent that had not called register_session was
 * recorded as the person's own. `src/backend/authorship.test.ts` holds the
 * source to the rule; this holds the behaviour.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, createScriptedAgent, type Harness } from '../harness';

test.describe.serial('Authorship follows how a write arrived', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let planUid: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };

  test.beforeAll(async () => {
    h = await setupHarness('authorship', { settings: { identity: { email: 'sam@example.com', displayName: 'Sam' } } });
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    planUid = (await req('POST', '/api/plans', { title: 'Who wrote this', projectPath: root })).uid;
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('over plain HTTP, items, comments and edits are the person, marked unverified', async () => {
    const item = await req('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Cache prices' });
    expect(item).toMatchObject({ author: 'sam@example.com', authorType: 'unverified' });

    await req('PUT', `/api/items/${item.uid}`, { title: 'Cache prices for 60s' });
    const versions = await req('GET', `/api/items/${item.uid}/versions`) as Array<{ authorType?: string; author?: string }>;
    expect(versions[0]).toMatchObject({ author: 'sam@example.com' });

    // A `source` in the body no longer decides whether a comment reads as an agent's.
    const comment = await req('POST', `/api/items/${item.uid}/comments`, { body: 'Looks right', source: 'agent' });
    expect(comment).toMatchObject({ author: 'sam@example.com', authorType: 'unverified', source: 'human' });
  });

  test('a name in the request body is ignored: plan docs, doc edits and plans from a template', async () => {
    const doc = await req('POST', `/api/plans/${planUid}/docs`, {
      docType: 'spec', title: 'Rounding', body: 'Half-up.', author: 'the-ceo', authorType: 'human',
    });
    expect(doc).toMatchObject({ author: 'sam@example.com', authorType: 'unverified' });

    await req('PUT', `/api/plan-docs/${doc.uid}`, { body: 'Half-up at 2dp.', author: 'the-ceo', authorType: 'human' });
    const versions = await req('GET', `/api/plan-docs/${doc.uid}/versions`) as Array<{ author: string; authorType: string | null }>;
    expect(versions.map((v) => v.author)).not.toContain('the-ceo');
    // Each version keeps how it arrived, so the history can tag it (carried 2b).
    expect(versions.map((v) => v.authorType)).toEqual(['unverified', 'unverified']);

    const made = await req('POST', '/api/plans/from-template', {
      templateId: 'mass-refactor', projectPath: root, title: 'From a template', author: 'the-ceo', authorType: 'human',
    });
    const plan = await req('GET', `/api/plans/${made.plan.uid}`);
    expect(plan.author).not.toBe('the-ceo');
  });

  test('a channel post from an agent that never registered is not recorded as the person', async () => {
    // Connect without register_session: the session stays the generic
    // `mcp-client`, which used to be written as `human`.
    const anon = createScriptedAgent({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, agentType: 'unused', projectPath: root });
    await anon.mcp.connect();
    try {
      const res = await anon.mcp.callTool('post_channel_event', { plan_uid: planUid, event_type: 'steer', message: 'Picked this up' });
      expect(res.isError, res.text).not.toBe(true);
      const thread = await req('GET', `/api/plans/${planUid}/channels`) as Array<{ payload: { message?: string }; authorType: string }>;
      const posted = thread.find((e) => e.payload?.message === 'Picked this up');
      expect(posted, JSON.stringify(thread)).toBeTruthy();
      expect(posted!.authorType).not.toBe('human');
    } finally {
      await anon.disconnect();
    }

    // A registered agent posts under its own type.
    const agent = await h.spawnAgent({ agentType: 'claude-code' });
    await agent.callTool('post_channel_event', { plan_uid: planUid, event_type: 'steer', message: 'Mine' });
    const thread = await req('GET', `/api/plans/${planUid}/channels`) as Array<{ payload: { message?: string }; authorType: string }>;
    expect(thread.find((e) => e.payload?.message === 'Mine')?.authorType).toBe('claude-code');
  });

  test('a channel post over plain HTTP is unverified', async () => {
    const posted = await req('POST', `/api/plans/${planUid}/channels`, { event_type: 'steer', message: 'From a script' });
    expect(posted).toMatchObject({ author: 'sam@example.com', authorType: 'unverified' });
  });
});
