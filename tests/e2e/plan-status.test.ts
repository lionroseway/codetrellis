/**
 * Phase 32 C2.4 — status read, not written, end to end.
 *
 * Dana's plan "Q3 board pack" (ticket FIN-88) has a code section on a branch
 * and an analyst's section with no branch. Every item says its state and
 * where that came from: the charts section and its task from git, the
 * report from the plan itself, with who recorded it. A blocked task waits on
 * someone. The lineage runs from the ticket to the plan to what git proves,
 * never a pull request without a host. The window's route, an agent's
 * get_plan and the phone's plan.status are one answer, and reading it
 * writes nothing to the project.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type ScriptedAgent, type Phone } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface Status {
  planUid: string;
  progress: { done: number; total: number; words: string };
  waiting: Array<{ itemUid: string; words: string; source: string }>;
  inProgress: Array<{ itemUid: string; words: string; source: string }>;
  lineage: string[];
  items: Array<{ itemUid: string; kind: string; state: string; source: string; words: string; from: string; recorded: { by: string; byType: string } | null; branch: string | null; gitNote?: string }>;
}

test.describe.serial('Status read, not written', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let root: string;
  let plan: string;
  let agent: ScriptedAgent;
  let phone: Phone;
  const uid: Record<string, string> = {};
  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const post = async (url: string, body: unknown) => ((await (await raw('POST', url, body)).json()) as { uid: string }).uid;
  const status = async () => (await (await raw('GET', `/api/plans/${plan}/status`)).json()) as Status;
  const byItem = (s: Status) => Object.fromEntries(s.items.map((i) => [Object.entries(uid).find(([, v]) => v === i.itemUid)?.[0] ?? i.itemUid, i]));
  const gitStatus = () => String(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'])).trim();

  test.beforeAll(async () => {
    h = await setupHarness('plan-status');
    root = h.fixture.projectPath;
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    const main = String(git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
    git('checkout', '-q', '-b', 'board-charts', main);
    fs.mkdirSync(path.join(root, 'src', 'charts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'charts', 'revenue.ts'), 'export const revenue = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'charts: revenue');
    git('checkout', '-q', main);
    await h.client.scanProject(root);

    plan = (await h.client.createPlan({ title: 'Q3 board pack', projectPath: root })).uid;
    uid.charts = await post(`/api/plans/${plan}/items`, { kind: 'object', title: 'Charts' });
    uid.chart = await post(`/api/plans/${plan}/items`, { kind: 'action', title: 'Export the revenue chart', parentUid: uid.charts });
    uid.report = await post(`/api/plans/${plan}/items`, { kind: 'object', title: 'Report' });
    uid.write = await post(`/api/plans/${plan}/items`, { kind: 'action', title: 'Write the board report', parentUid: uid.report });
    uid.check = await post(`/api/plans/${plan}/items`, { kind: 'action', title: 'Check the figures', parentUid: uid.report });
    uid.wait = await post(`/api/plans/${plan}/items`, { kind: 'action', title: 'Add the auditor\'s note', parentUid: uid.report });
    uid.notes = await post(`/api/plans/${plan}/items`, { kind: 'object', title: 'Meeting notes' });

    expect((await raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}&idle=1`)).ok).toBe(true);
    const assigned = await raw('PUT', `/api/items/${uid.charts}/workstream`, { workstream: 'board-charts' });
    expect(assigned.ok, await assigned.clone().text()).toBe(true);

    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    const ref = await agent.callTool('set_plan_external_ref', { plan_uid: plan, url: 'https://example.atlassian.net/browse/FIN-88', key: 'FIN-88' });
    expect(ref.isError, ref.text).toBeFalsy();
    phone = await pairPhone(h.client, { alias: 'Dana’s phone' });
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    await h?.teardown();
  });

  test('before anything: every item has a state and a source; git for the branch, the plan for the rest', async () => {
    const s = byItem(await status());
    expect(Object.keys(s)).toHaveLength(7);
    for (const i of Object.values(s)) {
      expect(i.state, i.itemUid).toBeTruthy();
      expect(['plan', 'git'], i.itemUid).toContain(i.source);
      expect(i.words, i.itemUid).toBeTruthy();
    }
    expect(s.charts).toMatchObject({ source: 'git', state: 'building', branch: 'board-charts', from: 'from git' });
    expect(s.chart).toMatchObject({ source: 'git', state: 'building', words: 'building on board-charts, not pushed' });
    expect(s.write).toMatchObject({ source: 'plan', state: 'not-started', words: 'not started', from: 'from the plan', branch: null });
    expect(s.report).toMatchObject({ source: 'plan', words: 'none of 3 tasks started' });
    expect(s.notes).toMatchObject({ source: 'plan', state: 'context', words: 'no tasks under it' });
  });

  test('the analyst records progress: the plan says so, with who recorded it; a blocked task waits on someone', async () => {
    expect((await raw('PUT', `/api/items/${uid.write}`, { status: 'in_progress', progressPercent: 60 })).ok).toBe(true);
    expect((await raw('PUT', `/api/items/${uid.check}`, { status: 'done' })).ok).toBe(true);
    expect((await raw('PUT', `/api/items/${uid.wait}`, { status: 'blocked', blockedReason: 'waits on the auditor' })).ok).toBe(true);
    const st = await status();
    const s = byItem(st);
    expect(s.write).toMatchObject({ source: 'plan', state: 'in-progress', words: 'in progress, 60%' });
    expect(s.write.recorded).toMatchObject({ by: expect.any(String), byType: expect.any(String) });
    expect(s.check).toMatchObject({ source: 'plan', state: 'done' });
    expect(s.report).toMatchObject({ source: 'plan', words: '1 of 3 tasks done; 1 blocked' });
    expect(st.progress).toEqual({ done: 1, total: 4, words: '1 of 4 tasks done' });
    expect(st.waiting.map((w) => w.itemUid)).toEqual([uid.wait]);
    expect(st.waiting[0]).toMatchObject({ words: 'blocked: waits on the auditor', source: 'plan' });
    expect(st.inProgress.map((w) => [w.itemUid, w.source])).toEqual(expect.arrayContaining([[uid.write, 'plan'], [uid.chart, 'git']]));
  });

  test('the lineage: ticket → plan → what git proves; no pull request without a host', async () => {
    const st = await status();
    expect(st.lineage).toEqual(['FIN-88 → this plan → board-charts not pushed yet']);
    expect(JSON.stringify(st.lineage)).not.toMatch(/PR #|MR !/);
  });

  test('an agent\'s get_plan and the phone say the same', async () => {
    const st = await status();
    const got = JSON.parse((await agent.callTool('get_plan', { plan_uid: plan })).text) as {
      state: { progress: string; lineage: string[]; items: Array<{ item_uid: string; state: string; source: string; says: string; recorded_by?: string }>; note: string };
    };
    expect(got.state.progress).toBe(st.progress.words);
    expect(got.state.lineage).toEqual(st.lineage);
    expect(got.state.items.map((i) => [i.item_uid, i.state, i.source, i.says])).toEqual(st.items.map((i) => [i.itemUid, i.state, i.source, i.words]));
    expect(got.state.items.find((i) => i.item_uid === uid.write)?.recorded_by).toBeTruthy();
    expect(got.state.note).toContain('Read, never written');

    const onPhone = await phone.rpc<Status>('plan.status', { planUid: plan });
    expect(onPhone.progress).toEqual(st.progress);
    expect(onPhone.items.map((i) => [i.itemUid, i.state, i.source, i.words])).toEqual(st.items.map((i) => [i.itemUid, i.state, i.source, i.words]));
  });

  test('reading the status writes nothing to the project', async () => {
    const before = gitStatus();
    for (let n = 0; n < 3; n++) await status();
    await agent.callTool('get_plan', { plan_uid: plan });
    await phone.rpc('plan.status', { planUid: plan });
    expect(gitStatus()).toBe(before);
    expect(fs.existsSync(path.join(root, 'STATUS.md'))).toBe(false);
  });

  test('a plan that is not there is refused', async () => {
    expect((await raw('GET', '/api/plans/nope/status')).status).toBe(404);
  });
});
