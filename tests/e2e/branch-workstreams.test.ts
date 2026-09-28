/**
 * Branch workstreams (Phase 32 A1.7a), end to end: a branch with commits and
 * no checkout — what a cloud agent's pushed branch looks like after a fetch —
 * is a workstream, carries its changes and symbols, collides with a worktree
 * editing the same function, and follows its ref when it moves.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, openEventStream, type Harness, type EventStream } from '../harness';

interface Workstream { root: string; ref?: string; branch: string | null; shape: string; idle: boolean; changes: { files: Array<{ path: string; status: string; symbols?: Array<{ name: string; change: string }> }> } }
interface Signal { kind: string; severity: string; summary: string; subject: { file?: string; symbol?: string }; workstreams: string[] }

const REL = 'packages/shared/src/validators.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Branch workstreams', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let events: EventStream;
  let root: string;
  let auth: string;

  const git = (args: string[], opts: { input?: string; env?: Record<string, string> } = {}) =>
    execFileSync('git', ['-C', root, ...args], { env: { ...ENV, ...(opts.env ?? {}) }, encoding: 'utf-8', input: opts.input }).trim();

  /** Commit a new version of REL onto `branch` without checking it out. */
  const commitOnto = (branch: string, body: string) => {
    const idx = path.join(h.fixture.dataDir, `idx-${Date.now()}`);
    const env = { GIT_INDEX_FILE: idx };
    git(['read-tree', branch], { env });
    const blob = git(['hash-object', '-w', '--stdin'], { input: body });
    git(['update-index', '--cacheinfo', `100644,${blob},${REL}`], { env });
    const commit = git(['commit-tree', git(['write-tree'], { env }), '-p', branch, '-m', 'cloud work'], { env });
    git(['update-ref', `refs/heads/${branch}`, commit]);
    fs.rmSync(idx, { force: true });
  };

  const list = async () => (await (await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}&idle=1`)).json()) as Workstream[];
  const signals = async () => ((await (await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`)).json()) as { signals: Signal[] }).signals;
  let original: string;

  test.beforeAll(async () => {
    h = await setupHarness('branch-workstreams', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    auth = `${root}-auth`;
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', auth, '-b', 'auth-refresh'], { env: ENV });
    original = fs.readFileSync(path.join(root, REL), 'utf-8');
    git(['branch', 'cloud-fix']);
    await h.client.scanProject(root);
    events = await openEventStream(h.backend);
  });

  test.afterAll(async () => {
    await events?.close();
    try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', auth]); } catch { /* */ }
    await h?.teardown();
  });

  test('a branch not ahead of main is not work', async () => {
    expect((await list()).some((w) => w.branch === 'cloud-fix')).toBe(false);
  });

  test('a branch with commits and no checkout is a workstream, with its changes and symbols', async () => {
    commitOnto('cloud-fix', original.replace('return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.toLowerCase());'));
    const b = (await list()).find((w) => w.branch === 'cloud-fix');
    expect(b).toMatchObject({ root: 'branch:cloud-fix', ref: 'refs/heads/cloud-fix', shape: 'branch', idle: false });
    expect(b!.changes.files.map((f) => [f.path, f.status])).toEqual([[REL, 'modified']]);
    expect(b!.changes.files[0].symbols?.map((s) => `${s.change} ${s.name}`)).toEqual(['modified isValidEmail']);
  });

  test('a worktree editing the same function collides with it, and the signal names the branch', async () => {
    fs.writeFileSync(path.join(auth, REL), original.replace('return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.trim());'));
    const s = await signals();
    expect(s.map((x) => `${x.severity} ${x.kind} ${x.subject.symbol}`)).toEqual(['high collision isValidEmail']);
    expect(s[0].workstreams).toContain('branch:cloud-fix');
    expect(s[0].summary).toContain('`cloud-fix`');
  });

  test('when the branch moves on, the window is told and its footprint follows', async () => {
    await list(); // the listing starts the refs watcher
    const before = events.ofType('workstreams-changed').filter((e) => e.payload?.refs).length;
    commitOnto('cloud-fix', original); // the cloud agent reverts its change
    await expect.poll(() => events.ofType('workstreams-changed').filter((e) => e.payload?.refs).length, { timeout: 10_000 }).toBeGreaterThan(before);
    // Back to main's content: commits ahead, but nothing different — idle, so
    // off the default listing, and the collision resolves.
    await expect.poll(async () => (await list()).find((w) => w.branch === 'cloud-fix')?.idle, { timeout: 10_000 }).toBe(true);
    const active = (await (await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).json()) as Workstream[];
    expect(active.some((w) => w.branch === 'cloud-fix')).toBe(false);
    expect(await signals()).toEqual([]);
  });
});
