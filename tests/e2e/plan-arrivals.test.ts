/**
 * Phase 32 C2.6a — teammates' plans after a pull.
 *
 * Priya writes "Q4 forecast" on her machine and commits it. Dana pulls:
 * the plan's folder lands in her checkout, and once imported it appears in
 * her plans list and her Stack "from Priya Shah, in <commit>", as git says,
 * and an agent's get_plan says the same. Dana's own plan says nothing of
 * the kind. A plan folder copied in but not committed yet says so. Nothing
 * is fetched: the pull is the person's.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

interface Listed { uid: string; title: string; arrival: { addedBy: string | null; commit: string | null } | null }

test.describe.serial('Teammates\' plans after a pull', () => {
  test.setTimeout(150_000);
  let dana: Harness;
  let priya: Harness;
  let agent: ScriptedAgent;
  let repo: string;
  let forecast: string;
  let commit: string;
  const git = (...args: string[]) => String(execFileSync('git', ['-C', repo, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'Priya Shah', GIT_AUTHOR_EMAIL: 'priya@acme.test', GIT_COMMITTER_NAME: 'Priya Shah', GIT_COMMITTER_EMAIL: 'priya@acme.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
  const listed = async () => (await (await dana.client.raw('GET', `/api/plans?project=${encodeURIComponent(repo)}`)).json()) as Listed[];
  /** A plan made on Priya's machine, its folder as her export wrote it. */
  const priyasPlan = async (title: string) => {
    const uid = (await priya.client.createPlan({ title, projectPath: priya.fixture.projectPath })).uid;
    await priya.client.raw('POST', `/api/plans/${uid}/items`, { kind: 'action', title: 'Update the revenue model' });
    return { uid, dir: (await priya.client.exportPlan(uid, priya.fixture.projectPath)).planDir };
  };
  /** A folder copied into Dana's checkout, not committed. */
  const land = (from: string) => {
    const to = path.join(repo, '.codetrellis', 'plans', path.basename(from));
    fs.cpSync(from, to, { recursive: true });
    return to;
  };
  /**
   * What a pull does: Priya's commit, made elsewhere, fast-forwarded into
   * Dana's checkout, so the folder lands already committed.
   */
  const pull = (from: string) => {
    const side = path.join(dana.fixture.tmpDir, `priya-${path.basename(from)}`);
    const main = git('rev-parse', '--abbrev-ref', 'HEAD');
    git('worktree', 'add', '-q', '-b', `priya-${path.basename(from)}`, side, main);
    const to = path.join(side, '.codetrellis', 'plans', path.basename(from));
    fs.cpSync(from, to, { recursive: true });
    execFileSync('git', ['-C', side, 'add', '-A', '.codetrellis'], { stdio: 'ignore' });
    execFileSync('git', ['-C', side, 'commit', '-q', '-m', `plan: ${path.basename(from)}`], {
      env: { ...process.env, GIT_AUTHOR_NAME: 'Priya Shah', GIT_AUTHOR_EMAIL: 'priya@acme.test', GIT_COMMITTER_NAME: 'Priya Shah', GIT_COMMITTER_EMAIL: 'priya@acme.test' },
      stdio: 'ignore',
    });
    git('merge', '-q', '--ff-only', `priya-${path.basename(from)}`);
    return path.join(repo, '.codetrellis', 'plans', path.basename(from));
  };

  test.beforeAll(async () => {
    dana = await setupHarness('plan-arrivals-dana');
    priya = await setupHarness('plan-arrivals-priya');
    repo = dana.fixture.projectPath;
    await dana.client.scanProject(repo);
    await priya.client.scanProject(priya.fixture.projectPath);
    agent = await dana.spawnAgent({ agentType: 'claude-code' });
  });

  test.afterAll(async () => {
    await dana?.teardown();
    await priya?.teardown();
  });

  test('Priya\'s committed plan, pulled and imported, says it is from her, in which commit', async () => {
    const p = await priyasPlan('Q4 forecast');
    forecast = p.uid;
    const dir = pull(p.dir);
    commit = git('log', '-1', '--format=%h');
    const res = await dana.client.raw('POST', '/api/plans/import', { planDir: dir });
    expect(res.ok, await res.clone().text()).toBe(true);

    const mine = await listed();
    expect(mine.find((x) => x.uid === forecast)?.arrival).toMatchObject({ addedBy: 'Priya Shah', commit });
  });

  test('her plan in the Stack, and in an agent\'s get_plan, says the same', async () => {
    const stack = (await (await dana.client.raw('GET', `/api/stack?project=${encodeURIComponent(repo)}`)).json()) as { plans: Array<{ uid: string; arrival?: string | null }> };
    expect(stack.plans.find((x) => x.uid === forecast)?.arrival).toBe(`from Priya Shah, in ${commit}`);
    const got = JSON.parse((await agent.callTool('get_plan', { plan_uid: forecast })).text) as { arrived_from?: { added_by: string; commit: string; says: string } };
    expect(got.arrived_from).toEqual({ added_by: 'Priya Shah', commit, says: `from Priya Shah, in ${commit}` });
  });

  test('Dana\'s own plan says nothing of the kind', async () => {
    const own = (await dana.client.createPlan({ title: 'Board pack', projectPath: repo })).uid;
    expect((await listed()).find((x) => x.uid === own)?.arrival).toBeNull();
    const got = JSON.parse((await agent.callTool('get_plan', { plan_uid: own })).text) as Record<string, unknown>;
    expect(got).not.toHaveProperty('arrived_from');
  });

  test('a plan folder copied in but not committed yet says so', async () => {
    const p = await priyasPlan('Hiring plan');
    const dir = land(p.dir);
    expect((await dana.client.raw('POST', '/api/plans/import', { planDir: dir })).ok).toBe(true);
    expect((await listed()).find((x) => x.uid === p.uid)?.arrival).toMatchObject({ addedBy: null, commit: null });
    const stack = (await (await dana.client.raw('GET', `/api/stack?project=${encodeURIComponent(repo)}`)).json()) as { plans: Array<{ uid: string; arrival?: string | null }> };
    expect(stack.plans.find((x) => x.uid === p.uid)?.arrival).toBe('arrived in its files, not committed yet');
  });

  test('once committed, the plan copied in learns who added it', async () => {
    const hiring = (await listed()).find((x) => x.title === 'Hiring plan')!;
    git('add', '-A', '.codetrellis');
    git('commit', '-q', '-m', 'plan: hiring');
    const hiringCommit = git('log', '-1', '--format=%h');
    const dir = path.join(repo, '.codetrellis', 'plans', fs.readdirSync(path.join(repo, '.codetrellis', 'plans')).find((d) => d.startsWith('hiring-plan'))!);
    expect((await dana.client.raw('POST', '/api/plans/import', { planDir: dir })).ok).toBe(true);
    expect((await listed()).find((x) => x.uid === hiring.uid)?.arrival).toMatchObject({ addedBy: 'Priya Shah', commit: hiringCommit });
  });

  test('importing it again changes nothing: it arrived once', async () => {
    const dir = path.join(repo, '.codetrellis', 'plans', fs.readdirSync(path.join(repo, '.codetrellis', 'plans')).find((d) => d.startsWith('q4-forecast'))!);
    expect((await dana.client.raw('POST', '/api/plans/import', { planDir: dir })).ok).toBe(true);
    expect((await listed()).find((x) => x.uid === forecast)?.arrival).toMatchObject({ addedBy: 'Priya Shah', commit });
  });
});
