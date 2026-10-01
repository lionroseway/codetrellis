/**
 * Phase 32 C2.3 — GitLab and Bitbucket behind the same switch, each against
 * a stand-in shaped like its API.
 *
 * Priya's team is on GitLab; Dan's is on Bitbucket. Each turns their host on
 * in Settings → Review hosts, and the plan says what the host knows in its
 * own words: GitLab's merge request "in review (!42)" with its pipeline and
 * approvals, merged or closed; Bitbucket's pull request with its build
 * statuses, merged or declined. Each token rides in its host's own header,
 * and in no answer. Nothing is asked before the host is turned on.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const SHA = (c: string) => c.repeat(40);

interface Hit { path: string; headers: http.IncomingHttpHeaders }
interface State { itemUid: string; state: string; source: string; words: string; hostNote?: string; review?: { ref?: string; url: string } }

async function standIn(route: (url: URL) => [number, unknown]) {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    hits.push({ path: `${url.pathname}${url.search}`, headers: req.headers });
    const [status, body] = route(url);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** A project on `remote` with three sections on three branches, each with work of its own. */
async function planOn(h: Harness, remote: string) {
  const root = h.fixture.projectPath;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  try { git('remote', 'remove', 'origin'); } catch { /* none */ }
  git('remote', 'add', 'origin', remote);
  const main = String(git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
  for (const b of ['billing', 'exports', 'refunds']) {
    git('checkout', '-q', '-b', b, main);
    fs.mkdirSync(path.join(root, 'src', b), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', b, 'index.ts'), `export const ${b} = 1;\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `${b}: work`);
    git('checkout', '-q', main);
  }
  await h.client.scanProject(root);
  const plan = (await h.client.createPlan({ title: 'Payments', projectPath: root })).uid;
  const uid: Record<string, string> = {};
  for (const b of ['billing', 'exports', 'refunds']) {
    uid[b] = ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'object', title: `${b} section` })).json()) as { uid: string }).uid;
  }
  expect((await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}&idle=1`)).ok).toBe(true);
  for (const b of ['billing', 'exports', 'refunds']) {
    const res = await h.client.raw('PUT', `/api/items/${uid[b]}/workstream`, { workstream: b });
    expect(res.ok, `${b}: ${await res.clone().text()}`).toBe(true);
  }
  const states = async () => {
    const body = (await (await h.client.raw('GET', `/api/plans/${plan}/git-state`)).json()) as { items: State[] };
    const name = Object.fromEntries(Object.entries(uid).map(([k, v]) => [v, k]));
    return Object.fromEntries(body.items.map((s) => [name[s.itemUid], s]));
  };
  const turnOn = async (token: string) => {
    const q = `?project=${encodeURIComponent(root)}`;
    expect((await h.client.raw('PUT', `/api/review-host${q}`, { enabled: true })).status).toBe(200);
    expect((await h.client.raw('PUT', `/api/review-host/token${q}`, { token })).status).toBe(200);
  };
  return { states, turnOn };
}

test.describe.serial('GitLab behind the review host', () => {
  test.setTimeout(120_000);
  // Made up, and assembled here so no commit holds a GitLab-shaped token (.gitleaksignore).
  const TOKEN = ['glpat', 'ABCDEFGHIJ0123456789'].join('-');
  let h: Harness;
  let gitlab: Awaited<ReturnType<typeof standIn>>;
  let p: Awaited<ReturnType<typeof planOn>>;
  const project = '/projects/team%2Fsub%2Fapp';
  const mrs: Record<string, object> = {
    billing: { iid: 42, web_url: 'https://gitlab.com/team/sub/app/-/merge_requests/42', state: 'opened', merged_at: null, closed_at: null, merge_commit_sha: null, source_branch: 'billing' },
    exports: { iid: 43, web_url: 'https://gitlab.com/team/sub/app/-/merge_requests/43', state: 'merged', merged_at: '2026-09-22T10:00:00Z', closed_at: null, merge_commit_sha: SHA('9'), squash_commit_sha: null, source_branch: 'exports' },
    refunds: { iid: 44, web_url: 'https://gitlab.com/team/sub/app/-/merge_requests/44', state: 'closed', merged_at: null, closed_at: '2026-09-23T08:00:00Z', merge_commit_sha: null, source_branch: 'refunds' },
  };

  test.beforeAll(async () => {
    gitlab = await standIn((url) => {
      if (url.pathname === `${project}/merge_requests`) {
        const mr = mrs[url.searchParams.get('source_branch') ?? ''];
        return [200, mr ? [mr] : []];
      }
      if (url.pathname === `${project}/merge_requests/42`) return [200, { ...mrs.billing, head_pipeline: { status: 'failed' }, detailed_merge_status: 'requested_changes' }];
      if (url.pathname === `${project}/merge_requests/42/approvals`) return [200, { approved_by: [{ user: { username: 'priya' } }] }];
      return [404, { message: '404 Not found' }];
    });
    h = await setupHarness('review-host-gitlab', { env: { CODETRELLIS_GITLAB_API: gitlab.url } });
    p = await planOn(h, 'git@gitlab.com:team/sub/app.git');
  });
  test.afterAll(async () => { await h?.teardown(); await gitlab?.close(); });

  test('off: git alone, and GitLab is asked nothing', async () => {
    const s = await p.states();
    expect(s.billing).toMatchObject({ state: 'building', source: 'git' });
    expect(gitlab.hits).toEqual([]);
  });

  test('on, with a token: merge requests in GitLab\'s words, the token in PRIVATE-TOKEN only', async () => {
    await p.turnOn(TOKEN);
    const s = await p.states();
    expect(s.billing).toMatchObject({ state: 'in-review', source: 'gitlab', words: 'in review (!42), checks failing, changes requested, 1 approval', review: { ref: '!42' } });
    expect(s.exports).toMatchObject({ state: 'merged', source: 'gitlab', words: 'merged into main (!43, 22 Sept)' });
    expect(s.refunds).toMatchObject({ state: 'closed', source: 'gitlab', words: 'closed without merging (!44, 23 Sept)' });
    expect(gitlab.hits.length).toBeGreaterThan(0);
    for (const hit of gitlab.hits) {
      expect(hit.path.startsWith(`${project}/merge_requests`)).toBe(true);
      expect(hit.headers['private-token']).toBe(TOKEN);
      expect(hit.headers.authorization).toBeUndefined();
    }
    expect(JSON.stringify(s)).not.toContain(TOKEN);
  });
});

test.describe.serial('Bitbucket behind the review host', () => {
  test.setTimeout(120_000);
  const TOKEN = 'ATCTT3xFfGN0bitbucket-token-0123456789';
  let h: Harness;
  let bitbucket: Awaited<ReturnType<typeof standIn>>;
  let p: Awaited<ReturnType<typeof planOn>>;
  const repo = '/repositories/acme/app';
  const pr = (id: number, branch: string, state: string, over: object = {}) => ({
    id, state, updated_on: '2026-09-23T08:00:00.000000+00:00', links: { html: { href: `https://bitbucket.org/acme/app/pull-requests/${id}` } },
    merge_commit: null, source: { branch: { name: branch }, commit: { hash: `${id}`.repeat(12).slice(0, 12) } }, ...over,
  });
  const prs: Record<string, object> = {
    billing: pr(7, 'billing', 'OPEN'),
    exports: pr(8, 'exports', 'MERGED', { merge_commit: { hash: 'f00dfeedbeef' } }),
    refunds: pr(9, 'refunds', 'DECLINED'),
  };

  test.beforeAll(async () => {
    bitbucket = await standIn((url) => {
      if (url.pathname === `${repo}/pullrequests`) {
        const branch = /source\.branch\.name="([^"]+)"/.exec(url.searchParams.get('q') ?? '')?.[1] ?? '';
        return [200, { values: prs[branch] ? [prs[branch]] : [] }];
      }
      if (url.pathname === `${repo}/pullrequests/7`) return [200, { ...prs.billing, participants: [{ approved: true, state: 'approved' }, { approved: true, state: 'approved' }] }];
      if (url.pathname.startsWith(`${repo}/commit/`) && url.pathname.endsWith('/statuses')) return [200, { values: [{ state: 'SUCCESSFUL' }] }];
      return [404, { type: 'error' }];
    });
    h = await setupHarness('review-host-bitbucket', { env: { CODETRELLIS_BITBUCKET_API: bitbucket.url } });
    p = await planOn(h, 'git@bitbucket.org:acme/app.git');
  });
  test.afterAll(async () => { await h?.teardown(); await bitbucket?.close(); });

  test('off: git alone, and Bitbucket is asked nothing', async () => {
    const s = await p.states();
    expect(s.billing).toMatchObject({ state: 'building', source: 'git' });
    expect(bitbucket.hits).toEqual([]);
  });

  test('on, with a token: pull requests in Bitbucket\'s words, declined reads closed, the token as a bearer only', async () => {
    await p.turnOn(TOKEN);
    const s = await p.states();
    expect(s.billing).toMatchObject({ state: 'in-review', source: 'bitbucket', words: 'in review (#7), checks passing, 2 approvals' });
    expect(s.exports).toMatchObject({ state: 'merged', source: 'bitbucket', words: 'merged into main (#8, 23 Sept)' });
    expect(s.refunds).toMatchObject({ state: 'closed', source: 'bitbucket', words: 'closed without merging (#9, 23 Sept)' });
    for (const hit of bitbucket.hits) {
      expect(hit.path.startsWith(`${repo}/`)).toBe(true);
      expect(hit.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(JSON.stringify(s)).not.toContain(TOKEN);
  });
});
