/**
 * "Other work in flight" in a review and a PR body (Phase 32 A5.2).
 *
 * billing-v2 changes `validateCreateUser` and commits it; checkout-fix's work
 * imports it. Reviewing billing-v2's branch says, beside its own findings,
 * that merging it changes a function checkout-fix imports, and that the
 * overlap is still open. The PR draft carries the same section and warns.
 * Once the overlap is marked intended, the review writes that down as a
 * decision, with who made it.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness } from '../harness';

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface OtherWork {
  workstream: { name: string };
  openHigh: number;
  entries: Array<{ kind: string; severity: string; heading: string; outcome: string; outcomeWords: string; merge?: string; sides: Array<{ name: string }> }>;
}

test.describe.serial('Other work in flight', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let main: string;
  let planUid: string;
  let signalId: string;

  const q = () => `project=${encodeURIComponent(root)}`;
  const range = () => `before=${encodeURIComponent(`commit:${main}`)}&after=${encodeURIComponent('commit:billing-v2')}`;
  const review = async () =>
    ((await (await h.client.raw('GET', `/api/plans/${planUid}/review?${q()}&${range()}`)).json()) as { otherWork: OtherWork | null }).otherWork;

  test.beforeAll(async () => {
    h = await setupHarness('review-other-work', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    main = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    const edit = (folder: string, rel: string, from: string, to: string) => {
      const f = path.join(folder, rel);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
    };
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    execFileSync('git', ['-C', billing, 'commit', '-q', '-am', 'billing: strict validation'], { env: ENV });
    await h.client.scanProject(root);
    planUid = (await h.client.createPlan({ title: 'Billing v2', projectPath: root, tasks: [] })).uid;

    // The window shows the strip once, which starts the watchers.
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

  test('the review of billing-v2 says merging it changes a function checkout-fix imports, still open', async () => {
    const other = await review();
    expect(other?.workstream.name).toBe('billing-v2');
    expect(other?.openHigh).toBe(1);
    const contract = other!.entries.find((e) => e.kind === 'contract')!;
    expect(contract).toMatchObject({
      severity: 'high', heading: 'Changed signature', outcome: 'open', outcomeWords: 'Open: nobody has answered it yet.',
      merge: 'Merging this changes validateCreateUser; checkout-fix imports it and will need updating.',
    });
    expect(contract.sides.map((s) => s.name)).toEqual(['billing-v2', 'checkout-fix']);
  });

  test('the markdown an agent posts, and the PR body, carry the section; the draft warns', async () => {
    const agent = await h.spawnAgent({ agentType: 'harness-review' });
    const md = await agent.callTool('review_plan', { plan_uid: planUid, project_path: root, before: `commit:${main}`, after: 'commit:billing-v2', format: 'markdown' });
    expect(md.isError, md.text).toBeFalsy();
    expect(md.text).toContain('### Other work in flight');
    expect(md.text).toContain('Merging this changes validateCreateUser; checkout-fix imports it and will need updating.');

    const pr = await agent.callTool('get_pr_draft', { plan_uid: planUid, project_path: root, before: `commit:${main}`, after: 'commit:billing-v2' });
    expect(pr.isError, pr.text).toBeFalsy();
    const draft = JSON.parse(pr.answer) as { body: string; warnings: string[] };
    expect(draft.body).toContain('### Other work in flight');
    expect(draft.body).toContain('checkout-fix imports it and will need updating');
    expect(draft.warnings).toContain('1 high overlap(s) with other work are still open; see "Other work in flight".');
  });

  test('marked intended, the review writes it down as a decision, with who made it', async () => {
    expect((await h.client.raw('POST', `/api/awareness/${signalId}/state?${q()}`, { state: 'intended' })).ok).toBe(true);
    const other = await review();
    expect(other?.openHigh).toBe(0);
    expect(other!.entries.find((e) => e.kind === 'contract')).toMatchObject({
      outcome: 'intended',
      outcomeWords: 'Marked intended by someone through the local API, not verified as the person: a decision, not an accident.',
    });
  });

  test('a review of the opened checkout itself names it, and lists what involves it', async () => {
    const res = await h.client.raw('GET', `/api/plans/${planUid}/review?${q()}`);
    const other = ((await res.json()) as { otherWork: OtherWork | null }).otherWork;
    expect(other?.workstream.name).toBe('main');
  });
});
