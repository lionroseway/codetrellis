/**
 * Awareness never holds the backend.
 *
 * A signal refresh lists every line of work, asks git what each changed and
 * parses the changed files. It used to run git with `execFileSync`, one call
 * after another on the backend's only thread, so every request that arrived
 * meanwhile (the window, an agent, the phone) waited for the whole refresh.
 * Git now runs without blocking, and the window's own read of the Awareness
 * tab answers from what is stored and lets a refresh follow.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness } from '../harness';

const VALIDATORS = 'packages/shared/src/validators.ts';
const WIDE = 120;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

type Signal = { kind: string; workstreams: string[] };

test.describe.serial('Awareness never holds the backend', () => {
  test.setTimeout(180_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let wide: string;
  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { env: ENV, stdio: 'pipe' });
  const q = () => `project=${encodeURIComponent(root)}`;
  const signals = async (fresh: boolean) =>
    ((await (await h.client.raw('GET', `/api/awareness?${fresh ? 'fresh=1&' : ''}${q()}`)).json()) as { signals: Signal[] }).signals;
  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    const was = fs.readFileSync(f, 'utf-8');
    expect(was.includes(from), `${rel} contains the text to change`).toBe(true);
    fs.writeFileSync(f, was.replace(from, to));
  };

  test.beforeAll(async () => {
    h = await setupHarness('awareness-off-thread');
    root = h.fixture.projectPath;
    // Many small files on main, so a line of work that changes them all
    // costs a refresh one git call per file.
    for (let i = 0; i < WIDE; i++) {
      const dir = path.join(root, 'wide');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `f${i}.ts`), `export function f${i}(n: number): number {\n  return n + ${i};\n}\n`);
    }
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'wide');
    await h.client.scanProject(root);
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    wide = `${root}-wide`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix'], [wide, 'wide-refactor']]) git(root, 'worktree', 'add', '-q', dir, '-b', branch);
    // Two lines of work editing the same function: a collision once a refresh sees them.
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    edit(checkout, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, mode: string)');
    for (let i = 0; i < WIDE; i++) edit(wide, `wide/f${i}.ts`, `return n + ${i};`, `return n * ${i};`);
  });

  test.afterAll(async () => {
    for (const w of [billing, checkout, wide]) {
      try { git(root, 'worktree', 'remove', '--force', w); } catch { /* */ }
    }
    await h?.teardown();
  });

  test("the window's read answers from what is stored at once, and starts a refresh that finds the overlap", async () => {
    // Nothing has refreshed since the lines of work were made: stored is empty.
    const first = await signals(false);
    expect(first.filter((s) => s.kind === 'collision')).toEqual([]);
    // The read started a refresh; reading again (no fresh) sees what it stored.
    await expect.poll(async () => (await signals(false)).some((s) => s.kind === 'collision'), { timeout: 30_000, intervals: [300] }).toBe(true);
  });

  test('while a refresh runs, other requests are answered', async () => {
    // A refresh that must ask git about every wide file again: new edits move every stamp.
    for (let i = 0; i < WIDE; i++) edit(wide, `wide/f${i}.ts`, `return n * ${i};`, `return n - ${i};`);
    let refreshedAt = 0;
    const refresh = signals(true).then((s) => { refreshedAt = performance.now(); return s; });
    // Give the refresh a head start into its git calls.
    await new Promise((r) => setTimeout(r, 50));
    const asked = performance.now();
    const health = await h.client.raw('GET', '/api/health');
    const answeredAt = performance.now();
    expect(health.status).toBe(200);
    const result = await refresh;
    expect(result.some((s) => s.kind === 'collision'), 'the refresh still finds the overlap').toBe(true);
    expect(refreshedAt, `health answered in ${Math.round(answeredAt - asked)} ms; the refresh ended ${Math.round(refreshedAt - asked)} ms after it was asked`)
      .toBeGreaterThan(answeredAt);
  });
});
