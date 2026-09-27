/**
 * The project lifecycle through MCP (Phase 32 §0.4a).
 *
 * Open, rescan, the recent-projects list (pin, alias, origin, remove) and
 * close, driven the way an agent drives them. Eight of these ten tools had
 * no test at all. Where a tool's only UI effect is a broadcast (closing a
 * tab, switching to one), the broadcast itself is asserted — a return
 * value alone passes whether or not the renderer was told.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setupHarness, openEventStream, type Harness, type EventStream, type ScriptedAgent } from '../harness';

interface Recent {
  path: string;
  displayName: string;
  branch: string | null;
  pinned: boolean;
  originUrl: string | null;
}

test.describe.serial('Project lifecycle through MCP', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let events: EventStream;
  let agent: ScriptedAgent;
  let project: string;

  async function recents(): Promise<Recent[]> {
    const res = await h.client.raw('GET', '/api/recent-projects');
    return ((await res.json()) as { projects: Recent[] }).projects;
  }
  async function entry(): Promise<Recent | undefined> {
    return (await recents()).find((p) => p.path === project);
  }

  test.beforeAll(async () => {
    h = await setupHarness('project-lifecycle');
    project = h.fixture.projectPath;
    events = await openEventStream(h.backend);
    agent = await h.spawnAgent({ agentType: 'lifecycle-agent' });
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  test('rescan_project with no path and nothing open refuses, rather than scanning somewhere else', async () => {
    const res = await agent.callTool('rescan_project', {});
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/no project is open/i);
    expect(events.ofType('graph-data-changed')).toHaveLength(0);
  });

  test('open_project scans, records a recent project, and tells the UI to switch to it', async () => {
    const res = await agent.callTool('open_project', { path: project });
    expect(res.isError, res.text).not.toBe(true);
    expect(res.text).toMatch(/Opened .* — \d+ files/);
    await events.waitFor('ui-open-project', (p) => p.path === project);
    const e = await entry();
    expect(e, 'recorded as a recent project').toBeTruthy();
    expect(e!.branch).toBe('main');
    expect(e!.displayName).toBe(path.basename(project));
  });

  test('rescan_project with no path rescans the OPEN project', async () => {
    const before = events.ofType('graph-data-changed').length;
    const res = await agent.callTool('rescan_project', {});
    expect(res.isError, res.text).not.toBe(true);
    expect(res.text).toContain(`Rescan complete for ${project}`);
    const changed = events.ofType('graph-data-changed').slice(before);
    expect(changed.map((e) => e.payload.projectPath)).toEqual([project]);
  });

  test('rescan_project refuses a directory that was never opened', async () => {
    const elsewhere = path.join(h.fixture.tmpDir, 'never-opened');
    fs.mkdirSync(elsewhere, { recursive: true });
    const res = await agent.callTool('rescan_project', { project_path: elsewhere });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not open/i);
  });

  test('list_recent_projects shows the project with its branch', async () => {
    const res = await agent.callTool('list_recent_projects', {});
    expect(res.text).toContain(`\`${project}\``);
    expect(res.text).toContain('(main)');
  });

  test('pin_project and unpin_project flip the pinned flag', async () => {
    await agent.callTool('pin_project', { project_path: project });
    expect((await entry())!.pinned).toBe(true);
    expect((await agent.callTool('list_recent_projects', {})).text).toMatch(/📌 \*\*/);
    await agent.callTool('unpin_project', { project_path: project });
    expect((await entry())!.pinned).toBe(false);
  });

  test('the list tools refuse a path that is not a recent project, rather than claiming success', async () => {
    // Default scope: refused before the tool runs, as not an opened project.
    const scoped = await agent.callTool('pin_project', { project_path: '/no/such/project' });
    expect(scoped.isError).toBe(true);
    expect(scoped.text).toMatch(/not open/i);

    // Scope "anywhere" lets the call through, and the tool itself must
    // then say the row doesn't exist. It used to report success.
    const set = await h.client.raw('PUT', '/api/settings', { mcp: { projectScope: 'anywhere' } });
    expect(set.ok).toBe(true);
    try {
      for (const tool of ['pin_project', 'unpin_project', 'remove_recent_project']) {
        const res = await agent.callTool(tool, { project_path: '/no/such/project' });
        expect(res.isError, `${tool}: ${res.text}`).toBe(true);
        expect(res.text).toMatch(/not in recents/i);
      }
    } finally {
      await h.client.raw('PUT', '/api/settings', { mcp: { projectScope: 'opened' } });
    }
  });

  test('set_repo_alias renames the entry, broadcasts, and an empty alias resets it', async () => {
    const res = await agent.callTool('set_repo_alias', { project_path: project, alias: 'Sample (worktree A)' });
    expect(res.isError, res.text).not.toBe(true);
    expect((await entry())!.displayName).toBe('Sample (worktree A)');
    await events.waitFor('project-alias-changed', (p) => p.path === project && p.alias === 'Sample (worktree A)');

    await agent.callTool('set_repo_alias', { project_path: project, alias: '' });
    expect((await entry())!.displayName).toBe(path.basename(project));

    const missing = await agent.callTool('set_repo_alias', { project_path: '/no/such/project', alias: 'x' });
    expect(missing.isError).toBe(true);
  });

  test('get_repo_identity and refresh_repo_origin follow the git origin', async () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
    git('remote', 'add', 'origin', 'https://github.com/acme/app.git');
    // The origin is read when the project is opened; until then the
    // cached identity doesn't know about it.
    const stale = JSON.parse((await agent.callTool('get_repo_identity', { project_path: project })).text) as Recent;
    expect(stale.originUrl).toBeNull();

    const refreshed = await agent.callTool('refresh_repo_origin', { project_path: project });
    expect(refreshed.isError, refreshed.text).not.toBe(true);
    expect((JSON.parse(refreshed.text) as Recent).originUrl).toBe('https://github.com/acme/app');

    git('remote', 'set-url', 'origin', 'git@github.com:acme/renamed.git');
    await agent.callTool('refresh_repo_origin', { project_path: project });
    const identity = JSON.parse((await agent.callTool('get_repo_identity', { project_path: project })).text) as Recent;
    expect(identity.originUrl).toBe('https://github.com/acme/renamed');
    expect(identity.branch).toBe('main');
    await events.waitFor('project-origin-changed', (p) => p.originUrl === 'https://github.com/acme/renamed');

    // A path that was never opened is refused by the project scope before
    // the tool's own "null when not a recent project" is reached.
    const unknown = await agent.callTool('get_repo_identity', { project_path: '/no/such/project' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/not open/i);
  });

  test('close_project tells the UI to close the tab', async () => {
    const res = await agent.callTool('close_project', { project_path: project });
    expect(res.isError, res.text).not.toBe(true);
    await events.waitFor('ui-close-project', (p) => p.path === project);
  });

  test('remove_recent_project drops the entry', async () => {
    const res = await agent.callTool('remove_recent_project', { project_path: project });
    expect(res.isError, res.text).not.toBe(true);
    expect(await entry()).toBeUndefined();
  });
});
