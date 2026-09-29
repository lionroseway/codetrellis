/**
 * Line changes per workstream (Phase 32 B3.1), end to end: two worktrees of
 * the fixture repository, real edits on disk (one committed, one not), the
 * running backend's parser and git. A person asks over REST; an agent asks
 * over MCP as a plain client with no hook, and is told the other side's
 * lines, never its own unless it names itself.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

interface Hunk { kind: string; old: { start: number; lines: number }; new: { start: number; lines: number }; functions: string[]; committed: boolean }
interface Changes { workstream: string; branch: string | null; path: string; status: string; hunks: Hunk[]; added: number; removed: number; diff?: string }

const REL = 'packages/shared/src/validators.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Line changes per workstream', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let exportsDir: string;
  let agent: ScriptedMcp;

  const edit = (folder: string, from: string, to: string) => {
    const f = path.join(folder, REL);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
  };

  test.beforeAll(async () => {
    h = await setupHarness('line-changes');
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    exportsDir = `${root}-exports`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [exportsDir, 'exports']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    // exports: one line of validateCreateUser, committed.
    edit(exportsDir, "errors.push('name is required')", "errors.push('name is required and must be text')");
    execFileSync('git', ['-C', exportsDir, 'commit', '-q', '-am', 'clearer name error'], { env: ENV });
    // billing-v2: a line added to validateCreateOrder, not committed.
    edit(billing, "  if (!Number.isFinite(payload.amount) || payload.amount <= 0) errors.push('amount must be a positive number');\n",
      "  if (!Number.isFinite(payload.amount) || payload.amount <= 0) errors.push('amount must be a positive number');\n  if (!payload.currency) errors.push('currency is required');\n");
    await h.client.scanProject(root);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'aider', roots: [billing] });
    await agent.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    for (const w of [billing, exportsDir]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('a person sees each workstream changing the file: its lines, their function, committed or not', async () => {
    const res = await h.client.raw('GET', `/api/workstreams/changes?project=${encodeURIComponent(root)}&path=${encodeURIComponent(REL)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; changes: Changes[] };
    expect(body.path).toBe(REL);
    const byBranch = Object.fromEntries(body.changes.map((c) => [c.branch, c]));
    expect(Object.keys(byBranch).sort()).toEqual(['billing-v2', 'exports']);
    expect(byBranch['exports'].hunks.map((x) => [x.kind, x.new.start, x.new.lines, x.functions, x.committed]))
      .toEqual([['changed', 12, 1, ['validateCreateUser'], true]]);
    expect(byBranch['billing-v2'].hunks.map((x) => [x.kind, x.new.start, x.new.lines, x.functions, x.committed]))
      .toEqual([['added', 20, 1, ['validateCreateOrder'], false]]);
    expect([byBranch['billing-v2'].added, byBranch['billing-v2'].removed]).toEqual([1, 0]);
    expect(byBranch['billing-v2'].diff).toBeUndefined();
  });

  test('one workstream by branch, with the diff text when asked; one leaving the file alone says so', async () => {
    const one = await h.client.raw('GET', `/api/workstreams/changes?project=${encodeURIComponent(root)}&path=${encodeURIComponent(REL)}&workstream=exports&diff=1`);
    expect(one.status).toBe(200);
    const [c] = ((await one.json()) as { changes: Changes[] }).changes;
    expect(c.branch).toBe('exports');
    expect(c.diff).toContain("+  if (!payload.name || payload.name.trim().length === 0) errors.push('name is required and must be text');");

    const alone = await h.client.raw('GET', `/api/workstreams/changes?project=${encodeURIComponent(root)}&path=${encodeURIComponent('packages/shared/src/types.ts')}&workstream=billing-v2`);
    expect(((await alone.json()) as { changes: Changes[] }).changes.map((x) => x.status)).toEqual(['unchanged']);
  });

  test('a path outside the repository, or a workstream that is not one, is refused', async () => {
    for (const bad of ['../etc/passwd', '/etc/passwd', '-p']) {
      const res = await h.client.raw('GET', `/api/workstreams/changes?project=${encodeURIComponent(root)}&path=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
    const nope = await h.client.raw('GET', `/api/workstreams/changes?project=${encodeURIComponent(root)}&path=${encodeURIComponent(REL)}&workstream=${encodeURIComponent('/tmp')}`);
    expect(nope.status).toBe(404);
  });

  test('a file that is a link out of the worktree is not read', async () => {
    fs.writeFileSync(`${root}-outside.txt`, 'not yours\n');
    fs.symlinkSync(`${root}-outside.txt`, path.join(billing, 'linked.txt'));
    try {
      const res = await h.client.raw('GET', `/api/workstreams/changes?project=${encodeURIComponent(root)}&path=linked.txt&workstream=billing-v2&diff=1`);
      const [c] = ((await res.json()) as { changes: Changes[] }).changes;
      expect(c.status).toBe('unreadable');
      expect(c.diff).toBeUndefined();
      expect(JSON.stringify(c)).not.toContain('not yours');
    } finally {
      fs.rmSync(path.join(billing, 'linked.txt'), { force: true });
      fs.rmSync(`${root}-outside.txt`, { force: true });
    }
  });

  test('another workstream\'s copy, for Compare with…, named by its branch', async () => {
    const at = (spec: string, rel = REL) => h.client.raw('GET', `/api/file/at?project=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}&at=${encodeURIComponent(spec)}`);
    const theirs = (await (await at('workstream:exports')).json()) as { ok: boolean; content: string; label: string };
    expect(theirs.label).toBe('exports');
    expect(theirs.content).toContain('name is required and must be text');
    const mine = (await (await at('workstream:billing-v2')).json()) as { content: string; label: string };
    expect(mine.label).toBe('billing-v2');
    expect(mine.content).toContain('currency is required');
    expect((await at('workstream:nope')).status).toBe(404);
    // A link out of a worktree is refused there too.
    fs.writeFileSync(`${root}-outside.txt`, 'not yours\n');
    fs.symlinkSync(`${root}-outside.txt`, path.join(billing, 'linked.txt'));
    try {
      const res = await at('workstream:billing-v2', 'linked.txt');
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('not yours');
    } finally {
      fs.rmSync(path.join(billing, 'linked.txt'), { force: true });
      fs.rmSync(`${root}-outside.txt`, { force: true });
    }
  });

  test('an agent with no hook is told the other side\'s lines, in words, and not its own', async () => {
    const res = await agent.callTool('get_line_changes', { path: REL });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.text) as { your_workstream: string; says: string[]; changes: Changes[] };
    expect(fs.realpathSync(body.your_workstream)).toBe(fs.realpathSync(billing));
    expect(body.changes.map((c) => c.branch)).toEqual(['exports']);
    expect(body.says).toEqual(['exports changed line 12, in validateCreateUser']);
  });

  test('naming its own workstream shows its own; a file no one else changes says so', async () => {
    const own = JSON.parse((await agent.callTool('get_line_changes', { path: REL, workstream: 'billing-v2' })).text) as { says: string[] };
    expect(own.says).toEqual(['billing-v2 added line 20, in validateCreateOrder, not committed']);
    const none = JSON.parse((await agent.callTool('get_line_changes', { path: 'packages/shared/src/types.ts' })).text) as { says: string[] };
    expect(none.says).toEqual(['No other workstream changes packages/shared/src/types.ts.']);
    const bad = await agent.callTool('get_line_changes', { path: '../outside' });
    expect(bad.isError).toBe(true);
  });
});
