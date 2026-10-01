/**
 * Phase 32 C2.4b — no state change writes a file.
 *
 * Dana's plan is shared: it lives in the repository under
 * .codetrellis/plans/ and is committed. She marks a task in progress, an
 * agent claims another, she records progress and a blocker: the plan's
 * files do not change, so `git status` stays clean and a teammate's pull
 * carries no churn. The item's file says what the task is, never its state.
 * Renaming a task is intent, and still writes. A file written before this
 * change, which still carries a status, is read; a file without a claim
 * leaves this machine's claim alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('No state change writes a file', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let plan: string;
  let planDir: string;
  let agent: ScriptedAgent;
  const uid: Record<string, string> = {};
  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const post = async (url: string, body: unknown) => ((await (await raw('POST', url, body)).json()) as { uid: string }).uid;
  const git = (...args: string[]) => String(execFileSync('git', ['-C', root, ...args], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }));
  const dirty = () => git('status', '--porcelain', '--untracked-files=all', '--', '.codetrellis').trim();
  /** The item's file, found by its uid. */
  const fileOf = (itemUid: string): string => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const hit = walk(planDir).find((f) => f.endsWith('.yaml') && fs.readFileSync(f, 'utf-8').includes(`uid: ${itemUid}`));
    if (!hit) throw new Error(`no file for ${itemUid}`);
    return hit;
  };
  /** Long enough for a debounced write-through (200 ms) to have fired. */
  const settle = () => new Promise((r) => setTimeout(r, 900));

  test.beforeAll(async () => {
    h = await setupHarness('plan-state-writes');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    plan = (await h.client.createPlan({ title: 'Q3 board pack', projectPath: root })).uid;
    uid.write = await post(`/api/plans/${plan}/items`, { kind: 'action', title: 'Write the board report' });
    uid.chart = await post(`/api/plans/${plan}/items`, { kind: 'action', title: 'Export the revenue chart' });
    planDir = (await h.client.exportPlan(plan, root)).planDir;
    await settle();
    git('add', '-A', '.codetrellis');
    git('commit', '-q', '-m', 'plan: Q3 board pack');
    expect(dirty()).toBe('');
    agent = await h.spawnAgent({ agentType: 'codex' });
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('a status change, a claim, progress and a blocker write nothing; git status stays clean', async () => {
    expect((await raw('PUT', `/api/items/${uid.write}`, { status: 'in_progress' })).ok).toBe(true);
    expect((await agent.callTool('claim_item', { uid: uid.chart })).isError).toBeFalsy();
    expect((await raw('PUT', `/api/items/${uid.write}`, { progressPercent: 50 })).ok).toBe(true);
    // An agent's progress report is state too: neither the percent nor the report is written.
    expect((await agent.callTool('update_item_progress', { uid: uid.write, percent: 60, message: 'Draft done' })).isError).toBeFalsy();
    expect((await raw('PUT', `/api/items/${uid.chart}`, { status: 'blocked', blockedReason: 'waits on the auditor' })).ok).toBe(true);
    await settle();
    expect(dirty()).toBe('');

    // Each state is still known, from this machine's record, and says so.
    const s = (await (await raw('GET', `/api/plans/${plan}/status`)).json()) as { items: Array<{ itemUid: string; words: string; source: string }> };
    const byUid = Object.fromEntries(s.items.map((i) => [i.itemUid, i]));
    expect(byUid[uid.write]).toMatchObject({ source: 'plan', words: 'in progress, 60%' });
    expect(byUid[uid.chart]).toMatchObject({ source: 'plan', words: 'blocked: waits on the auditor' });
  });

  test('the item\'s file says what the task is, never its state', async () => {
    const doc = parseYaml(fs.readFileSync(fileOf(uid.chart), 'utf-8')) as Record<string, unknown>;
    expect(doc).toMatchObject({ uid: uid.chart, kind: 'action', title: 'Export the revenue chart' });
    for (const k of ['status', 'assignee', 'assigneeType', 'assigneeModel', 'progressPercent', 'blockedReason']) expect(doc, k).not.toHaveProperty(k);
  });

  test('renaming a task is intent: it still writes', async () => {
    expect((await raw('PUT', `/api/items/${uid.write}`, { title: 'Write the Q3 board report' })).ok).toBe(true);
    await expect.poll(() => fs.readFileSync(fileOf(uid.write), 'utf-8').includes('Write the Q3 board report'), { timeout: 5_000 }).toBe(true);
    expect(dirty()).not.toBe('');
    git('add', '-A', '.codetrellis');
    git('commit', '-q', '-m', 'plan: rename');
  });

  test('a file from before still carries a status: it is read; a file with no claim leaves the claim alone', async () => {
    const file = fileOf(uid.write);
    const old = parseYaml(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf-8').trimEnd()}\nstatus: done\n`);
    expect((await raw('POST', '/api/plans/import', { planDir })).ok).toBe(true);
    await expect.poll(async () => ((await (await raw('GET', `/api/items/${uid.write}`)).json()) as { status: string }).status, { timeout: 5_000 }).toBe('done');
    expect(old).not.toHaveProperty('status');

    const chart = (await (await raw('GET', `/api/items/${uid.chart}`)).json()) as { assignee: string | null; blockedReason: string | null };
    expect(chart.assignee).toBeTruthy();
    expect(chart.blockedReason).toBe('waits on the auditor');
  });
});
