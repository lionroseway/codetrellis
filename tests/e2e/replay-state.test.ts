/**
 * The state at a moment (Phase 32 B5.2), end to end.
 *
 * Journey G1: Sam was away while two agents worked. Replay asks "what was it
 * like at 10:40?" and gets the answer the window showed then. Here, one
 * scripted run: a task starts; two worktrees change the same function (a
 * collision opens); Codex's claim is held at a breakpoint and Sam answers;
 * one side backs out (the collision closes) and comes back (it opens
 * again). Asked about each moment afterwards, the state says what was true
 * then, not what is true now: the task's status, the collision open or not,
 * the claim waiting or answered, and the frame of the graph.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

const REL = 'packages/shared/src/validators.ts';
const IN_ORDER = "errors.push('amount must be a positive number');";
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface StateAt {
  at: number;
  frame: { id: number; at: number } | null;
  sinceFrame: { addedFiles: string[]; modifiedFiles: string[] } | null;
  tasks: Array<{ uid: string; status: string | null; statusNow?: string | null }>;
  waiting: Array<{ ref: string; agent: string | null; answeredAt: number | null }>;
  signals: Array<{ id: string; kind: string; openedAt: number; closedAt: number | null }>;
}

test.describe.serial('The state at a moment', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let root: string;
  let billing: string;
  let exportsDir: string;
  let planUid: string;
  let itemUid: string;
  let codex: ScriptedMcp;
  const moments: Record<string, number> = {};

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const json = async <T>(method: string, url: string, body?: unknown) => (await (await raw(method, url, body)).json()) as T;
  const stateAt = (at: number) => json<StateAt>('GET', `/api/replay/state?project=${encodeURIComponent(root)}&at=${at}`);
  const openSignals = async () => (await json<{ signals: Array<{ id: string; kind: string }> }>('GET', `/api/awareness?project=${encodeURIComponent(root)}`)).signals;
  const edit = (dir: string, from: string, to: string) => {
    const f = path.join(dir, REL);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
  };
  /** A moment strictly between what happened before and what happens next. */
  const mark = async (name: string) => {
    await new Promise((r) => setTimeout(r, 30));
    moments[name] = Date.now();
    await new Promise((r) => setTimeout(r, 30));
  };

  test.beforeAll(async () => {
    h = await setupHarness('replay-state', {
      env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150', CODETRELLIS_FRAME_INTERVAL_MS: '200', CODETRELLIS_TURN_GAP_MS: '600000' },
    });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    exportsDir = `${root}-exports`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [exportsDir, 'exports']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    planUid = (await h.client.createPlan({ title: 'Refunds', projectPath: root })).uid;
    itemUid = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Partial refunds' })).uid;
    codex = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [billing] });
    await codex.connect();
  });

  test.afterAll(async () => {
    await codex?.disconnect().catch(() => {});
    for (const w of [billing, exportsDir]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('a scripted afternoon: a task starts, a collision opens, a claim is held and answered, the collision closes and opens again', async () => {
    await mark('before');

    expect((await raw('PUT', `/api/items/${itemUid}`, { status: 'in_progress' })).status).toBe(200);
    await expect.poll(async () => (await json<{ frames: unknown[] }>('GET', `/api/replay/frames?project=${encodeURIComponent(root)}`)).frames.length).toBeGreaterThan(0);
    await mark('started');

    edit(billing, IN_ORDER, "errors.push('amount must be above zero');");
    edit(exportsDir, IN_ORDER, "errors.push('amount must be a number above zero');");
    await expect.poll(async () => (await openSignals()).map((s) => s.kind), { timeout: 15_000 }).toContain('collision');
    await mark('collision');

    expect((await raw('POST', '/api/breakpoints', { kind: 'task', itemUid, note: 'Ask me first' })).status).toBe(201);
    const held = JSON.parse((await codex.callTool('claim_item', { uid: itemUid })).answer) as { ref: string };
    await mark('held');
    expect((await raw('POST', `/api/breakpoint-hits/${held.ref}/answer`, { decision: 'continue' })).status).toBeLessThan(300);
    await mark('answered');

    edit(exportsDir, "errors.push('amount must be a number above zero');", IN_ORDER);
    await expect.poll(async () => (await openSignals()).map((s) => s.kind), { timeout: 15_000 }).not.toContain('collision');
    await mark('closed');

    edit(exportsDir, IN_ORDER, "errors.push('amount must be a number above zero');");
    await expect.poll(async () => (await openSignals()).map((s) => s.kind), { timeout: 15_000 }).toContain('collision');
    await mark('reopened');

    // Asked afterwards, each moment is as it was.
    const before = await stateAt(moments.before);
    expect(before.tasks.find((t) => t.uid === itemUid)?.status).toBe('pending');
    expect(before.signals).toEqual([]);
    expect(before.waiting).toEqual([]);

    const started = await stateAt(moments.started);
    expect(started.tasks.find((t) => t.uid === itemUid)?.status).toBe('in_progress');
    expect(started.frame).not.toBeNull();
    expect(started.signals).toEqual([]);

    const collision = await stateAt(moments.collision);
    expect(collision.signals.map((s) => s.kind)).toEqual(['collision']);
    expect(collision.waiting).toEqual([]);

    const whileHeld = await stateAt(moments.held);
    expect(whileHeld.waiting.map((w) => w.ref)).toEqual([held.ref]);
    expect(whileHeld.waiting[0].agent).toBe('codex');
    expect(whileHeld.waiting[0].answeredAt).toBeGreaterThan(moments.held);

    const answered = await stateAt(moments.answered);
    expect(answered.waiting).toEqual([]);
    expect(answered.signals.map((s) => s.kind)).toEqual(['collision']);

    const closed = await stateAt(moments.closed);
    expect(closed.signals).toEqual([]);

    const reopened = await stateAt(moments.reopened);
    expect(reopened.signals.map((s) => s.kind)).toEqual(['collision']);
    // A second opening, not the first one stretched over the gap.
    expect(reopened.signals[0].openedAt).toBeGreaterThan(moments.closed);
    expect(collision.signals[0].closedAt).not.toBeNull();
  });

  test('the frame then, and how the graph differs from it now', async () => {
    const started = await stateAt(moments.started);
    expect(started.sinceFrame).not.toBeNull();
    // Now matches `started`'s frame or has moved on; either way the answer is about this project's files.
    for (const f of [...started.sinceFrame!.addedFiles, ...started.sinceFrame!.modifiedFiles]) expect(f.startsWith('/')).toBe(false);
  });

  test('any MCP client asks the same with get_state_at (B5.4)', async () => {
    const ask = async (at: number | string) => codex.callTool('get_state_at', { at });
    const held = JSON.parse((await ask(moments.held)).answer) as {
      at: string; frame: { reasons: string[] } | null; tasks: Array<{ uid: string; status: string; status_now?: string }>;
      waiting: Array<{ ref: string; agent: string; answered_at: string | null }>; signals: Array<{ kind: string; closed_at: string | null }>;
    };
    expect(held.at).toBe(new Date(moments.held).toISOString());
    expect(held.waiting).toHaveLength(1);
    expect(held.waiting[0].agent).toBe('codex');
    expect(held.waiting[0].answered_at).not.toBeNull();
    expect(held.signals.map((x) => x.kind)).toEqual(['collision']);
    expect(held.frame).not.toBeNull();

    // An ISO time works as well as milliseconds.
    const before = JSON.parse((await ask(new Date(moments.before).toISOString())).answer) as typeof held;
    expect(before.tasks.find((t) => t.uid === itemUid)).toMatchObject({ status: 'pending' });
    expect(before.signals).toEqual([]);

    const bad = await ask('last tuesday');
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/ISO 8601/);
  });

  test('refused: no project, a project not opened, an `at` that is not a time', async () => {
    expect((await raw('GET', '/api/replay/state')).status).toBe(400);
    expect((await raw('GET', `/api/replay/state?project=${encodeURIComponent('/not/opened')}`)).status).toBe(403);
    expect((await raw('GET', `/api/replay/state?project=${encodeURIComponent(root)}&at=yesterday`)).status).toBe(400);
    const now = await json<StateAt>('GET', `/api/replay/state?project=${encodeURIComponent(root)}`);
    expect(now.at).toBeGreaterThan(moments.reopened);
  });
});
