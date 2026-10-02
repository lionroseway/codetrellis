/**
 * Phase 32 C2.5a — ticket refs in the plan's files.
 *
 * Dana's plan "Q3 board pack" is for FIN-88, and its task links the design.
 * The plan is shared through git: plan.yaml names the ticket and the task's
 * file names its link. Priya pulls it on another machine and imports it:
 * the plan's lineage starts "FIN-88 → this plan", and the task has its
 * link. Adding a link writes the file, as adding a task does. A file is
 * anyone's text: a link that is not http(s) is dropped, and a file without
 * a link does not take one away.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

interface Ref { url: string; externalKey?: string | null; title: string }

test.describe.serial('Ticket refs in the plan files', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let plan: string;
  let task: string;
  let planDir: string;
  let agent: ScriptedAgent;
  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const itemFile = () => {
    const dir = path.join(planDir, 'items');
    return path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.yaml'))!);
  };
  /** The plan's own tickets (the REST `/api/plans/:uid/refs` lists its items' links). */
  const planRefs = async () => JSON.parse((await agent.callTool('list_plan_external_refs', { plan_uid: plan })).text) as Ref[];
  const itemRefs = async () => (await (await raw('GET', `/api/items/${task}/refs`)).json()) as Ref[];
  const planTickets = async () => ((await (await raw('GET', `/api/plans/${plan}/status`)).json()) as { lineage: string[] }).lineage;

  test.beforeAll(async () => {
    h = await setupHarness('plan-file-refs');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    plan = (await h.client.createPlan({ title: 'Q3 board pack', projectPath: root })).uid;
    task = ((await (await raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title: 'Write the board report' })).json()) as { uid: string }).uid;
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    const set = await agent.callTool('set_plan_external_ref', { plan_uid: plan, url: 'https://acme.atlassian.net/browse/FIN-88', key: 'FIN-88' });
    expect(set.isError, set.text).toBeFalsy();
    expect((await raw('POST', `/api/items/${task}/refs`, { url: 'https://www.figma.com/file/abc123/Board-pack', title: 'Board pack design' })).ok).toBe(true);
    planDir = (await h.client.exportPlan(plan, root)).planDir;
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('plan.yaml names the ticket, and the task\'s file names its link', async () => {
    const planYaml = parseYaml(fs.readFileSync(path.join(planDir, 'plan.yaml'), 'utf-8')) as { refs?: unknown };
    expect(planYaml.refs).toEqual([{ url: 'https://acme.atlassian.net/browse/FIN-88', key: 'FIN-88', kind: 'jira' }]);
    const item = parseYaml(fs.readFileSync(itemFile(), 'utf-8')) as { refs?: unknown };
    expect(item.refs).toEqual([{ url: 'https://www.figma.com/file/abc123/Board-pack', kind: 'figma', title: 'Board pack design' }]);
  });

  test('adding a link writes the file, as adding a task does', async () => {
    expect((await raw('POST', `/api/items/${task}/refs`, { url: 'https://docs.example.com/q3-figures', title: 'Q3 figures' })).ok).toBe(true);
    await expect.poll(() => fs.readFileSync(itemFile(), 'utf-8').includes('https://docs.example.com/q3-figures'), { timeout: 5_000 }).toBe(true);
  });

  test('a teammate who pulls and imports the plan sees its ticket in the lineage, and the task\'s links', async () => {
    // As a teammate pulling would: copy it aside, drop the plan here, put the
    // files back where git would, and import them.
    const transit = path.join(h.fixture.tmpDir, 'plan-refs-transit');
    fs.cpSync(planDir, transit, { recursive: true });
    await h.client.unlinkPlan(plan, root);
    await raw('DELETE', `/api/plans/${plan}`);
    fs.cpSync(transit, planDir, { recursive: true });
    const imported = await h.client.importPlan(planDir);
    expect(imported.plan.uid).toBe(plan);

    expect((await planRefs()).map((r) => r.externalKey)).toEqual(['FIN-88']);
    expect((await planTickets())[0]).toMatch(/^FIN-88 → this plan/);
    expect((await itemRefs()).map((r) => r.url).sort()).toEqual(['https://docs.example.com/q3-figures', 'https://www.figma.com/file/abc123/Board-pack']);
  });

  test('a file is anyone\'s text: a link that is not http(s) is dropped, and a file without a link takes none away', async () => {
    const file = itemFile();
    const doc = parseYaml(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    doc.refs = [{ url: 'javascript:alert(1)', title: 'click me' }, { url: 'file:///etc/passwd' }];
    fs.writeFileSync(file, stringifyYaml(doc));
    expect((await raw('POST', '/api/plans/import', { planDir })).ok).toBe(true);
    const urls = (await itemRefs()).map((r) => r.url);
    expect(urls).not.toContain('javascript:alert(1)');
    expect(urls).not.toContain('file:///etc/passwd');
    expect(urls).toHaveLength(2);

    const planFile = path.join(planDir, 'plan.yaml');
    const p = parseYaml(fs.readFileSync(planFile, 'utf-8')) as Record<string, unknown>;
    delete p.refs;
    fs.writeFileSync(planFile, stringifyYaml(p));
    expect((await raw('POST', '/api/plans/import', { planDir })).ok).toBe(true);
    expect((await planRefs()).map((r) => r.externalKey)).toEqual(['FIN-88']);
  });
});
