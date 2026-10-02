/**
 * Phase 32 E4 — line history, end to end.
 *
 * In the opened repository: a line a person wrote, a line from an agent's
 * own commit (its message names it), a line from a Claude Code commit (its
 * Co-Authored-By trailer names it), and a line committed while codex's
 * session was open in this checkout, with codex on a task. GET
 * /api/git/line-history gives each line's commit and git author, and what
 * CodeTrellis adds with how it knows; `line_history` says the same to an
 * agent; a line not committed says so. Refusals.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedMcp } from '../harness';
import { createMcpClient } from '../harness/mcp-client';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };

interface Commit { sha: string; author: string; subject: string; attribution: { agent: string; how: string; words: string; sessionId?: string; task?: { title: string } | null; plan?: { title: string } | null } | null }
interface History { lineCount: number; hunks: Array<{ start: number; end: number; sha: string | null }>; commits: Record<string, Commit>; uncommitted: number; command: string }

test.describe.serial('Line history', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let agent: ScriptedMcp;
  const FILE = 'billing/refund.ts';

  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const q = () => `project=${encodeURIComponent(root)}`;
  const history = async (at = 'live', rel = FILE) => {
    const res = await h.client.raw('GET', `/api/git/line-history?${q()}&at=${encodeURIComponent(at)}&path=${encodeURIComponent(rel)}`);
    return { status: res.status, body: (await res.json()) as History & { error?: string } };
  };
  const lineCommit = (body: History, line: number) => body.commits[body.hunks.find((x) => line >= x.start && line <= x.end)!.sha!];

  test.beforeAll(async () => {
    h = await setupHarness('line-history');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    fs.mkdirSync(path.join(root, 'billing'), { recursive: true });
    fs.writeFileSync(path.join(root, FILE), 'export const a = 1;\n');
    git('add', '-A');
    git('commit', '-qm', 'Start refunds');
    fs.appendFileSync(path.join(root, FILE), 'export const cents = (x: number) => Math.round(x * 100) / 100;\n');
    git('commit', '-qam', 'Round to the cent\n\nagent: codex · model: o5');
    fs.appendFileSync(path.join(root, FILE), 'export const halfEven = true;\n');
    git('commit', '-qam', 'Half-even\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>');

    // codex works in this checkout on a task; a commit lands while its session is open.
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await agent.connect();
    const planUid = (await h.client.createPlan({ title: 'Refunds to the cent', projectPath: root })).uid;
    const item = ((await (await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Round refunds' })).json()) as { uid: string }).uid;
    expect((await agent.callTool('claim_item', { uid: item })).isError).toBeFalsy();
    fs.appendFileSync(path.join(root, FILE), 'export const refund = (x: number) => cents(x);\n');
    git('commit', '-qam', 'Refund in cents');
    // And a line not yet committed.
    fs.appendFileSync(path.join(root, FILE), '// working on it\n');
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    await h?.teardown();
  });

  test('each line: its commit and git author, and what CodeTrellis knows, with how', async () => {
    const r = await history();
    expect(r.status).toBe(200);
    expect(r.body.lineCount).toBe(5);
    expect(r.body.command).toBe(`git blame -- ${FILE}`);
    expect([1, 2, 3, 4].map((n) => lineCommit(r.body, n).subject)).toEqual(['Start refunds', 'Round to the cent', 'Half-even', 'Refund in cents']);
    // The git author, always.
    expect([1, 2, 3, 4].every((n) => lineCommit(r.body, n).author === 'Sam Lee')).toBe(true);
    // A person's line: the git author only.
    expect(lineCommit(r.body, 1).attribution).toBeNull();
    expect(lineCommit(r.body, 2).attribution).toMatchObject({ agent: 'codex', how: 'commit message', words: 'codex, from the commit message' });
    expect(lineCommit(r.body, 3).attribution).toMatchObject({ agent: 'claude', how: 'commit message' });
    // Timing: committed while codex's session was open here, on its task.
    expect(lineCommit(r.body, 4).attribution).toMatchObject({
      agent: 'codex', how: 'timing', words: "probably codex: committed while codex's session was open in this checkout",
      task: { title: 'Round refunds' }, plan: { title: 'Refunds to the cent' },
    });
    // Not yet committed.
    expect(r.body.hunks.at(-1)).toEqual({ start: 5, end: 5, sha: null });
    expect(r.body.uncommitted).toBe(1);
  });

  test('an agent asks with line_history and gets the same, in words', async () => {
    const one = await agent.callTool('line_history', { path: FILE, line: 2 });
    expect(one.isError).toBeFalsy();
    const text = (one.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/^Line 2: Sam Lee · (just now|\d+ h ago) · “Round to the cent” \([0-9a-f]{7}\); codex, from the commit message\.\n\n\$ git blame -- billing\/refund\.ts$/);
    const four = (await agent.callTool('line_history', { path: FILE, line: 4 })).content as Array<{ text: string }>;
    expect(four[0].text).toContain('task “Round refunds” in the plan “Refunds to the cent”');
    const all = (await agent.callTool('line_history', { path: FILE })).content as Array<{ text: string }>;
    expect(all[0].text.split('\n')[0]).toBe(`${FILE}: 5 runs of lines.`);
    expect(all[0].text).toContain('Line 5 is changed in the working copy and not yet committed.');
    expect((await agent.callTool('line_history', { path: '../etc/passwd' })).isError).toBe(true);
  });

  test('a branch reads its own lines', async () => {
    const branch = git('symbolic-ref', '--short', 'HEAD');
    const r = await history(`commit:refs/heads/${branch}`);
    expect(r.body.lineCount).toBe(4);
    expect(r.body.uncommitted).toBe(0);
    expect(r.body.command).toBe(`git blame ${branch} -- ${FILE}`);
  });

  test('refused: a path that climbs out or is an option, a ref that is an option, a file git does not know, a project not open', async () => {
    for (const p of ['../etc/passwd', '/etc/passwd', '-x', ':(top)x']) expect((await history('live', p)).status, p).toBe(400);
    expect((await history('commit:--output=/tmp/x')).status).toBe(400);
    expect((await history('workstream:/etc')).status).toBe(400);
    const unknown = await history('live', 'never/here.ts');
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/^git has no history for never\/here\.ts here/);
    expect((await h.client.raw('GET', `/api/git/line-history?project=${encodeURIComponent('/not/opened')}&path=a.ts`)).status).toBe(403);
  });
});
