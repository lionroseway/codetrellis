/**
 * Governance and review, checked for what they say (Phase 32 §0.4h).
 *
 * An audit of the existing tests found these untested or checked for shape
 * only: PUT /api/freeze (no test at all), compare_snapshots, review_plan and
 * get_pr_draft through MCP (never run), get_drift_report (text length), and
 * get_plan_history / get_team_activity (a count). This checks their answers.
 *
 * Writing it found bug 33: PUT /api/freeze stored whatever it was sent —
 * `active: "no"` is truthy and froze the project, and an `until` that is not
 * a date never expired.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, openEventStream, type Harness, type ScriptedAgent, type EventStream } from '../harness';

test.describe.serial('Governance and review tools', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let events: EventStream;
  let root: string;
  let planUid: string;
  let checkpoint: number;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const json = async (name: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(name, args);
    expect(res.isError, `${name}: ${res.text}`).not.toBe(true);
    return JSON.parse(res.text);
  };
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Dana', GIT_AUTHOR_EMAIL: 'dana@x', GIT_COMMITTER_NAME: 'Dana', GIT_COMMITTER_EMAIL: 'dana@x' },
  }).trim();

  test.beforeAll(async () => {
    h = await setupHarness('review-governance-tools');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    events = await openEventStream(h.backend);
    planUid = (await json('create_plan', { title: 'Validators', project_path: root })).uid;
    await json('add_item', {
      plan_uid: planUid, kind: 'action', title: 'Update validators',
      file_specs: [{ path: 'packages/shared/src/validators.ts', action: 'modify' }],
    });
    const text = (await agent.callTool('capture_checkpoint', { plan_uid: planUid, name: 'Start', project_path: root })).text;
    checkpoint = Number(/snapshot #(\d+)/.exec(text)?.[1]);
    // The planned change, and one nobody asked for.
    fs.appendFileSync(path.join(root, 'packages/shared/src/validators.ts'), '\nexport const REVIEWED = true;\n');
    fs.appendFileSync(path.join(root, 'packages/shared/src/types.ts'), '\nexport type Sneaky = true;\n');
    await h.client.scanProject(root);
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  // ── Freeze over REST ─────────────────────────────────────────────────

  test('a person freezes the project over REST: it holds, says why and until when, and lifts', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const frozen = await req('PUT', '/api/freeze', { projectPath: root, active: true, reason: 'Release 2.0', until });
    expect(frozen).toMatchObject({ active: true, reason: 'Release 2.0', until, expired: false });
    await events.waitFor('freeze-changed', (p) => p.status?.active === true);

    expect(await req('GET', `/api/freeze?project=${encodeURIComponent(root)}`)).toMatchObject({ active: true, reason: 'Release 2.0', until });
    const check = await json('check_freeze', { project_path: root, plan_uid: planUid });
    expect(check).toMatchObject({ allowed: false, freezeActive: true });

    // An exempt plan may continue.
    await req('PUT', '/api/freeze', { projectPath: root, active: true, reason: 'Release 2.0', until, allowedPlanUids: [planUid] });
    expect((await json('check_freeze', { project_path: root, plan_uid: planUid })).allowed).toBe(true);

    expect(await req('PUT', '/api/freeze', { projectPath: root, active: false })).toMatchObject({ active: false });
    expect((await json('check_freeze', { project_path: root, plan_uid: planUid })).allowed).toBe(true);
  });

  test('a freeze request that is not one is refused, not stored (bug 33)', async () => {
    const refusals: Array<Record<string, unknown>> = [
      { projectPath: root },
      { projectPath: root, active: 'no' },
      { projectPath: root, active: true, until: 'tomorrow' },
      { projectPath: root, active: true, allowedPlanUids: 'all' },
      { projectPath: root, active: true, reason: 42 },
    ];
    for (const body of refusals) {
      expect((await h.client.raw('PUT', '/api/freeze', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await h.client.raw('PUT', '/api/freeze', { projectPath: '/etc', active: true })).status).toBe(403);
    expect((await req('GET', `/api/freeze?project=${encodeURIComponent(root)}`)).active).toBe(false);
  });

  // ── Comparing and reviewing, through MCP ─────────────────────────────

  test('compare_snapshots: the checkpoint against live names exactly the two changed files', async () => {
    const cmp = await json('compare_snapshots', { project_path: root, before: `checkpoint:${checkpoint}`, after: 'live' });
    expect(cmp.before).toMatchObject({ spec: `checkpoint:${checkpoint}` });
    expect(cmp.diff.modifiedFiles.sort()).toEqual(['packages/shared/src/types.ts', 'packages/shared/src/validators.ts']);
    expect(cmp.diff.addedFiles).toEqual([]);
    expect((await agent.callTool('compare_snapshots', { project_path: root, before: 'checkpoint:99999', after: 'live' })).isError).toBe(true);
  });

  test('review_plan: the planned change landed, and the one nobody asked for is named', async () => {
    const review = await json('review_plan', { plan_uid: planUid, project_path: root, before: `checkpoint:${checkpoint}` });
    expect(review.items.find((i: { title: string }) => i.title === 'Update validators').verdict).toBe('landed');
    expect(review.unclaimedChanges).toEqual(['packages/shared/src/types.ts']);
    expect(review.summary).toMatchObject({ unclaimedCount: 1, itemsLanded: 1 });

    // Since 0.4h a rescan keeps the baseline, so baseline → live shows the same.
    const sinceBaseline = await json('review_plan', { plan_uid: planUid, project_path: root, before: 'baseline' });
    expect(sinceBaseline.unclaimedChanges).toEqual(['packages/shared/src/types.ts']);

    const md = (await agent.callTool('review_plan', { plan_uid: planUid, project_path: root, before: `checkpoint:${checkpoint}`, format: 'markdown' })).text;
    expect(md).toContain('## Plan review');
    expect(md).toContain('Comparing **Start** → **Live**');
    expect(md).toContain('types.ts');
  });

  test('get_pr_draft: the plan, its criteria and the review, and nothing touched', async () => {
    const [item] = (await req('GET', `/api/plans/${planUid}/items`)) as Array<{ uid: string }>;
    await req('POST', `/api/items/${item.uid}/criteria`, { text: 'Validators reject empty strings', kind: 'manual' });
    const head = git('rev-parse', 'HEAD');

    const res = await agent.callTool('get_pr_draft', { plan_uid: planUid, project_path: root, before: `checkpoint:${checkpoint}` });
    expect(res.isError, res.text).not.toBe(true);
    const draft = JSON.parse(res.text);
    expect(draft.title).toBe('Validators');
    expect(draft.body).toContain('Plan review');
    expect(draft.body).toContain('## Acceptance criteria');
    expect(draft.body).toContain('Validators reject empty strings');
    expect(draft.warnings.join(' ')).toMatch(/types\.ts|not started|criteri/i);
    expect(git('rev-parse', 'HEAD')).toBe(head);
  });

  test('get_drift_report: the planned file is satisfied, the other is unexpected, against the checkpoint', async () => {
    const report = await json('get_drift_report', { plan_uid: planUid });
    expect(report.hasBaseline).toBe(true);
    expect(report.planTitle).toBe('Validators');
    expect(report.taskProgress).toBe('0/1');
    expect(report.snapshotDiff.modifiedFiles.sort()).toEqual(['packages/shared/src/types.ts', 'packages/shared/src/validators.ts']);
    expect(report.planAlignment.unexpectedFiles).toEqual(['packages/shared/src/types.ts']);
  });

  // ── History ──────────────────────────────────────────────────────────

  test('get_plan_history and get_team_activity name the commits, newest first', async () => {
    const plansDir = path.join(root, '.codetrellis', 'plans');
    const slug = fs.readdirSync(plansDir).find((d) => {
      try { return fs.readFileSync(path.join(plansDir, d, 'plan.yaml'), 'utf-8').includes(planUid); } catch { return false; }
    })!;
    git('add', '.codetrellis'); git('commit', '-qm', 'Plan the validators');
    const first = git('rev-parse', 'HEAD');
    await json('update_plan', { plan_uid: planUid, description: 'Only validators.ts should change.' });
    await expect.poll(() => git('status', '--porcelain', '.codetrellis').length, { timeout: 5000 }).toBeGreaterThan(0);
    git('add', '.codetrellis'); git('commit', '-qm', 'Scope the validators plan');
    const second = git('rev-parse', 'HEAD');

    const history = await json('get_plan_history', { project_path: root, plan_slug: slug });
    const commits = history.commits as Array<{ hash: string; subject: string; author: string }>;
    expect(history.total).toBe(commits.length);
    expect(commits.map((c) => [c.hash, c.subject])).toEqual([[second, 'Scope the validators plan'], [first, 'Plan the validators']]);
    expect(commits[0].author).toBe('Dana');

    const activity = await json('get_team_activity', { project_path: root });
    const entries = activity.entries as Array<{ commitHash: string }>;
    const hashes = entries.map((e) => e.commitHash);
    expect(hashes).toContain(first);
    expect(hashes).toContain(second);
    expect(hashes.indexOf(second)).toBeLessThan(hashes.indexOf(first));
  });
});
