/**
 * Phase 32 E3a — a file's history on any side, end to end, with no plan.
 *
 * In the opened repository a file is renamed and edited, once by an agent
 * whose commit says so; between two of those commits a person changes a
 * setting the record keeps as a decision. GET /api/git/file-history lists
 * the positions on each side (this checkout's working copy, a branch),
 * following the rename, each with its git author and what CodeTrellis
 * knows; each position reads through /api/file/at at the path it had then;
 * GET /api/record/decisions lists what was decided between two of them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };

interface Position { spec: string; kind: string; path: string; sha: string | null; at: number | null; author: string | null; subject: string | null; status: string | null; from?: string; attribution: { agent: string; how: string; words: string } | null }
interface History { label: string; positions: Position[]; command: string; truncated: boolean }

test.describe.serial('A file\'s history on any side', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let between: { from: number; to: number };

  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const q = () => `project=${encodeURIComponent(root)}`;
  const history = async (at: string, rel: string) => {
    const res = await h.client.raw('GET', `/api/git/file-history?${q()}&at=${encodeURIComponent(at)}&path=${encodeURIComponent(rel)}`);
    return { status: res.status, body: (await res.json()) as History & { error?: string } };
  };
  const at = async (spec: string, rel: string) =>
    ((await (await h.client.raw('GET', `/api/file/at?${q()}&path=${encodeURIComponent(rel)}&at=${encodeURIComponent(spec)}`)).json()) as { content: string | null }).content;
  const settings = async () => (await (await h.client.raw('GET', '/api/settings')).json()) as { data: Record<string, unknown> };

  test.beforeAll(async () => {
    h = await setupHarness('file-history');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    fs.mkdirSync(path.join(root, 'billing'), { recursive: true });
    fs.writeFileSync(path.join(root, 'billing', 'round.ts'), 'export const r = (x: number) => Math.round(x);\n');
    git('add', '-A');
    git('commit', '-qm', 'Rounding');
    git('mv', 'billing/round.ts', 'billing/refund.ts');
    git('commit', '-qm', 'Name it for refunds');
    fs.writeFileSync(path.join(root, 'billing', 'refund.ts'), 'export const r = (x: number) => Math.round(x * 100) / 100;\n');
    git('commit', '-qam', 'Round to the cent\n\nagent: codex · model: o5');
    const centAt = Number(git('log', '-1', '--format=%at')) * 1000;
    // A person decides something between two commits: the record keeps it.
    const s = await settings();
    await h.client.raw('PUT', '/api/settings', { data: { ...s.data, retentionDays: 90 } });
    await new Promise((r) => setTimeout(r, 1100));
    fs.writeFileSync(path.join(root, 'billing', 'refund.ts'), 'export const r = (x: number) => roundHalfEven(x, 2);\n');
    git('commit', '-qam', 'Half-even');
    between = { from: centAt, to: Number(git('log', '-1', '--format=%at')) * 1000 + 999 };
    fs.appendFileSync(path.join(root, 'billing', 'refund.ts'), '// working on it\n');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('this checkout: its working copy, then each commit that changed the file, through its rename', async () => {
    const r = await history('live', 'billing/refund.ts');
    expect(r.status).toBe(200);
    expect(r.body.positions.map((p) => [p.kind, p.subject, p.path, p.status])).toEqual([
      ['working', null, 'billing/refund.ts', null],
      ['commit', 'Half-even', 'billing/refund.ts', 'modified'],
      ['commit', 'Round to the cent', 'billing/refund.ts', 'modified'],
      ['commit', 'Name it for refunds', 'billing/refund.ts', 'renamed'],
      ['commit', 'Rounding', 'billing/round.ts', 'added'],
    ]);
    expect(r.body.command).toBe('git log --follow -- billing/refund.ts');
    // The git author always; CodeTrellis's attribution where it knows, and how.
    expect(r.body.positions.slice(1).every((p) => p.author === 'Sam Lee')).toBe(true);
    expect(r.body.positions[2].attribution).toMatchObject({ agent: 'codex', how: 'commit message', words: 'codex, from the commit message' });
    expect(r.body.positions[1].attribution).toBeNull();
  });

  test('each position reads at the path the file had then', async () => {
    const r = await history('live', 'billing/refund.ts');
    const [working, halfEven, , , first] = r.body.positions;
    expect(await at(working.spec, working.path)).toContain('// working on it');
    expect(await at(halfEven.spec, halfEven.path)).toBe('export const r = (x: number) => roundHalfEven(x, 2);\n');
    // Before the rename: read at its old path.
    expect(first.path).toBe('billing/round.ts');
    expect(await at(first.spec, first.path)).toBe('export const r = (x: number) => Math.round(x);\n');
  });

  test('a branch: commits only, said by its name', async () => {
    const branch = git('symbolic-ref', '--short', 'HEAD');
    const r = await history(`commit:refs/heads/${branch}`, 'billing/refund.ts');
    expect(r.body.positions[0].kind).toBe('commit');
    expect(r.body.label).toBe(branch);
    expect(r.body.command).toBe(`git log --follow ${branch} -- billing/refund.ts`);
  });

  test('what was decided between two commits', async () => {
    const res = await h.client.raw('GET', `/api/record/decisions?from=${between.from}&to=${between.to}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decisions: Array<{ type: string; words: string }>; words: string };
    expect(body.decisions.map((d) => d.type)).toEqual(['retention_changed']);
    expect(body.words).toBe('1 decision recorded on this computer between these two moments.');
    const none = (await (await h.client.raw('GET', `/api/record/decisions?from=1&to=2`)).json()) as { decisions: unknown[]; words: string };
    expect(none.decisions).toEqual([]);
    expect(none.words).toBe('Nothing was decided on this computer between these two moments.');
  });

  test('refused: a path that climbs out or is an option, a ref that is an option, bad times, a project not open', async () => {
    for (const p of ['../etc/passwd', '/etc/passwd', '-x', ':(top)x']) {
      expect((await history('live', p)).status, p).toBe(400);
    }
    const bad = await history('commit:--output=/tmp/x', 'billing/refund.ts');
    expect(bad.status).toBe(400);
    expect((await history('workstream:/etc', 'billing/refund.ts')).status).toBe(400);
    expect((await h.client.raw('GET', '/api/record/decisions?from=5&to=1')).status).toBe(400);
    expect((await h.client.raw('GET', '/api/record/decisions')).status).toBe(400);
    expect((await h.client.raw('GET', `/api/git/file-history?project=${encodeURIComponent('/not/opened')}&path=a.ts`)).status).toBe(403);
  });
});
