/**
 * Phase 32 E6 — the Track E done-when: how the code got here, with no plan.
 *
 * A repository nobody planned in. A teammate's agent (codex) works on
 * `billing-v2` in a worktree of it: one commit whose message names it, one
 * made while its session was open there, and an edit not yet committed;
 * then it pushes the branch and opens a pull request.
 *
 * Without a plan, the person:
 *  1. sees its changes in the Changes panel (`/api/source-control`);
 *  2. finds a surprising line, and its history names the commit, the git
 *     author, the agent and the session (`/api/git/line-history`);
 *  3. puts its file beside the same file on main and scrubs both
 *     (`/api/git/file-history`, `/api/file/at`, `/api/git/refs/compare`);
 *  4. after Fetch now, sees the branch it pushed and its pull request,
 *     whose Compare pair shows the change (`/api/git/fetch`,
 *     `/api/git/branches`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, waitFor, type Harness, type ScriptedMcp } from '../harness';
import { createMcpClient } from '../harness/mcp-client';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const FILE = 'billing/refund.ts';

interface Attribution { agent: string; how: string; words: string; sessionId?: string | null }
interface Commit { sha: string; author: string; subject: string; attribution: Attribution | null }
interface Lines { hunks: Array<{ start: number; end: number; sha: string | null }>; commits: Record<string, Commit>; uncommitted: number; command: string }
interface Position { spec: string; kind: string; path: string; sha: string | null; at: number | null; author: string | null; subject: string | null; attribution: Attribution | null }

test.describe.serial('Track E: how the code got here, with no plan', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let root: string;
  let worktree: string;
  let main: string;
  let agent: ScriptedMcp;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-history-e-'));
  const prs = path.join(tmp, 'prs.json');
  const fakeGh = path.join(tmp, 'gh');

  const q = () => `project=${encodeURIComponent(root)}`;
  const get = async <T>(url: string) => {
    const res = await h.client.raw('GET', url);
    expect(res.status, url).toBe(200);
    return (await res.json()) as T;
  };

  test.beforeAll(async () => {
    fs.writeFileSync(prs, '[]');
    fs.writeFileSync(fakeGh, `#!/bin/sh\ncat "${prs}"\n`, { mode: 0o755 });
    h = await setupHarness('history-e', { env: { CODETRELLIS_GH: fakeGh } });
    root = h.fixture.projectPath;
    git(root, 'config', 'user.name', 'Sam Lee');
    git(root, 'config', 'user.email', 'sam@acme.test');
    main = git(root, 'symbolic-ref', '--short', 'HEAD');
    fs.mkdirSync(path.join(root, 'billing'), { recursive: true });
    fs.writeFileSync(path.join(root, FILE), 'export const refund = (x: number) => Math.round(x);\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'Refunds');
    const remote = path.join(tmp, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', main, remote]);
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'push', '-q', '-u', 'origin', main);
    await h.client.scanProject(root);

    // The teammate's agent's worktree, on billing-v2.
    worktree = `${root}-billing`;
    git(root, 'worktree', 'add', '-q', '-b', 'billing-v2', worktree, main);
    fs.writeFileSync(path.join(worktree, FILE), 'export const refund = (x: number) => Math.round(x * 100) / 100;\n');
    git(worktree, 'commit', '-qam', 'Round to the cent\n\nagent: codex · model: o5');
    // Commit times are whole seconds: its session opens clearly after.
    await new Promise((r) => setTimeout(r, 1500));
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [worktree] });
    await agent.connect();
    fs.appendFileSync(path.join(worktree, FILE), 'export const halfEven = (x: number) => x; // banker\'s rounding\n');
    git(worktree, 'commit', '-qam', 'Half-even');
    fs.appendFileSync(path.join(worktree, FILE), '// TODO: currencies\n');
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    if (worktree) { try { git(root, 'worktree', 'remove', '--force', worktree); } catch { /* */ } }
    await h?.teardown();
  });

  test('there is no plan, and the Changes panel lists what the agent changed in its worktree', async () => {
    expect(await h.client.listPlans()).toEqual([]);
    interface Group { kind: string; files: Array<{ path: string }>; workstream?: { branch: string | null; agents: string[] } }
    const group = await waitFor(async () => {
      const sc = await get<{ groups: Group[] }>(`/api/source-control?${q()}`);
      return sc.groups.find((g) => g.kind === 'workstream' && g.workstream?.branch === 'billing-v2' && g.workstream.agents.includes('codex')) ?? null;
    }, { timeoutMs: 30_000, description: 'the worktree group, with codex in it' });
    expect(group.files.map((f) => f.path)).toEqual([FILE]);
  });

  test('a surprising line: its commit, its git author, the agent, and its session', async () => {
    const r = await get<Lines>(`/api/git/line-history?${q()}&at=${encodeURIComponent(`workstream:${worktree}`)}&path=${encodeURIComponent(FILE)}`);
    const commitOf = (line: number) => r.commits[r.hunks.find((x) => line >= x.start && line <= x.end)!.sha!];
    expect(commitOf(1)).toMatchObject({ subject: 'Round to the cent', author: 'Sam Lee', attribution: { agent: 'codex', how: 'commit message' } });
    // The banker's-rounding line: made while codex's session was open in that worktree.
    const surprising = commitOf(2);
    expect(surprising).toMatchObject({ subject: 'Half-even', author: 'Sam Lee' });
    expect(surprising.attribution).toMatchObject({ agent: 'codex', how: 'timing', words: "probably codex: committed while codex's session was open in this checkout" });
    expect(surprising.attribution!.sessionId).toBeTruthy();
    expect(r.hunks.at(-1)).toEqual({ start: 3, end: 3, sha: null });
    expect(r.uncommitted).toBe(1);
    // The agent asks the same.
    const said = ((await agent.callTool('line_history', { path: FILE, line: 1, at: 'commit:refs/heads/billing-v2' })).content as Array<{ text: string }>)[0].text;
    expect(said).toContain('codex, from the commit message');
  });

  test('its file beside the same file on main, each side scrubbed through its own commits', async () => {
    const side = async (at: string) => get<{ positions: Position[]; command: string }>(`/api/git/file-history?${q()}&at=${encodeURIComponent(at)}&path=${encodeURIComponent(FILE)}`);
    const left = await side('commit:refs/heads/billing-v2');
    expect(left.positions.map((p) => p.subject)).toEqual(['Half-even', 'Round to the cent', 'Refunds']);
    expect(left.positions[1].attribution).toMatchObject({ agent: 'codex', how: 'commit message' });
    expect(left.command).toBe(`git log --follow billing-v2 -- ${FILE}`);
    const right = await side(`commit:refs/heads/${main}`);
    expect(right.positions.map((p) => p.subject)).toEqual(['Refunds']);
    // Scrubbing the left back to the cent, against main: the file at each position.
    const at = async (spec: string) => ((await get<{ content: string | null }>(`/api/file/at?${q()}&path=${encodeURIComponent(FILE)}&at=${encodeURIComponent(spec)}`)).content);
    expect(await at(left.positions[1].spec)).toBe('export const refund = (x: number) => Math.round(x * 100) / 100;\n');
    expect(await at(left.positions[0].spec)).toContain("banker's rounding");
    expect(await at(right.positions[0].spec)).toBe('export const refund = (x: number) => Math.round(x);\n');
    const pair = await get<{ files: Array<{ path: string; status: string }> }>(`/api/git/refs/compare?${q()}&before=${encodeURIComponent(right.positions[0].spec)}&after=${encodeURIComponent(left.positions[1].spec)}`);
    expect(pair.files).toEqual([{ path: FILE, status: 'modified' }]);
  });

  test('after Fetch now, the branch it pushed and its pull request show', async () => {
    git(worktree, 'push', '-q', 'origin', 'billing-v2');
    fs.writeFileSync(prs, JSON.stringify([{
      number: 12, title: 'Refunds round half-even', state: 'OPEN', isDraft: false, headRefName: 'billing-v2', baseRefName: main,
      author: { login: 'teammate' }, updatedAt: new Date().toISOString(), url: 'https://github.com/acme/billing/pull/12', reviewDecision: 'REVIEW_REQUIRED',
    }]));
    interface Listing { remoteBranches: Array<{ name: string }>; pulls: { status: string; pulls: Array<{ number: number; state: string; review: string | null; compare: { before: string; after: string } | null }> } }
    expect((await get<Listing>(`/api/git/branches?${q()}`)).pulls.status).toBe('never');
    const fetched = await h.client.raw('POST', `/api/git/fetch?${q()}`);
    expect(fetched.status).toBe(200);
    const l = await get<Listing>(`/api/git/branches?${q()}`);
    expect(l.remoteBranches.map((b) => b.name)).toContain('origin/billing-v2');
    expect(l.pulls.status).toBe('ok');
    const [pr] = l.pulls.pulls;
    expect(pr).toMatchObject({ number: 12, state: 'open', review: 'waiting on review' });
    const cmp = await get<{ files: Array<{ path: string; status: string }>; command: string }>(
      `/api/git/refs/compare?${q()}&before=${encodeURIComponent(pr.compare!.before)}&after=${encodeURIComponent(pr.compare!.after)}`);
    expect(cmp.files).toEqual([{ path: FILE, status: 'modified' }]);
    expect(cmp.command).toBe(`git diff origin/${main}...origin/billing-v2`);
  });
});
