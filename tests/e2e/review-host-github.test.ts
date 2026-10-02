/**
 * Phase 32 C2.2b — GitHub behind the review host, against a stand-in.
 *
 * Sam's plan has four sections on four branches of github.com/acme/app.
 * Git alone says each is "building". Nothing is asked of GitHub until he
 * turns it on in Settings → Review hosts; then each section says what GitHub
 * knows and git cannot: Billing in review with its checks and approval,
 * Exports merged by its pull request, Refunds closed without merging, Docs
 * with no pull request at all. With a token, the token rides in those
 * requests and nowhere else. A refused token leaves git's answer standing,
 * with why. Turned off, GitHub is not asked again. An agent's get_plan and
 * get_brief say the same, with the source.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const TOKEN = 'github_pat_11ABCDEFG0123456789_secretpart';
const SHA = (c: string) => c.repeat(40);

interface State { itemUid: string; branch: string; state: string; source: string; words: string; hostNote?: string; review?: { number: number } }

/** A stand-in for the parts of GitHub's REST API the adapter reads. */
async function startGithub() {
  const hits: Array<{ path: string; auth: string | null }> = [];
  let refuse = false;
  const pulls: Record<string, object> = {
    billing: { number: 118, html_url: 'https://github.com/acme/app/pull/118', state: 'open', merged_at: null, closed_at: null, merge_commit_sha: null, head: { sha: SHA('1'), ref: 'billing' } },
    exports: { number: 119, html_url: 'https://github.com/acme/app/pull/119', state: 'closed', merged_at: '2026-09-22T10:00:00Z', closed_at: '2026-09-22T10:00:00Z', merge_commit_sha: SHA('9'), head: { sha: SHA('2'), ref: 'exports' } },
    refunds: { number: 120, html_url: 'https://github.com/acme/app/pull/120', state: 'closed', merged_at: null, closed_at: '2026-09-23T08:00:00Z', merge_commit_sha: null, head: { sha: SHA('3'), ref: 'refunds' } },
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    hits.push({ path: `${url.pathname}${url.search}`, auth: req.headers.authorization ?? null });
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)); };
    if (refuse) return json(401, { message: 'Bad credentials' });
    if (url.pathname === '/repos/acme/app/pulls') {
      const branch = (url.searchParams.get('head') ?? '').replace(/^acme:/, '');
      return json(200, pulls[branch] ? [pulls[branch]] : []);
    }
    if (url.pathname === `/repos/acme/app/commits/${SHA('1')}/check-runs`) {
      return json(200, { total_count: 2, check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'neutral' }] });
    }
    if (url.pathname === `/repos/acme/app/commits/${SHA('1')}/status`) return json(200, { state: 'pending', total_count: 0 });
    if (url.pathname === '/repos/acme/app/pulls/118/reviews') return json(200, [{ user: { login: 'priya' }, state: 'APPROVED' }]);
    return json(404, { message: 'Not Found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`, hits,
    refuse: (on: boolean) => { refuse = on; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test.describe.serial('GitHub behind the review host', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let plan: string;
  let agent: ScriptedAgent;
  let github: Awaited<ReturnType<typeof startGithub>>;
  const uid: Record<string, string> = {};
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const enc = () => encodeURIComponent(root);
  const states = async () => {
    const body = (await (await h.client.raw('GET', `/api/plans/${plan}/git-state`)).json()) as { items: State[] };
    return Object.fromEntries(body.items.filter((s) => s.itemUid in byUid()).map((s) => [byUid()[s.itemUid], s]));
  };
  const byUid = () => Object.fromEntries(Object.entries(uid).map(([k, v]) => [v, k]));

  test.beforeAll(async () => {
    github = await startGithub();
    h = await setupHarness('review-host-github', { env: { CODETRELLIS_GITHUB_API: github.url } });
    root = h.fixture.projectPath;
    try { git('remote', 'remove', 'origin'); } catch { /* none */ }
    git('remote', 'add', 'origin', 'git@github.com:acme/app.git');
    // Each branch with work of its own, so the window lists it as a line of work to assign.
    const main = String(git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
    for (const b of ['billing', 'exports', 'refunds', 'docs']) {
      git('checkout', '-q', '-b', b, main);
      fs.mkdirSync(path.join(root, 'src', b), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', b, 'index.ts'), `export const ${b} = 1;\n`);
      git('add', '-A');
      execFileSync('git', ['-C', root, 'commit', '-q', '-m', `${b}: work`], { env: ENV });
      git('checkout', '-q', main);
    }
    await h.client.scanProject(root);
    plan = (await h.client.createPlan({ title: 'Payments', projectPath: root })).uid;
    for (const b of ['billing', 'exports', 'refunds', 'docs']) {
      uid[b] = ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'object', title: `${b} section` })).json()) as { uid: string }).uid;
    }
    uid.task = ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title: 'Charge in the right currency', parentUid: uid.billing })).json()) as { uid: string }).uid;
    expect((await h.client.raw('GET', `/api/workstreams?project=${enc()}&idle=1`)).ok).toBe(true);
    for (const b of ['billing', 'exports', 'refunds', 'docs']) {
      const res = await h.client.raw('PUT', `/api/items/${uid[b]}/workstream`, { workstream: b });
      expect(res.ok, `${b}: ${await res.clone().text()}`).toBe(true);
    }
    agent = await h.spawnAgent({ agentType: 'codex' });
  });

  test.afterAll(async () => {
    await h?.teardown();
    await github?.close();
  });

  test('off: git alone says each is building, and GitHub is asked nothing', async () => {
    const s = await states();
    for (const b of ['billing', 'exports', 'refunds', 'docs']) expect(s[b]).toMatchObject({ state: 'building', source: 'git' });
    expect(github.hits).toEqual([]);
  });

  test('turned on: each section says what GitHub knows and git cannot, from GitHub; no token, no Authorization', async () => {
    expect((await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: true })).status).toBe(200);
    const s = await states();
    expect(s.billing).toMatchObject({ state: 'in-review', source: 'github', words: 'in review (#118), checks passing, 1 approval', review: { number: 118 } });
    expect(s.task).toMatchObject({ state: 'in-review', source: 'github', branch: 'billing' });
    expect(s.exports).toMatchObject({ state: 'merged', source: 'github', words: 'merged into main (#119, 22 Sept)' });
    expect(s.refunds).toMatchObject({ state: 'closed', source: 'github', words: 'closed without merging (#120, 23 Sept)' });
    expect(s.docs).toMatchObject({ state: 'building', source: 'git', hostNote: 'GitHub has no pull request for this branch.' });
    expect(github.hits.length).toBeGreaterThan(0);
    expect(github.hits.every((hit) => hit.auth === null)).toBe(true);
    // Only reads, and only this repository.
    expect(github.hits.every((hit) => hit.path.startsWith('/repos/acme/app/'))).toBe(true);
  });

  test('asked again within two minutes: answered from what is kept, GitHub not asked', async () => {
    const before = github.hits.length;
    await states();
    await states();
    expect(github.hits.length).toBe(before);
  });

  test('with a token: it rides in GitHub\'s requests only, and appears in no answer', async () => {
    const before = github.hits.length;
    expect((await h.client.raw('PUT', `/api/review-host/token?project=${enc()}`, { token: TOKEN })).status).toBe(200);
    const res = await h.client.raw('GET', `/api/plans/${plan}/git-state`);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    const fresh = github.hits.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((hit) => hit.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  test('an agent reads the same, with the source and the pull request', async () => {
    const got = JSON.parse((await agent.callTool('get_plan', { plan_uid: plan })).answer) as {
      git_state: { items: Array<{ title: string; state: string; says: string; source: string; pull_request?: { number: number } }>; note: string };
    };
    const byTitle = Object.fromEntries(got.git_state.items.map((i) => [i.title, i]));
    expect(byTitle['billing section']).toMatchObject({ state: 'in-review', source: 'github', says: 'in review (#118), checks passing, 1 approval', pull_request: { number: 118 } });
    expect(byTitle['refunds section']).toMatchObject({ state: 'closed', source: 'github' });
    expect(got.git_state.note).toContain('source names which');
    const brief = JSON.parse((await agent.callTool('get_brief', { item_uid: uid.task })).answer) as { git_state: { state: string; source: string; says: string } };
    expect(brief.git_state).toMatchObject({ state: 'in-review', source: 'github', says: 'in review (#118), checks passing, 1 approval' });
    expect(JSON.stringify(got) + JSON.stringify(brief)).not.toContain(TOKEN);
  });

  test('GitHub refuses the token: git\'s answer stands, with why', async () => {
    github.refuse(true);
    // Turning it off and on again forgets what was kept, so GitHub is asked afresh.
    await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: false });
    await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: true });
    const s = await states();
    expect(s.billing).toMatchObject({ state: 'building', source: 'git', hostNote: 'GitHub refused the token (401). Save a new one in Settings → Review hosts.' });
    github.refuse(false);
  });

  test('turned off: git alone again, and GitHub is not asked', async () => {
    await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: false });
    const before = github.hits.length;
    const s = await states();
    expect(s.billing).toMatchObject({ state: 'building', source: 'git' });
    expect(s.billing.hostNote).toBeUndefined();
    const brief = JSON.parse((await agent.callTool('get_brief', { item_uid: uid.task })).answer) as { git_state: { source: string } };
    expect(brief.git_state.source).toBe('git');
    await new Promise((r) => setTimeout(r, 200));
    expect(github.hits.length).toBe(before);
  });
});
