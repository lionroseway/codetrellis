/**
 * Replay frames (Phase 32 B5.1), end to end.
 *
 * Journey G1 needs a graph at each moment worth stepping to. Codex works in
 * the sample app: when its turn ends, a frame is kept, naming its session
 * and the commit. Sam marks a task done: another, and since nothing in the
 * code changed it points at the last one rather than copying it. A commit
 * lands: a frame at that commit. Then another project is scanned, and a
 * status change in the first makes no frame: the server holds the other
 * project's graph, and a frame must never be taken of the wrong one.
 *
 * The timers are shortened here (a turn ends after 1.2 s quiet, not 30 s).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, prepareFixture, createMcpClient, type Harness, type PreparedFixture, type ScriptedMcp } from '../harness';

interface Frame {
  id: number; at: number; projectPath: string; reasons: string[]; ref: string | null;
  sessionId: string | null; agentType: string | null; workstreamRoot: string | null;
  commitSha: string | null; branch: string | null; digest: string; sameAs: number | null;
  fileCount: number; edgeCount: number;
}

test.describe.serial('Replay frames', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let other: PreparedFixture;
  let planUid: string;
  let itemUid: string;
  let agent: ScriptedMcp;

  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8' }).trim();
  const json = async <T>(method: string, url: string, body?: unknown) => (await (await h.client.raw(method, url, body)).json()) as T;
  const framesOf = async (project: string) =>
    (await json<{ frames: Frame[] }>('GET', `/api/replay/frames?project=${encodeURIComponent(project)}`)).frames;
  /** Wait for a frame after `afterId` that `match` accepts. */
  const nextFrame = async (afterId: number, match: (f: Frame) => boolean, timeoutMs = 15_000): Promise<Frame> => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const found = (await framesOf(root)).find((f) => f.id > afterId && match(f));
      if (found) return found;
      if (Date.now() > until) throw new Error(`no matching frame after #${afterId}: ${JSON.stringify(await framesOf(root))}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const lastId = async () => (await framesOf(root)).reduce((m, f) => Math.max(m, f.id), 0);

  test.beforeAll(async () => {
    h = await setupHarness('replay-frames', {
      env: { CODETRELLIS_TURN_GAP_MS: '1200', CODETRELLIS_FRAME_INTERVAL_MS: '200', CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' },
    });
    root = h.fixture.projectPath;
    other = prepareFixture('replay-frames-other');
    await h.client.scanProject(root);
    planUid = (await h.client.createPlan({ title: 'Refunds', projectPath: root })).uid;
    itemUid = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Partial refunds' })).uid;
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await agent.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    await h?.teardown();
    other?.cleanup();
  });

  test('an agent\'s turn ends: a frame of the graph, with its session and the commit it was at', async () => {
    const before = await lastId();
    await agent.callTool('list_plans', {});
    const frame = await nextFrame(before, (f) => f.reasons.includes('turn-end') && f.agentType === 'codex');

    const events = await json<{ events: Array<{ sessionId: string | null; payload: { tool?: string } }> }>('GET', '/api/agent-events');
    const call = events.events.find((e) => e.payload.tool === 'list_plans');
    expect(frame.sessionId).toBe(call?.sessionId);
    expect(frame.commitSha).toBe(git('rev-parse', 'HEAD'));
    expect(frame.branch).toBe('main');
    expect(frame.fileCount).toBeGreaterThan(0);
    expect(frame.projectPath).toBe(root.replace(/[\\/]+$/, ''));
  });

  test('a task marked done: a frame naming it, pointing at the last graph since no code changed', async () => {
    const before = await lastId();
    const res = await h.client.raw('PUT', `/api/items/${itemUid}`, { status: 'done' });
    expect(res.status).toBe(200);
    const frame = await nextFrame(before, (f) => f.reasons.includes('status'));
    expect(frame.ref).toBe(itemUid);
    expect(frame.sameAs).not.toBeNull();
    // Its graph is the one it points at.
    const graph = await json<{ data: { files: unknown[] } }>('GET', `/api/trellis/${frame.id}`);
    expect(graph.data.files.length).toBe(frame.fileCount);
  });

  test('an agent changes a status over MCP: the frame is that agent\'s', async () => {
    const before = await lastId();
    await agent.callTool('update_item', { uid: itemUid, status: 'in_progress' });
    const frame = await nextFrame(before, (f) => f.reasons.includes('status'));
    expect(frame.agentType).toBe('codex');
    expect(frame.sessionId).not.toBeNull();
  });

  test('a commit lands: a frame at that commit', async () => {
    // Let the agent's last turn end first, so its frame does not take this one's place.
    await nextFrame(await lastId() - 1, (f) => f.reasons.includes('turn-end'));
    const before = await lastId();
    fs.writeFileSync(path.join(root, 'services', 'refund_notes.py'), 'NOTE = "partial refunds"\n');
    git('add', '-A');
    git('-c', 'user.email=e2e@example.com', '-c', 'user.name=E2E', 'commit', '-q', '-m', 'Refund notes');
    const sha = git('rev-parse', 'HEAD');
    const frame = await nextFrame(before, (f) => f.reasons.includes('commit'));
    expect(frame.commitSha).toBe(sha);
    expect(frame.ref).toBe(sha);
  });

  test('frames are not among the checkpoints a person took', async () => {
    const snapshots = await json<Array<{ snapshotType: string }>>('GET', '/api/trellis/snapshots');
    expect(snapshots.every((s) => s.snapshotType !== 'frame')).toBe(true);
  });

  test('another project is held: a status change in this one makes no frame', async () => {
    await h.client.scanProject(other.projectPath);
    const before = await lastId();
    const res = await h.client.raw('PUT', `/api/items/${itemUid}`, { status: 'done' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await framesOf(root)).filter((f) => f.id > before)).toEqual([]);

    // Scanned again, this project gets frames again.
    await h.client.scanProject(root);
    await h.client.raw('PUT', `/api/items/${itemUid}`, { status: 'in_progress' });
    await nextFrame(before, (f) => f.reasons.includes('status'));
  });

  test('the list needs an opened project', async () => {
    expect((await h.client.raw('GET', '/api/replay/frames')).status).toBe(400);
    expect((await h.client.raw('GET', `/api/replay/frames?project=${encodeURIComponent('/not/opened')}`)).status).toBe(403);
    const all = await framesOf(root);
    const bounded = (await json<{ frames: Frame[] }>('GET', `/api/replay/frames?project=${encodeURIComponent(root)}&from=${all[1].at}&limit=1`)).frames;
    expect(bounded.map((f) => f.id)).toEqual([all.find((f) => f.at >= all[1].at)!.id]);
  });
});
