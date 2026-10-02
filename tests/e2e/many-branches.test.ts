/**
 * Phase 32 HD4b — many branches, off the request path.
 *
 * A repository with more recent branches than one listing works out inline
 * (`INLINE_BRANCHES`, 8): the first `/api/workstreams` answers with the ones
 * it had time for rather than blocking the server; the rest are worked out in
 * the background, a `workstreams-changed` broadcast says when, and the next
 * listing has every branch, each with its changes. Nothing is lost and
 * nothing is counted twice.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, openEventStream, type Harness, type EventStream } from '../harness';

interface Workstream { root: string; branch: string | null; shape: string; changes: { files: Array<{ path: string; status: string }> } }

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const BRANCHES = 12;

test.describe.serial('Many branches', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let events: EventStream;
  let root: string;

  const git = (args: string[], opts: { input?: string; env?: Record<string, string> } = {}) =>
    execFileSync('git', ['-C', root, ...args], { env: { ...ENV, ...(opts.env ?? {}) }, encoding: 'utf-8', input: opts.input }).trim();

  /** A branch with one new file, committed without checking it out. */
  const branchWith = (name: string, rel: string) => {
    git(['branch', name]);
    const idx = path.join(h.fixture.dataDir, `idx-${name}`);
    const env = { GIT_INDEX_FILE: idx };
    git(['read-tree', name], { env });
    const blob = git(['hash-object', '-w', '--stdin'], { input: `export const ${name.replace(/\W/g, '_')} = 1;\n` });
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`], { env });
    const commit = git(['commit-tree', git(['write-tree'], { env }), '-p', name, '-m', `work on ${name}`], { env });
    git(['update-ref', `refs/heads/${name}`, commit]);
    fs.rmSync(idx, { force: true });
  };

  const branches = async () =>
    ((await (await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}&idle=1`)).json()) as Workstream[])
      .filter((w) => w.shape === 'branch');

  test.beforeAll(async () => {
    h = await setupHarness('many-branches');
    root = h.fixture.projectPath;
    for (let i = 1; i <= BRANCHES; i++) branchWith(`agent-${i}`, `src/agent-${i}.ts`);
    await h.client.scanProject(root);
    events = await openEventStream(h.backend);
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  test('the first listing answers at once; every branch arrives, with a broadcast, each with its changes', async () => {
    // Whether the scan's own listing already started the warmer is a race;
    // that a listing never waits on every branch is the unit test's.
    const t = Date.now();
    const first = await branches();
    expect(Date.now() - t).toBeLessThan(5_000);
    expect(first.length).toBeLessThanOrEqual(BRANCHES);
    await events.waitFor('workstreams-changed', (p) => p.refs === true, 30_000);
    await expect.poll(async () => (await branches()).length, { timeout: 30_000 }).toBe(BRANCHES);
    const all = await branches();
    expect(all.map((w) => w.branch).sort()).toEqual(Array.from({ length: BRANCHES }, (_, i) => `agent-${i + 1}`).sort());
    for (const w of all) expect(w.changes.files).toEqual([expect.objectContaining({ path: `src/${w.branch}.ts`, status: 'added' })]);
  });
});
