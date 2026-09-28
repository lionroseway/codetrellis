/**
 * A skill arriving in a pulled plan file is flagged once, before any agent
 * is told to use it (Phase 32 C1.4), end to end: a plan exported to the
 * project's plan files and committed, then someone else's commit adds a
 * recommended skill to a task's file, and the plan is imported.
 *
 *  - Skills added in the app, and CodeTrellis re-reading its own files, are
 *    not arrivals.
 *  - The pulled skill is listed for the plan with who added it and in which
 *    commit; the task's skills say it is waiting.
 *  - No agent reads it (brief, claim, item) until a person accepts it; then
 *    they do. Importing again does not flag it twice.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

const as = (name: string) => ({ ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name}@x`, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: `${name}@x` });

interface Arrival { itemUid: string; itemTitle: string; skill: string; addedBy: string | null; commit: string | null }

test.describe.serial('Skills arriving in a plan file', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let planUid: string;
  let itemUid: string;
  let planDir: string;
  let itemFile: string;
  let agent: ScriptedMcp;
  let priyaCommit: string;

  const git = (name: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { env: as(name), encoding: 'utf-8' }).trim();
  const arrivals = async () => ((await (await h.client.raw('GET', `/api/plans/${planUid}/skill-arrivals`)).json()) as { arrivals: Arrival[] }).arrivals;
  const importPlan = async () => expect((await h.client.raw('POST', `/api/plans/import?path=${encodeURIComponent(planDir)}`)).ok).toBe(true);
  const brief = async () => JSON.parse((await agent.callTool('get_brief', { item_uid: itemUid })).text) as { skills: Array<{ name: string }>; skills_note: string | null };

  test.beforeAll(async () => {
    h = await setupHarness('skill-arrivals');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    planUid = (await h.client.createPlan({ title: 'Currency', projectPath: root })).uid;
    itemUid = ((await (await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Currency support' })).json()) as { uid: string }).uid;
    // A skill added in the app: the person adding it is the one who would accept it.
    await h.client.raw('PUT', `/api/items/${itemUid}`, { skills: [{ name: 'house-rules', source: 'skill', required: false, use: 'recommended' }] });

    const exported = (await (await h.client.raw('POST', `/api/plans/${planUid}/export?path=${encodeURIComponent(root)}`)).json()) as { planDir: string; files: string[] };
    planDir = exported.planDir;
    itemFile = exported.files.map((f) => (path.isAbsolute(f) ? f : path.join(planDir, f)))
      .find((f) => f.endsWith('.yaml') && fs.existsSync(f) && fs.readFileSync(f, 'utf-8').includes(itemUid))!;
    expect(itemFile).toBeTruthy();
    git('Sam', 'add', '-A');
    git('Sam', 'commit', '-qm', 'Share the currency plan');

    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await agent.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    await h?.teardown();
  });

  test('skills added in the app, and re-reading our own files, are not arrivals', async () => {
    await importPlan();
    expect(await arrivals()).toEqual([]);
    expect((await brief()).skills.map((s) => s.name)).toEqual(['house-rules']);
  });

  test('a skill someone else committed to the task\'s file is flagged with who and which commit', async () => {
    const raw = parseYaml(fs.readFileSync(itemFile, 'utf-8')) as Record<string, unknown>;
    raw.skills = [...((raw.skills as unknown[]) ?? []), { name: 'pr-review', source: 'skill', required: false, use: 'recommended', why: 'our review steps' }];
    fs.writeFileSync(itemFile, stringifyYaml(raw));
    git('Priya', 'commit', '-qam', 'Recommend pr-review for currency');
    priyaCommit = git('Priya', 'rev-parse', '--short', 'HEAD');
    await importPlan();

    const list = await arrivals();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ itemUid, itemTitle: 'Currency support', skill: 'pr-review', addedBy: 'Priya' });
    expect(priyaCommit.startsWith(list[0].commit ?? 'none')).toBe(true);

    // The person sees it waiting, on the task.
    const { skills } = (await (await h.client.raw('GET', `/api/items/${itemUid}/skills`)).json()) as { skills: Array<{ skill: { name: string }; pending: Arrival | null }> };
    expect(skills.find((r) => r.skill.name === 'pr-review')?.pending).toMatchObject({ addedBy: 'Priya' });
    expect(skills.find((r) => r.skill.name === 'house-rules')?.pending).toBeNull();
  });

  test('no agent reads it until a person accepts it: not in the brief, the claim, or the item', async () => {
    const b = await brief();
    expect(b.skills.map((s) => s.name)).toEqual(['house-rules']);
    expect(b.skills_note).not.toContain('pr-review');
    for (const tool of [['get_item', { uid: itemUid }], ['claim_item', { uid: itemUid }]] as const) {
      const r = await agent.callTool(tool[0], tool[1]);
      expect(r.text, tool[0]).not.toContain('pr-review');
    }
  });

  test('importing again does not flag it twice', async () => {
    await importPlan();
    expect(await arrivals()).toHaveLength(1);
  });

  test('once accepted, agents are told it; it is no longer waiting, and cannot be accepted twice', async () => {
    const res = await h.client.raw('POST', `/api/items/${itemUid}/skill-arrivals/accept`, { skill: 'pr-review' });
    expect(res.ok).toBe(true);
    expect(await arrivals()).toEqual([]);
    const b = await brief();
    expect(b.skills.map((s) => s.name)).toEqual(['house-rules', 'pr-review']);
    expect(b.skills_note).toContain('use **pr-review**');
    expect((await agent.callTool('get_item', { uid: itemUid })).text).toContain('pr-review');

    expect((await h.client.raw('POST', `/api/items/${itemUid}/skill-arrivals/accept`, { skill: 'pr-review' })).status).toBe(404);
    expect((await h.client.raw('POST', '/api/items/no-such-item/skill-arrivals/accept', { skill: 'pr-review' })).status).toBe(404);
    expect((await h.client.raw('GET', '/api/plans/no-such-plan/skill-arrivals')).status).toBe(404);
  });
});
