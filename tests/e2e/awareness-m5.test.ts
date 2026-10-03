/**
 * M5 "done when" (Phase 32 A5.7, awareness spec §9): reviewing a branch that
 * changes a function another open line of work imports says so in the review
 * and in the PR body, and the queue puts it first with that reason.
 *
 * Two real worktrees of the sample app with committed work: billing-v2
 * changes `validateCreateUser`'s signature, and checkout-fix's work imports
 * it. One plan, an item on each branch. Different agents ask the questions
 * over MCP, as any client would, and the phone asks the same ones over its
 * RPC. Everything is compared commit to commit against the main checkout's
 * branch, so nothing depends on what is uncommitted in a folder.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, pairPhone, type Harness } from '../harness';

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const MERGE_LINE = 'Merging this changes validateCreateUser; checkout-fix imports it and will need updating.';
const FIRST = 'Before checkout-fix: it imports validateCreateUser, which this changes, and will need updating after.';

interface Line { branch: string; position: number; reason: string; status: string }
interface Queue { base: string | null; lines: Line[] }
interface OtherWork { workstream: { name: string }; openHigh: number; entries: Array<{ kind: string; merge?: string; outcome: string }> }

test.describe.serial('M5: review knows what else is in flight', () => {
  test.setTimeout(180_000);

  let h: Harness;
  let root: string;
  let base: string;
  let planUid: string;
  const trees: string[] = [];

  const q = () => `project=${encodeURIComponent(root)}`;
  const billingRange = () => ({ before: `commit:${base}`, after: 'commit:billing-v2' });

  test.beforeAll(async () => {
    h = await setupHarness('awareness-m5', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    base = execFileSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    const edit = (folder: string, rel: string, from: string, to: string) => {
      const f = path.join(folder, rel);
      const before = fs.readFileSync(f, 'utf-8');
      expect(before, `${rel} has what the edit replaces`).toContain(from);
      fs.writeFileSync(f, before.replace(from, to));
    };
    for (const branch of ['billing-v2', 'checkout-fix']) {
      const dir = `${root}-${branch}`;
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
      trees.push(dir);
    }
    const [billing, checkout] = trees;
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    execFileSync('git', ['-C', billing, 'commit', '-q', '-am', 'billing: strict validation'], { env: ENV });
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
    execFileSync('git', ['-C', checkout, 'commit', '-q', '-am', 'checkout: signup form'], { env: ENV });
    await h.client.scanProject(root);

    planUid = (await h.client.createPlan({ title: 'Q4 checkout', projectPath: root })).uid;
    for (const [title, branch] of [['Strict validation', 'billing-v2'], ['Signup form', 'checkout-fix']]) {
      const item = ((await (await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title })).json()) as { uid: string }).uid;
      expect((await h.client.raw('PUT', `/api/items/${item}/workstream`, { workstream: branch })).ok).toBe(true);
    }

    // The window shows the strip once, which starts the watchers.
    expect((await h.client.raw('GET', `/api/workstreams?${q()}`)).ok).toBe(true);
    await expect.poll(async () => {
      const body = (await (await h.client.raw('GET', `/api/awareness?fresh=1&${q()}`)).json()) as { signals: Array<{ kind: string }> };
      return body.signals.some((s) => s.kind === 'contract');
    }, { timeout: 15_000, intervals: [300] }).toBe(true);
  });

  test.afterAll(async () => {
    for (const w of trees) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('the review of billing-v2 says it changes a function checkout-fix imports', async () => {
    const reviewer = await h.spawnAgent({ agentType: 'claude-code' });
    const json = await reviewer.callTool('review_plan', { plan_uid: planUid, project_path: root, ...billingRange() });
    expect(json.isError, json.text).toBeFalsy();
    const other = (JSON.parse(json.text) as { otherWork: OtherWork }).otherWork;
    expect(other.workstream.name).toBe('billing-v2');
    expect(other.openHigh).toBe(1);
    expect(other.entries.find((e) => e.kind === 'contract')).toMatchObject({ merge: MERGE_LINE, outcome: 'open' });

    const md = await reviewer.callTool('review_plan', { plan_uid: planUid, project_path: root, ...billingRange(), format: 'markdown' });
    expect(md.text).toContain('### Other work in flight');
    expect(md.text).toContain(MERGE_LINE);
  });

  test('and so does the PR body, with a warning while the overlap is open', async () => {
    const author = await h.spawnAgent({ agentType: 'codex' });
    const pr = await author.callTool('get_pr_draft', { plan_uid: planUid, project_path: root, ...billingRange() });
    expect(pr.isError, pr.text).toBeFalsy();
    const draft = JSON.parse(pr.text) as { body: string; warnings: string[] };
    expect(draft.body).toContain('### Other work in flight');
    expect(draft.body).toContain(MERGE_LINE);
    expect(draft.warnings).toContain('1 high overlap(s) with other work are still open; see "Other work in flight".');
  });

  test('the queue puts billing-v2 first with that reason, and holds both while the overlap is open', async () => {
    const lead = await h.spawnAgent({ agentType: 'cursor' });
    const r = await lead.callTool('get_review_queue', { project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    const queue = JSON.parse(r.text) as Queue;
    expect(queue.base).toBe(base);
    expect(queue.lines.map((l) => [l.position, l.branch, l.status])).toEqual([[1, 'billing-v2', 'held'], [2, 'checkout-fix', 'held']]);
    expect(queue.lines[0].reason).toBe(FIRST);
  });

  test('the person away from the desk sees the same, then marks it intended; the order stands', async () => {
    const phone = await pairPhone(h.client, { alias: 'M5 phone' });
    try {
      const queue = await phone.rpc('review.queue', { projectPath: root }) as Queue;
      expect(queue.lines[0]).toMatchObject({ branch: 'billing-v2', reason: FIRST });
      const review = await phone.rpc('review.get', { planUid, ...billingRange() }) as { otherWork: OtherWork };
      expect(review.otherWork.entries.find((e) => e.kind === 'contract')?.merge).toBe(MERGE_LINE);

      const signals = (await (await h.client.raw('GET', `/api/awareness?fresh=1&${q()}`)).json()) as { signals: Array<{ id: string; kind: string }> };
      const contract = signals.signals.find((s) => s.kind === 'contract')!;
      expect((await h.client.raw('POST', `/api/awareness/${contract.id}/state?${q()}`, { state: 'intended' })).ok).toBe(true);

      const after = await phone.rpc('review.queue', { projectPath: root }) as Queue;
      expect(after.lines.map((l) => [l.branch, l.status])).toEqual([['billing-v2', 'ready'], ['checkout-fix', 'ready']]);
      expect(after.lines[0].reason).toBe(FIRST);
    } finally {
      await phone.close();
    }
  });
});
