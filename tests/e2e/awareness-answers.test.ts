/**
 * A person's answers to awareness signals (Phase 32 A1.8), end to end: a real
 * collision between two worktrees, answered over REST as the Awareness tab
 * does, against the running backend's store, engine and broadcast.
 *
 * The answer is kept while the overlap lasts, recorded with who gave it (the
 * harness calls over plain HTTP, so `unverified`), and forgotten when the
 * overlap resolves and comes back. Agents see the answer but have no tool to
 * give one.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, openEventStream, type Harness, type ScriptedMcp, type EventStream } from '../harness';

interface Signal {
  id: string; kind: string; severity: string; state: string;
  stateBy?: { actor: string; actorType: string; channel: string }; stateAt?: number;
}

const REL = 'packages/shared/src/validators.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Answering awareness signals', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let events: EventStream;
  let root: string;
  let auth: string;
  let billing: string;
  let agent: ScriptedMcp;
  let original: string;
  let id: string;

  const signals = async () => {
    const res = await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { signals: Signal[] }).signals;
  };
  const answer = (signalId: string, state: unknown, project = root) =>
    h.client.raw('POST', `/api/awareness/${encodeURIComponent(signalId)}/state?project=${encodeURIComponent(project)}`, { state });
  const collide = () => {
    for (const [dir, to] of [[auth, 'return EMAIL_RE.test(email.trim());'], [billing, 'return email.length > 3 && EMAIL_RE.test(email);']] as const) {
      fs.writeFileSync(path.join(dir, REL), original.replace('return EMAIL_RE.test(email);', to));
    }
  };

  test.beforeAll(async () => {
    h = await setupHarness('awareness-answers', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    auth = `${root}-auth`;
    billing = `${root}-billing`;
    for (const [dir, branch] of [[auth, 'auth-refresh'], [billing, 'billing-v2']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    original = fs.readFileSync(path.join(root, REL), 'utf-8');
    await h.client.scanProject(root);
    events = await openEventStream(h.backend);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [auth] });
    await agent.connect();
    collide();
    const s = await signals();
    expect(s.map((x) => `${x.severity} ${x.kind} ${x.state}`)).toEqual(['high collision open']);
    id = s[0].id;
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    await events?.close();
    for (const w of [auth, billing]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('acknowledging records the answer and who gave it, and tells the window', async () => {
    const before = events.ofType('awareness-changed').length;
    const res = await answer(id, 'acknowledged');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Signal;
    expect(body).toMatchObject({ id, state: 'acknowledged', stateBy: { actorType: 'unverified', channel: 'local-api' } });
    expect(typeof body.stateAt).toBe('number');
    await expect.poll(() => events.ofType('awareness-changed').length, { timeout: 5_000 }).toBeGreaterThan(before);
  });

  test('the answer holds while the overlap keeps firing', async () => {
    // Another edit on one side: the same collision, recomputed.
    fs.appendFileSync(path.join(billing, REL), '\n// still here\n');
    const [s] = await signals();
    expect(s).toMatchObject({ id, state: 'acknowledged', stateBy: { actorType: 'unverified' } });
  });

  test('an agent sees the answer, and has no tool to give one', async () => {
    const body = JSON.parse((await agent.callTool('get_awareness', {})).text) as { signals: Signal[] };
    expect(body.signals.map((s) => [s.id, s.state])).toEqual([[id, 'acknowledged']]);
    const names = (await agent.listTools()).map((t) => t.name);
    // Two that read, and acknowledge_signal (A2.6), which records the agent's
    // own note and never the person's answer.
    expect(names.filter((n) => /awareness|signal|footprint/.test(n)).sort()).toEqual(['acknowledge_signal', 'check_footprint', 'get_awareness']);
    const ack = await agent.callTool('acknowledge_signal', { id, note: 'Seen; nothing to do on my side.' });
    expect(ack.isError, ack.text).toBeFalsy();
    const [after] = await signals();
    expect(after).toMatchObject({ id, state: 'acknowledged', stateBy: { actorType: 'unverified' } });
  });

  test('marked intended, dismissed, then taken back to open', async () => {
    for (const state of ['intended', 'dismissed', 'open']) {
      const res = await answer(id, state);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Signal).state).toBe(state);
      expect((await signals())[0].state).toBe(state);
    }
  });

  test('only a person-settable state, of a live signal, in an opened project', async () => {
    expect((await answer(id, 'resolved')).status).toBe(400); // the engine's, not a person's
    expect((await answer(id, 'bogus')).status).toBe(400);
    expect((await answer(id, undefined)).status).toBe(400);
    expect((await answer('not-a-signal', 'acknowledged')).status).toBe(404);
    expect((await answer(id, 'acknowledged', path.dirname(root))).status).toBe(403);
    expect((await h.client.raw('POST', `/api/awareness/${id}/state`, { state: 'acknowledged' })).status).toBe(400);
    expect((await signals())[0].state).toBe('open');
  });

  test('when the overlap resolves and comes back, the old answer is forgotten', async () => {
    expect((await answer(id, 'dismissed')).status).toBe(200);
    fs.writeFileSync(path.join(billing, REL), original);
    await expect.poll(async () => (await signals()).length, { timeout: 10_000 }).toBe(0);
    // A resolved signal has nothing left to answer.
    expect((await answer(id, 'acknowledged')).status).toBe(404);

    collide();
    const [back] = await signals();
    expect(back.id).toBe(id);
    expect(back.state).toBe('open');
    expect(back.stateBy).toBeUndefined();
    expect(back.stateAt).toBeUndefined();
  });
});
