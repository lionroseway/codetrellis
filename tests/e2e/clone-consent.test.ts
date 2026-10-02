/**
 * Clones need consent (Phase 32 A1.7c).
 *
 * An agent connected through the connector reports its folder. When that is
 * no trusted root, nothing is read from it: it becomes a request the person
 * answers. Including it is a grant (app window only); only then is it checked
 * to be a clone of the opened repository, trusted, and listed as a workstream
 * with the agent bound to it. "Not now", and a folder that turns out not to be
 * a clone, are not asked about again.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

interface FolderRequest { id: string; folder: string; agentType: string }
interface Workstream { root: string; shape: string; branch: string | null; agents: Array<{ sessionId: string; source: string }>; changes: { files: Array<{ path: string }> } }

const ORIGIN = 'https://github.com/example/acme-payments.git';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf-8' });

test.describe.serial('Clones need consent', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let clone: string;
  let unrelated: string;
  let plain: string;
  const agents: ScriptedMcp[] = [];

  const requests = async () => (await (await h.client.raw('GET', '/api/workstreams/folder-requests')).json()) as FolderRequest[];
  const workstreams = async () =>
    (await (await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}&idle=1`)).json()) as Workstream[];
  const agentIn = async (cwd: string, clientName = 'claude-code') => {
    const a = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName, cwd });
    await a.connect();
    agents.push(a);
    return a;
  };
  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);

  test.beforeAll(async () => {
    h = await setupHarness('clone-consent');
    root = h.fixture.projectPath;
    git(root, 'remote', 'add', 'origin', ORIGIN);
    await h.client.scanProject(root); // records the project's origin

    clone = path.join(h.fixture.tmpDir, 'acme-clone');
    execFileSync('git', ['clone', '-q', root, clone], { env: ENV });
    git(clone, 'remote', 'set-url', 'origin', ORIGIN); // a clone of the same remote
    unrelated = path.join(h.fixture.tmpDir, 'other-repo');
    fs.mkdirSync(unrelated);
    git(unrelated, 'init', '-q');
    git(unrelated, 'remote', 'add', 'origin', 'https://github.com/example/something-else.git');
    plain = path.join(h.fixture.tmpDir, 'scratch');
    fs.mkdirSync(plain);
  });

  test.afterAll(async () => {
    for (const a of agents) await a.disconnect().catch(() => {});
    await h?.teardown();
  });

  test('an agent in a folder CodeTrellis has not opened becomes a request, once per folder', async () => {
    await agentIn(clone);
    await agentIn(clone, 'codex');
    await expect.poll(async () => (await requests()).map((r) => r.folder), { timeout: 10_000 }).toEqual([path.resolve(clone)]);
    // Nothing is trusted or read yet: it is not a workstream.
    expect((await workstreams()).some((w) => same(w.root, clone))).toBe(false);
  });

  test('including it checks it is a clone, trusts it, and binds the agents that reported it', async () => {
    const [req] = await requests();
    const res = await h.client.raw('POST', `/api/workstreams/folder-requests/${req.id}/include`);
    expect(res.status).toBe(200);
    expect(await requests()).toEqual([]);
    const ws = (await workstreams()).find((w) => same(w.root, clone));
    expect(ws).toMatchObject({ shape: 'clone' });
    expect(ws!.agents.map((a) => a.source)).toEqual(['mcp', 'mcp']);
  });

  test("the clone's work shows like a worktree's", async () => {
    fs.writeFileSync(path.join(clone, 'from-the-clone.ts'), 'export function fromTheClone() { return 1; }\n');
    await expect.poll(async () => (await workstreams()).find((w) => same(w.root, clone))?.changes.files.map((f) => f.path), { timeout: 10_000 })
      .toContain('from-the-clone.ts');
  });

  test('a folder that is not a clone is refused, with the reason, and not asked about again', async () => {
    await agentIn(unrelated);
    await expect.poll(async () => (await requests()).length, { timeout: 10_000 }).toBe(1);
    const [req] = await requests();
    const res = await h.client.raw('POST', `/api/workstreams/folder-requests/${req.id}/include`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toContain('not a clone of this repository');
    expect((await workstreams()).some((w) => same(w.root, unrelated))).toBe(false);
    await agentIn(unrelated);
    await new Promise((r) => setTimeout(r, 500));
    expect(await requests()).toEqual([]);
  });

  test('"not now" is remembered', async () => {
    await agentIn(plain);
    await expect.poll(async () => (await requests()).length, { timeout: 10_000 }).toBe(1);
    const [req] = await requests();
    expect((await h.client.raw('POST', `/api/workstreams/folder-requests/${req.id}/dismiss`)).status).toBe(200);
    await agentIn(plain);
    await new Promise((r) => setTimeout(r, 500));
    expect(await requests()).toEqual([]);
  });

  test('requests are chosen by the id the server gave them, never a path', async () => {
    expect((await h.client.raw('POST', '/api/workstreams/folder-requests/not-a-real-id/include')).status).toBe(404);
    expect((await h.client.raw('POST', `/api/workstreams/folder-requests/${encodeURIComponent('/etc')}/include`)).status).toBe(404);
  });
});

test.describe.serial('Including a folder is a grant', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let agent: ScriptedMcp;

  test.beforeAll(async () => {
    // A backend that refuses grants over plain HTTP, as a real one does.
    h = await setupHarness('clone-consent-refused', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
    await h.client.scanProject(h.fixture.projectPath);
    const elsewhere = path.join(h.fixture.tmpDir, 'elsewhere');
    fs.mkdirSync(elsewhere);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, cwd: elsewhere });
    await agent.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    await h?.teardown();
  });

  test('plain HTTP (anything holding the token) cannot include it; the request stays for the person', async () => {
    let reqs: FolderRequest[] = [];
    await expect.poll(async () => (reqs = (await (await h.client.raw('GET', '/api/workstreams/folder-requests')).json()) as FolderRequest[]).length, { timeout: 10_000 }).toBe(1);
    const res = await h.client.raw('POST', `/api/workstreams/folder-requests/${reqs[0].id}/include`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain('Only you can include a folder');
    expect(((await (await h.client.raw('GET', '/api/workstreams/folder-requests')).json()) as FolderRequest[])).toHaveLength(1);
  });
});
