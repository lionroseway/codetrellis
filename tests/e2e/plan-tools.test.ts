/**
 * Plan-level MCP tools (Phase 32 §0.4c-1).
 *
 * Ten plan tools had no test: update, delete, bulk delete, copy as prompt,
 * templates (list, create from, publish), discover, unlink, home repo.
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
import { setupHarness, waitFor, type Harness, type ScriptedAgent } from '../harness';

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
    const versions = (await (await h.client.raw('GET', `/api/plans/${planUid}/versions`)).json()) as unknown[];
    expect(versions.length).toBeGreaterThan(0);
  });

  test('after a rename, write-through keeps writing to the same directory', async () => {
    const [dir] = dirsFor(planUid);
    await json('add_item', { plan_uid: planUid, kind: 'action', title: 'Added after the rename' });
    await waitFor(() => {
      const yaml = parseYaml(fs.readFileSync(path.join(plansDir, dir, 'plan.yaml'), 'utf-8'));
      return yaml?.title === 'Payments cleanup (phase 1)';
    }, { timeoutMs: 5000, description: 'plan.yaml to carry the new title' });
    const files = fs.readdirSync(path.join(plansDir, dir), { recursive: true }).map(String);
    const texts = files.filter((f) => f.endsWith('.yaml')).map((f) => fs.readFileSync(path.join(plansDir, dir, f), 'utf-8')).join('\n');
    expect(texts).toContain('Added after the rename');
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

  test('delete_plan archives the plan and removes its renamed directory', async () => {
    const made = await json('create_plan', { title: 'Short-lived', project_path: root });
    await json('update_plan', { plan_uid: made.uid, title: 'Short-lived, renamed' });
    expect(dirsFor(made.uid)).toHaveLength(1);

    const res = await json('delete_plan', { plan_uid: made.uid });
    expect(res.diskRemoved).toBe(true);
    expect(dirsFor(made.uid)).toEqual([]);
    const listed = (await json('list_plans', { project_path: root })) as { plans: Array<{ uid: string }> };
    expect(listed.plans.map((p) => p.uid)).not.toContain(made.uid);
  });

  test('bulk_delete_plans deletes exactly the plans named', async () => {
    const a = await json('create_plan', { title: 'Bulk A', project_path: root });
    const b = await json('create_plan', { title: 'Bulk B', project_path: root });
    const keep = await json('create_plan', { title: 'Keep me', project_path: root });
    const res = await json('bulk_delete_plans', { plan_uids: [a.uid, b.uid] });
    expect(res.deleted).toBe(2);
    const listed = ((await json('list_plans', { project_path: root })) as { plans: Array<{ uid: string }> }).plans.map((p) => p.uid);
    expect(listed).not.toContain(a.uid);
    expect(listed).not.toContain(b.uid);
    expect(listed).toContain(keep.uid);
    expect(dirsFor(a.uid)).toEqual([]);
  });
});
