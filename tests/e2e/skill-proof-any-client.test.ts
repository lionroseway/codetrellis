/**
 * Proof of skill use for any client (Phase 32 A8.4), end to end: Codex, with
 * no session watcher, claims a task that recommends two of the project's
 * skills, is told to load them with get_skill, and loads one.
 *
 *  - Before: both read "unknown" (nothing seen).
 *  - After: the loaded one reads "used", seen through CodeTrellis; the other
 *    still "unknown", never "not used"; the sign-off pack says how it was seen.
 *  - A skill that is not the project's is refused, naming the ones that are;
 *    a skill folder that is a link out of the repository is not read.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

test.describe.serial('Proof of skill use, any client', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let planUid: string;
  let taskUid: string;
  let codex: ScriptedMcp;

  const proofs = async () => {
    const { skills } = (await (await h.client.raw('GET', `/api/items/${taskUid}/skills`)).json()) as { skills: Array<{ skill: { name: string }; proof: string | null; proofSource: string | null }> };
    return Object.fromEntries(skills.map((r) => [r.skill.name, [r.proof, r.proofSource]]));
  };

  test.beforeAll(async () => {
    h = await setupHarness('skill-proof-any-client');
    root = h.fixture.projectPath;
    for (const [name, desc] of [['pr-review', 'Review a pull request before merge'], ['migrations', 'Write a reversible migration']]) {
      fs.mkdirSync(path.join(root, `.claude/skills/${name}`), { recursive: true });
      fs.writeFileSync(path.join(root, `.claude/skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: ${desc}\n---\n\n1. Do the ${name} steps.\n`);
    }
    // A skill folder that is a link out of the repository: never read.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-outside-skill-'));
    fs.writeFileSync(path.join(outside, 'SKILL.md'), '---\nname: leaked\ndescription: not yours\n---\nsecret\n');
    fs.symlinkSync(outside, path.join(root, '.claude/skills/leaked'));
    await h.client.scanProject(root);

    planUid = (await h.client.createPlan({ title: 'Skill proof', projectPath: root })).uid;
    taskUid = ((await (await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Currency support' })).json()) as { uid: string }).uid;
    const put = await h.client.raw('PUT', `/api/items/${taskUid}`, { skills: [
      { name: 'pr-review', source: 'skill', required: false, use: 'recommended', why: 'this task ends in a PR', where: { kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' } },
      { name: 'migrations', source: 'skill', required: false, use: 'recommended', where: { kind: 'repo', path: '.claude/skills/migrations/SKILL.md' } },
    ] });
    expect(put.status).toBe(200);
    codex = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await codex.connect();
  });

  test.afterAll(async () => {
    await codex?.disconnect().catch(() => {});
    await h?.teardown();
  });

  test('claiming, it is told which skills to load, and how; nothing is seen yet', async () => {
    const claim = JSON.parse((await codex.callTool('claim_item', { uid: taskUid })).answer) as { ok: boolean; skills_load?: string };
    expect(claim.ok).toBe(true);
    expect(claim.skills_load).toBe('Load each with get_skill(name): pr-review, migrations. Reading it there shows the person you used it.');
    expect(await proofs()).toEqual({ 'pr-review': ['unknown', null], migrations: ['unknown', null] });
  });

  test('it loads one: the instructions, and "used", seen through CodeTrellis; the other is still unknown, never "not used"', async () => {
    const got = JSON.parse((await codex.callTool('get_skill', { name: 'pr-review' })).answer) as { name: string; path: string; instructions: string; recorded_on: string[] };
    expect(got).toMatchObject({ name: 'pr-review', path: '.claude/skills/pr-review/SKILL.md', recorded_on: [taskUid] });
    expect(got.instructions).toContain('1. Do the pr-review steps.');
    expect(await proofs()).toEqual({ 'pr-review': ['used', 'mcp'], migrations: ['unknown', null] });
  });

  test('the sign-off pack says how the use was seen', async () => {
    const data = (await (await h.client.raw('GET', `/api/plans/${planUid}/signoff-pack`)).json()) as { skills: Array<{ name: string; proof: string; proofSource: string | null }> };
    expect(data.skills.map((s) => [s.name, s.proof, s.proofSource])).toEqual([['pr-review', 'used', 'mcp'], ['migrations', 'unknown', null]]);
    const page = await (await h.client.raw('GET', `/api/plans/${planUid}/signoff-pack.html`)).text();
    expect(page).toContain('✓ used (read through CodeTrellis)');
    expect(page).toContain('unknown (nothing seen: the agent may have read the file itself)');
  });

  test('a skill that is not the project\'s is refused, naming those that are; a linked folder is not one of them', async () => {
    const none = await codex.callTool('get_skill', { name: 'deploy' });
    expect(none.isError).toBe(true);
    expect(none.text).toContain('The project\'s skills: migrations, pr-review.');
    const leaked = await codex.callTool('get_skill', { name: 'leaked' });
    expect(leaked.isError).toBe(true);
    expect(leaked.text).not.toContain('secret');
  });
});
