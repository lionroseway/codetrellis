/**
 * Plan-level MCP tools (Phase 32 §0.4c-1).
 *
 * Ten plan tools had no test: update, delete, bulk delete, copy as prompt,
 * templates (list, create from, publish), discover, unlink, home repo.
 * Since 0.4c-3 the two delete tools are gone: an agent may only ask
 * (`request_plan_deletion`), and a person confirms in the app.
 *
 * Writing them found bug 22: a plan's directory is named from its title
 * (plus a uid prefix), and after a RENAME everything looked it up by the
 * new title and found nothing. Write-through silently stopped for good
 * (the repo copy froze at the old title), channel events went into a new
 * directory with no plan.yaml, and unlink / delete left the real directory
 * behind — to be re-imported on the next pull.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { execFileSync } from 'node:child_process';
import { setupHarness, waitFor, openEventStream, type Harness, type ScriptedAgent } from '../harness';

test.describe.serial('Plan tools', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  let plansDir: string;
  let planUid: string;

  const call = async (tool: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(tool, args);
    expect(res.isError, `${tool}: ${res.text}`).not.toBe(true);
    return res.text;
  };
  const json = async (tool: string, args: Record<string, unknown>) => JSON.parse(await call(tool, args));
  /** Plan directories on disk whose plan.yaml carries this uid. */
  const dirsFor = (uid: string): string[] =>
    (fs.existsSync(plansDir) ? fs.readdirSync(plansDir) : []).filter((d) => {
      try { return parseYaml(fs.readFileSync(path.join(plansDir, d, 'plan.yaml'), 'utf-8'))?.uid === uid; } catch { return false; }
    });

  test.beforeAll(async () => {
    h = await setupHarness('plan-tools');
    root = h.fixture.projectPath;
    plansDir = path.join(root, '.codetrellis', 'plans');
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'plan-agent' });
    const created = await json('create_plan', { title: 'Payments cleanup', project_path: root });
    planUid = created.uid;
    expect(created.exported).toBe(true);
    await json('add_item', { plan_uid: planUid, kind: 'action', title: 'Remove dead handlers' });
    // Committed, as a shared plan is once the team has it: from then on its
    // directory keeps its name through a rename, which is what bug 22 was
    // about. Until it is committed the directory follows the title (0.6; the
    // last test below).
    execFileSync('git', ['add', '.codetrellis'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'plan'], {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
    });
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('discover_plan_files lists the exported plan directory', async () => {
    const dirs = (await json('discover_plan_files', { project_root: root })) as string[];
    expect(dirs.map((d) => path.basename(d))).toEqual(dirsFor(planUid));
    expect(dirsFor(planUid)).toHaveLength(1);
  });

  test('update_plan renames, sets status, and records a version', async () => {
    await json('update_plan', { plan_uid: planUid, title: 'Payments cleanup (phase 1)', status: 'in_progress', description: 'Scope: handlers only' });
    const plan = await json('get_plan', { plan_uid: planUid });
    expect(plan).toMatchObject({ title: 'Payments cleanup (phase 1)', status: 'in_progress', description: 'Scope: handlers only' });
    const versions = (await (await h.client.raw('GET', `/api/plans/${planUid}/versions`)).json()) as Array<{ author: string; authorType: string | null }>;
    expect(versions.length).toBeGreaterThan(0);
    // In the agent's own name and type, not the literal "agent" it used to write (carried 2b).
    expect(versions[0]).toMatchObject({ author: 'plan-agent', authorType: 'mcp' });
  });

  test('update_plan cannot approve a plan: the agent is told to ask, and nothing in the call is applied', async () => {
    const before = await json('get_plan', { plan_uid: planUid });
    const res = await agent.callTool('update_plan', { plan_uid: planUid, status: 'approved', title: 'Approved by an agent' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('approving a plan is the person\'s');
    expect(res.text).toContain('"review"');
    const after = await json('get_plan', { plan_uid: planUid });
    expect(after).toMatchObject({ title: before.title, status: before.status });
    // Asking for it is allowed; the person approves over the window's own path.
    await json('update_plan', { plan_uid: planUid, status: 'review' });
    expect((await json('get_plan', { plan_uid: planUid })).status).toBe('review');
    const put = await h.client.raw('PUT', `/api/plans/${planUid}`, { status: 'approved' });
    expect(put.ok).toBe(true);
    expect((await json('get_plan', { plan_uid: planUid })).status).toBe('approved');
    await json('update_plan', { plan_uid: planUid, status: 'in_progress' });
  });

  test('after a rename, write-through keeps writing to the same directory', async () => {
    const [dir] = dirsFor(planUid);
    await json('add_item', { plan_uid: planUid, kind: 'action', title: 'Added after the rename' });
    // Wait for the item itself. This waited for plan.yaml's title, which the
    // previous test's export had already written, then looked for the item
    // before the debounced write-through (200 ms) had run. Until 0.4h an
    // item change scheduled no write at all, and this passed only because
    // update_plan's debounce happened to fire after the add_item.
    const texts = () => fs.readdirSync(path.join(plansDir, dir), { recursive: true }).map(String)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => fs.readFileSync(path.join(plansDir, dir, f), 'utf-8')).join('\n');
    await waitFor(() => texts().includes('Added after the rename'), { timeoutMs: 5000, description: 'the new item written through' });
    expect(parseYaml(fs.readFileSync(path.join(plansDir, dir, 'plan.yaml'), 'utf-8'))?.title).toBe('Payments cleanup (phase 1)');
    // One directory for this plan, not a second one under the new title.
    expect(dirsFor(planUid)).toEqual([dir]);
  });

  test('after a rename, a channel event lands in the plan\'s own directory', async () => {
    const [dir] = dirsFor(planUid);
    const ev = await json('post_channel_event', { plan_uid: planUid, event_type: 'weigh-in', message: 'Checking in after the rename' });
    expect(fs.existsSync(path.join(plansDir, dir, 'channels', `${ev.uid}.yaml`))).toBe(true);
    // No stray directory without a plan.yaml.
    const strays = fs.readdirSync(plansDir).filter((d) => !fs.existsSync(path.join(plansDir, d, 'plan.yaml')));
    expect(strays).toEqual([]);
  });

  test('copy_plan_as_prompt renders the plan, or one item', async () => {
    const all = await call('copy_plan_as_prompt', { plan_uid: planUid });
    expect(all).toContain('# Payments cleanup (phase 1)');
    expect(all).toContain('Remove dead handlers');
    expect(all).toContain('Added after the rename');

    const items = (await (await h.client.raw('GET', `/api/plans/${planUid}/items`)).json()) as Array<{ uid: string; title: string }>;
    const one = items.find((i) => i.title === 'Remove dead handlers')!;
    const single = await call('copy_plan_as_prompt', { plan_uid: planUid, item_uid: one.uid });
    expect(single).toContain('Remove dead handlers');
    expect(single).not.toContain('Added after the rename');

    expect((await agent.callTool('copy_plan_as_prompt', { plan_uid: 'nope' })).isError).toBe(true);
  });

  test('set_plan_home_repo normalises the URL, and an empty string clears it', async () => {
    const set = await json('set_plan_home_repo', { plan_uid: planUid, home_repo_url: 'git@github.com:acme/payments.git' });
    expect(set.homeRepo).toBe('https://github.com/acme/payments');
    const cleared = await json('set_plan_home_repo', { plan_uid: planUid, home_repo_url: '' });
    expect(cleared.homeRepo ?? null).toBeNull();
  });

  test('templates: list the built-ins, publish this plan, create a new plan from it', async () => {
    const builtIns = (await json('list_plan_templates', {})) as Array<{ id: string; source?: string }>;
    expect(builtIns.map((t) => t.id)).toContain('mass-refactor');
    expect(builtIns.map((t) => t.id)).not.toContain('payments-cleanup');

    const pub = await json('publish_plan_as_template', { plan_uid: planUid, project_root: root, template_id: 'payments-cleanup', label: 'Payments cleanup' });
    expect(fs.existsSync(path.join(pub.templateDir, 'template.yaml'))).toBe(true);

    const withProject = (await json('list_plan_templates', { project_root: root })) as Array<{ id: string }>;
    expect(withProject.map((t) => t.id)).toContain('payments-cleanup');

    const made = await json('create_plan_from_template', { template_id: 'payments-cleanup', project_path: root, title: 'Payments cleanup (billing)' });
    expect(made.plan.title).toBe('Payments cleanup (billing)');
    const items = (await (await h.client.raw('GET', `/api/plans/${made.plan.uid}/items`)).json()) as Array<{ title: string; status: string }>;
    expect(items.map((i) => i.title)).toEqual(expect.arrayContaining(['Remove dead handlers', 'Added after the rename']));
    // Runtime state is stripped: a new plan starts pending.
    expect(items.every((i) => i.status === 'pending')).toBe(true);

    const bad = await agent.callTool('create_plan_from_template', { template_id: 'no-such-template', project_path: root });
    expect(bad.isError).toBe(true);
  });

  test('unlink_plan_from_files removes the (renamed) directory and keeps the plan', async () => {
    const res = await json('unlink_plan_from_files', { plan_uid: planUid, project_root: root });
    expect(res.removed).toBe(true);
    expect(dirsFor(planUid)).toEqual([]);
    const plan = await json('get_plan', { plan_uid: planUid });
    expect(plan.title).toBe('Payments cleanup (phase 1)');
  });

  test('deleting a renamed plan (the app\'s path) removes its directory', async () => {
    const made = await json('create_plan', { title: 'Short-lived', project_path: root });
    await json('update_plan', { plan_uid: made.uid, title: 'Short-lived, renamed' });
    expect(dirsFor(made.uid)).toHaveLength(1);
    const res = await h.client.raw('DELETE', `/api/plans/${made.uid}`);
    expect(res.ok).toBe(true);
    expect(dirsFor(made.uid)).toEqual([]);
  });

  // ── Plan deletion is a person's decision (0.4c-3) ──────────────────

  test('the delete tools are gone', async () => {
    for (const tool of ['delete_plan', 'bulk_delete_plans']) {
      const res = await agent.callTool(tool, { plan_uid: planUid, plan_uids: [planUid] });
      expect(res.isError, `${tool} should no longer exist`).toBe(true);
    }
    expect((await json('get_plan', { plan_uid: planUid })).status).not.toBe('archived');
  });

  test('request_plan_deletion asks the window and deletes nothing', async () => {
    const events = await openEventStream(h.backend);
    try {
      const a = await json('create_plan', { title: 'Old spike', project_path: root });
      const b = await json('create_plan', { title: 'Abandoned idea', project_path: root });
      const res = await json('request_plan_deletion', { plan_uids: [a.uid, b.uid], reason: 'Both superseded by the payments plan.' });
      expect(res.requested).toBe(true);
      expect(res.note).toMatch(/Nothing has been deleted/);

      const asked = await events.waitFor('ui-confirm-plan-deletion', (p) => p.requestId === res.requestId);
      expect(asked.plans.map((p: { title: string }) => p.title)).toEqual(['Old spike', 'Abandoned idea']);
      expect(asked.reason).toBe('Both superseded by the payments plan.');

      // Still there, in the DB and on disk.
      const listed = ((await json('list_plans', { project_path: root })) as { plans: Array<{ uid: string }> }).plans.map((p) => p.uid);
      expect(listed).toEqual(expect.arrayContaining([a.uid, b.uid]));
      expect(dirsFor(a.uid)).toHaveLength(1);
    } finally {
      await events.close();
    }
  });

  test('request_plan_deletion refuses unknown and archived plans', async () => {
    expect((await agent.callTool('request_plan_deletion', { plan_uids: ['no-such-plan'], reason: 'x' })).isError).toBe(true);
    const gone = await json('create_plan', { title: 'Already gone', project_path: root });
    await h.client.raw('DELETE', `/api/plans/${gone.uid}`);
    const res = await agent.callTool('request_plan_deletion', { plan_uids: [gone.uid], reason: 'x' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No active plan/);
  });

  test('request_plan_deletion refuses a plan whose project is not open', async () => {
    const plan = await json('create_plan', { title: 'In the first project', project_path: root });
    // Open a different project and drop the first from the recent list:
    // the first is then no longer an opened project.
    const other = path.join(h.fixture.tmpDir, 'other-project');
    fs.mkdirSync(path.join(other, 'src'), { recursive: true });
    fs.writeFileSync(path.join(other, 'src', 'x.ts'), 'export const x = 1;\n');
    await h.client.scanProject(other);
    await h.client.raw('DELETE', '/api/recent-projects', { projectPath: root });
    try {
      const res = await agent.callTool('request_plan_deletion', { plan_uids: [plan.uid], reason: 'x' });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/not open/);
    } finally {
      await h.client.scanProject(root);
    }
  });

  test('before it is committed, a plan\'s directory follows its title — one directory, named for the latest', async () => {
    const made = await json('create_plan', { title: 'Draft name', project_path: root });
    const [first] = dirsFor(made.uid);
    expect(first).toMatch(/^draft-name-/);
    await json('update_plan', { plan_uid: made.uid, title: 'Final name' });
    await waitFor(() => dirsFor(made.uid)[0]?.startsWith('final-name-') ?? false, { timeoutMs: 5000, description: 'the directory to take the new title' });
    expect(dirsFor(made.uid)).toHaveLength(1);
    expect(fs.existsSync(path.join(plansDir, first))).toBe(false);
  });
});
