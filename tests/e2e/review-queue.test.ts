/**
 * The review queue (Phase 32 A5.4, awareness spec §9.2).
 *
 * Two lines of work in one plan: billing-v2 changes `validateCreateUser`, and
 * checkout-fix's work imports it. Both are committed on their branches. The
 * queue lists both, each reviewed against main, and suggests billing-v2 first:
 * checkout-fix imports what it changes and will need updating after. Both are
 * held while the high overlap is open. Once the person marks it intended they
 * are ready, and the order stands, because checkout-fix still has to update.
 * A paired phone gets the same queue (A5.6), for an opened project only.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, pairPhone, type Harness } from '../harness';

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface Line {
  branch: string; planTitle: string; position: number; reason: string; ready: boolean; status: string; statusWords: string;
  filesChanged: number; openHigh: number; items: number;
}
interface Queue { base: string | null; lines: Line[] }

test.describe.serial('The review queue', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let signalId: string;

  const q = () => `project=${encodeURIComponent(root)}`;
  const queue = async () => (await (await h.client.raw('GET', `/api/review-queue?${q()}`)).json()) as Queue;

  test.beforeAll(async () => {
    h = await setupHarness('review-queue', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    const edit = (folder: string, rel: string, from: string, to: string) => {
      const f = path.join(folder, rel);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
    };
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
    execFileSync('git', ['-C', checkout, 'commit', '-q', '-am', 'checkout: signup form'], { env: ENV });
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    execFileSync('git', ['-C', billing, 'commit', '-q', '-am', 'billing: strict validation'], { env: ENV });
    await h.client.scanProject(root);

    const plan = await h.client.createPlan({ title: 'Q4 checkout', projectPath: root });
    for (const [title, branch] of [['Strict validation', 'billing-v2'], ['Signup form', 'checkout-fix']]) {
      const item = ((await (await h.client.raw('POST', `/api/plans/${plan.uid}/items`, { kind: 'action', title })).json()) as { uid: string }).uid;
      expect((await h.client.raw('PUT', `/api/items/${item}/workstream`, { workstream: branch })).ok).toBe(true);
    }

    expect((await h.client.raw('GET', `/api/workstreams?${q()}`)).ok).toBe(true);
    await expect.poll(async () => {
      const body = (await (await h.client.raw('GET', `/api/awareness?fresh=1&${q()}`)).json()) as { signals: Array<{ id: string; kind: string }> };
      return body.signals.find((s) => s.kind === 'contract')?.id ?? null;
    }, { timeout: 15_000, intervals: [300] }).not.toBeNull();
    const body = (await (await h.client.raw('GET', `/api/awareness?fresh=1&${q()}`)).json()) as { signals: Array<{ id: string; kind: string }> };
    signalId = body.signals.find((s) => s.kind === 'contract')!.id;
  });

  test.afterAll(async () => {
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('both lines are listed, reviewed against main, and billing-v2 goes first with the reason', async () => {
    const got = await queue();
    expect(got.base).toBeTruthy();
    expect(got.lines.map((l) => [l.position, l.branch])).toEqual([[1, 'billing-v2'], [2, 'checkout-fix']]);
    expect(got.lines[0]).toMatchObject({
      planTitle: 'Q4 checkout', items: 1, filesChanged: 1,
      reason: 'Before checkout-fix: it imports validateCreateUser, which this changes, and will need updating after.',
    });
    expect(got.lines[1].reason).toBe('After billing-v2: it changes validateCreateUser, which this imports, so update to it first.');
  });

  test('while the high overlap is open, both are held, and say why', async () => {
    const got = await queue();
    for (const l of got.lines) {
      expect(l).toMatchObject({ status: 'held', ready: false, openHigh: 1, statusWords: 'A high overlap with other work is still open.' });
    }
  });

  test('marked intended, both are ready, and the order stands: checkout-fix still has to update', async () => {
    expect((await h.client.raw('POST', `/api/awareness/${signalId}/state?${q()}`, { state: 'intended' })).ok).toBe(true);
    const got = await queue();
    expect(got.lines.map((l) => [l.branch, l.status])).toEqual([['billing-v2', 'ready'], ['checkout-fix', 'ready']]);
    expect(got.lines[1].reason).toMatch(/^After billing-v2/);
  });

  test('an agent asks for the same queue', async () => {
    const agent = await h.spawnAgent({ agentType: 'codex' });
    const r = await agent.callTool('get_review_queue', { project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    const got = JSON.parse(r.text) as Queue;
    expect(got.lines.map((l) => l.branch)).toEqual(['billing-v2', 'checkout-fix']);
  });

  test('a paired phone gets the same queue, for an opened project only (A5.6)', async () => {
    const phone = await pairPhone(h.client, { alias: 'Queue phone' });
    try {
      const got = await phone.rpc('review.queue', { projectPath: root }) as Queue;
      expect(got).toEqual(await queue());
      expect(got.lines.map((l) => [l.position, l.branch, l.status])).toEqual([[1, 'billing-v2', 'ready'], [2, 'checkout-fix', 'ready']]);
      expect(await phone.rpcError('review.queue', { projectPath: '/etc' })).toMatch(/not|trusted|opened/i);
    } finally {
      await phone.close();
    }
  });
});
