/**
 * Opening and rescanning a project through REST (Phase 32 §0.4a).
 *
 * The existing tests for these routes mostly checked shape: pin returned
 * `ok`, delete removed a path that was never listed, onboarding state
 * had fields of the right types. These check the behaviour the UI relies
 * on instead:
 *
 * - the first scan seeds the user's identity from the project's git
 *   config, and never overwrites one the user set (no test existed);
 * - pinning reorders the recent list, and a project whose directory was
 *   deleted can still be removed from it (the reason those routes are
 *   deliberately unconfined);
 * - the Getting Started checklist moves when a plan exists and an agent
 *   connects;
 * - a rescan picks up added and deleted files.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setupHarness, type Harness } from '../harness';

interface Recent { path: string; pinned: boolean }

test.describe.serial('Opening and rescanning a project', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let project: string;
  let second: string;

  async function recents(): Promise<Recent[]> {
    return ((await (await h.client.raw('GET', '/api/recent-projects')).json()) as { projects: Recent[] }).projects;
  }
  async function identity(): Promise<{ displayName: string; email: string }> {
    return ((await (await h.client.raw('GET', '/api/settings')).json()) as { identity: { displayName: string; email: string } }).identity;
  }

  test.beforeAll(async () => {
    h = await setupHarness('project-open');
    project = h.fixture.projectPath;
    // Repo-local identity, so the answer doesn't depend on the machine's
    // global git config.
    execFileSync('git', ['config', 'user.name', 'Sam Example'], { cwd: project });
    execFileSync('git', ['config', 'user.email', 'sam@example.test'], { cwd: project });
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('git-defaults reads the project\'s own git identity', async () => {
    await h.client.scanProject(project);
    const res = await h.client.raw('GET', `/api/identity/git-defaults?project=${encodeURIComponent(project)}`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ name: 'Sam Example', email: 'sam@example.test' });
  });

  test('the first scan seeded an empty identity from git; a user-set one survives later scans', async () => {
    expect(await identity()).toMatchObject({ displayName: 'Sam Example', email: 'sam@example.test' });

    const put = await h.client.raw('PUT', '/api/settings', { identity: { displayName: 'Sam', email: 'sam@elsewhere.test' } });
    expect(put.ok).toBe(true);
    await h.client.scanProject(project);
    expect(await identity()).toMatchObject({ displayName: 'Sam', email: 'sam@elsewhere.test' });
  });

  test('pinning puts a project first; unpinning returns it to recency order', async () => {
    second = path.join(h.fixture.tmpDir, 'second');
    fs.mkdirSync(path.join(second, 'src'), { recursive: true });
    fs.writeFileSync(path.join(second, 'src', 'x.ts'), 'export const x = 1;\n');
    await h.client.scanProject(second);
    expect((await recents()).map((p) => p.path).slice(0, 2)).toEqual([second, project]);

    const pin = await h.client.raw('POST', '/api/recent-projects/pin', { projectPath: project, pinned: true });
    expect(pin.ok).toBe(true);
    const pinned = await recents();
    expect(pinned[0]).toMatchObject({ path: project, pinned: true });

    await h.client.raw('POST', '/api/recent-projects/pin', { projectPath: project, pinned: false });
    expect((await recents()).map((p) => p.path).slice(0, 2)).toEqual([second, project]);
  });

  test('a project whose directory was deleted can still be removed from the list', async () => {
    fs.rmSync(second, { recursive: true, force: true });
    expect((await recents()).map((p) => p.path)).toContain(second);
    const res = await h.client.raw('DELETE', '/api/recent-projects', { projectPath: second });
    expect(res.ok).toBe(true);
    expect((await recents()).map((p) => p.path)).not.toContain(second);
    expect((await recents()).map((p) => p.path)).toContain(project);
  });

  test('onboarding state follows plans and connected agents', async () => {
    await h.client.scanProject(project);
    const url = `/api/onboarding-state?project=${encodeURIComponent(project)}`;
    const before = await (await h.client.raw('GET', url)).json();
    expect(before).toMatchObject({ hasPlan: false, planCount: 0, hasMcpSession: false, activeMcpSessionCount: 0 });

    await h.client.createPlan({ title: 'Onboarding plan', projectPath: project });
    await h.spawnAgent({ agentType: 'onboarding-agent' });
    const after = await (await h.client.raw('GET', url)).json();
    expect(after).toMatchObject({ hasPlan: true, planCount: 1, hasMcpSession: true });
    expect(after.activeMcpSessionCount).toBeGreaterThanOrEqual(1);
  });

  test('a rescan picks up an added file and drops a deleted one', async () => {
    const base = (await h.client.getStats()).fileCount;
    const added = path.join(project, 'src', 'added-by-test.ts');
    fs.mkdirSync(path.dirname(added), { recursive: true });
    fs.writeFileSync(added, 'export const added = true;\n');
    await h.client.scanProject(project);
    expect((await h.client.getStats()).fileCount).toBe(base + 1);

    fs.rmSync(added);
    await h.client.scanProject(project);
    expect((await h.client.getStats()).fileCount).toBe(base);
  });
});
