/**
 * Phase 32 C2.2a — turning a review host on, per project, on this device.
 *
 * Sam's project pushes to github.com/acme/app. Settings → Review hosts says
 * what GitHub would be asked before anything is, and that it is off. He
 * turns it on and saves a token; the token is never shown again and never
 * leaves the secret store. When the remote is pointed at another repository
 * the switch no longer applies, and says why. A GitLab project has nothing
 * to turn on yet. Throughout, GitHub is not asked anything: reading it is
 * C2.2b. And only the person turns it on: from plain HTTP it is refused,
 * while turning it off is anyone's.
 */

import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

const TOKEN = 'github_pat_11ABCDEFG0123456789_secretpart';

interface Status {
  detected: { kind: string | null; hostname: string; slug: string; supported: boolean; asks: string | null } | null;
  enabled: boolean;
  turnedOnFor: string | null;
  changedBy: string | null;
  token: { saved: boolean; kind: string; where: string };
  says: string;
}

/** A stand-in for GitHub's API that only counts what reaches it. */
async function startStandIn() {
  const hits: string[] = [];
  const server = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.writeHead(404).end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test.describe.serial('Turning a review host on', () => {
  test.setTimeout(90_000);
  let h: Harness;
  let root: string;
  let standIn: Awaited<ReturnType<typeof startStandIn>>;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const enc = () => encodeURIComponent(root);
  const status = async () => (await (await h.client.raw('GET', `/api/review-host?project=${enc()}`)).json()) as Status;

  test.beforeAll(async () => {
    standIn = await startStandIn();
    h = await setupHarness('review-host-switch', { env: { CODETRELLIS_GITHUB_API: standIn.url } });
    root = h.fixture.projectPath;
    try { git('remote', 'remove', 'origin'); } catch { /* none yet */ }
    git('remote', 'add', 'origin', 'git@github.com:acme/app.git');
    await h.client.scanProject(root);
  });

  test.afterAll(async () => {
    await h?.teardown();
    await standIn?.close();
  });

  test('before anything: the host is named with what it would be asked, and it is off', async () => {
    const s = await status();
    expect(s.detected).toMatchObject({ kind: 'github', hostname: 'github.com', slug: 'acme/app', supported: true });
    expect(s.detected!.asks).toMatch(/^Reads the pull requests for this project's branches on github\.com\/acme\/app: .* It changes nothing on GitHub\.$/);
    expect(s).toMatchObject({ enabled: false, turnedOnFor: null, says: 'Off. Nothing is sent to GitHub; state comes from git.' });
    // No keychain under plain Node: a token would last until the app quits, and it says so.
    expect(s.token).toMatchObject({ saved: false, kind: 'memory' });
    expect(s.token.where).toMatch(/^kept only until CodeTrellis quits: /);
  });

  test('turned on, then a token saved: it says so, and the token is never shown again', async () => {
    const on = await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as Status).says).toBe('On: reads github.com/acme/app without a token, which works for a public repository only.');

    const saved = await h.client.raw('PUT', `/api/review-host/token?project=${enc()}`, { token: `  ${TOKEN}  ` });
    expect(saved.status).toBe(200);
    const body = await saved.text();
    expect(body).not.toContain(TOKEN);
    const s = JSON.parse(body) as Status;
    expect(s).toMatchObject({ enabled: true, says: 'On: reads github.com/acme/app with your token.' });
    expect(s.token.saved).toBe(true);
    expect(JSON.stringify(await status())).not.toContain(TOKEN);

    // A token that is not one is refused, and the saved one stays.
    const bad = await h.client.raw('PUT', `/api/review-host/token?project=${enc()}`, { token: 'has spaces in it' });
    expect(bad.status).toBe(400);
    expect((await status()).token.saved).toBe(true);
  });

  test('the remote is pointed at another repository: the switch no longer applies, and says why', async () => {
    git('remote', 'set-url', 'origin', 'https://github.com/acme/other.git');
    const s = await status();
    expect(s).toMatchObject({ enabled: false, turnedOnFor: 'github.com/acme/app' });
    expect(s.says).toBe('Turned on for github.com/acme/app, but the remote now names github.com/acme/other. Off until you turn it on for this one.');
    git('remote', 'set-url', 'origin', 'git@github.com:acme/app.git');
    expect((await status()).enabled).toBe(true);
  });

  test('forgetting the token and turning it off', async () => {
    const forgot = await h.client.raw('DELETE', `/api/review-host/token?project=${enc()}`);
    expect(((await forgot.json()) as Status).token.saved).toBe(false);
    const off = await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: false });
    expect(((await off.json()) as Status)).toMatchObject({ enabled: false, says: 'Off. Nothing is sent to GitHub; state comes from git.' });
  });

  test('a GitLab project has nothing to turn on yet; a project never opened is refused', async () => {
    git('remote', 'set-url', 'origin', 'git@gitlab.com:team/app.git');
    const s = await status();
    expect(s).toMatchObject({ enabled: false, says: 'GitLab is recognised; its adapter comes later. State comes from git alone.' });
    const refused = await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: true });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe('GitLab has no adapter yet; its state comes from git.');
    expect((await h.client.raw('PUT', `/api/review-host/token?project=${enc()}`, { token: TOKEN })).status).toBe(400);
    git('remote', 'set-url', 'origin', 'git@github.com:acme/app.git');

    expect((await h.client.raw('GET', '/api/review-host')).status).toBe(400);
    expect((await h.client.raw('GET', `/api/review-host?project=${encodeURIComponent('/etc')}`)).status).toBe(403);
    expect((await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: 'yes' })).status).toBe(400);
  });

  test('throughout, GitHub was asked nothing', async () => {
    expect(standIn.hits).toEqual([]);
  });
});

test.describe.serial('Only the person turns a review host on', () => {
  test.setTimeout(90_000);
  let h: Harness;
  let root: string;
  const enc = () => encodeURIComponent(root);

  test.beforeAll(async () => {
    h = await setupHarness('review-host-grant', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
    root = h.fixture.projectPath;
    try { execFileSync('git', ['-C', root, 'remote', 'remove', 'origin'], { stdio: 'ignore' }); } catch { /* none */ }
    execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'git@github.com:acme/app.git']);
    await h.client.scanProject(root);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('from plain HTTP, turning on and saving a token are refused with where to do it; turning off and forgetting are not', async () => {
    const on = await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: true });
    expect(on.status).toBe(403);
    expect((await on.json()).error).toBe('Only you can turn on a review host — in the CodeTrellis app, Settings → Review hosts.');
    const token = await h.client.raw('PUT', `/api/review-host/token?project=${enc()}`, { token: TOKEN });
    expect(token.status).toBe(403);
    expect((await token.json()).error).toBe("Only you can save a review host's token — in the CodeTrellis app, Settings → Review hosts.");

    const off = await h.client.raw('PUT', `/api/review-host?project=${enc()}`, { enabled: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as Status).changedBy).toMatch(/\(unverified\)$/);
    expect((await h.client.raw('DELETE', `/api/review-host/token?project=${enc()}`)).status).toBe(200);
    expect(((await (await h.client.raw('GET', `/api/review-host?project=${enc()}`)).json()) as Status).enabled).toBe(false);
  });
});
