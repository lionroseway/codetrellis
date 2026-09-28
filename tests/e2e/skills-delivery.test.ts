/**
 * Skills on a task reach the agent (Phase 32 C1.1), end to end: a real
 * project with a skill in `.claude/skills`, a worktree made before the skill
 * existed, and two agents, one in each.
 *
 *  - The project's skills are listed, with their descriptions.
 *  - A skill is checked on the way in: a path out of the project, or a link
 *    that is not http(s), is refused.
 *  - get_next_item, claim_item and get_brief all say which skills to use and
 *    where, in one line; a `link` is never in what an agent reads.
 *  - An agent whose checkout lacks the skill is told so, and how to get it.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';
import type { AgentSkill, PlanItem, ProjectSkill } from '../../src/shared/types';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 's@x', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 's@x' };
const LINK = 'https://wiki.example.com/house-style';

test.describe.serial('Skills reach the agent', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let old: string;
  let planUid: string;
  let itemUid: string;
  let agent: ScriptedMcp;
  let behind: ScriptedMcp;

  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf-8' }).trim();
  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);
  const putSkills = (skills: unknown) => h.client.raw('PUT', `/api/items/${itemUid}`, { skills });
  const bound = (clientName: string, folder: string) => expect.poll(async () => {
    const sessions = (await (await h.client.raw('GET', '/api/sessions')).json()) as Array<{ agentType: string; workstreamRoot: string | null }>;
    return sessions.some((s) => s.agentType === clientName && !!s.workstreamRoot && same(s.workstreamRoot, folder));
  }, { timeout: 10_000 }).toBe(true);

  test.beforeAll(async () => {
    h = await setupHarness('skills-delivery');
    root = h.fixture.projectPath;
    // The worktree is made first, from a commit without the skill.
    old = `${root}-old`;
    git(root, 'worktree', 'add', '-q', old, '-b', 'before-skills');
    fs.mkdirSync(path.join(root, '.claude/skills/pr-review'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude/skills/pr-review/SKILL.md'), '---\nname: pr-review\ndescription: Review a pull request before merge\n---\n\n1. Read the diff.\n');
    await h.client.scanProject(root);

    planUid = (await h.client.createPlan({ title: 'Skills plan', projectPath: root })).uid;
    const res = await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Currency support', body: 'Add GBP.' });
    itemUid = ((await res.json()) as { uid: string }).uid;

    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [root] });
    behind = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [old] });
    await agent.connect();
    await behind.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    await behind?.disconnect().catch(() => {});
    try { git(root, 'worktree', 'remove', '--force', old); } catch { /* */ }
    await h?.teardown();
  });

  test('the project\'s skills are listed, name and description; a project that is not open is refused', async () => {
    const { skills } = (await (await h.client.raw('GET', `/api/skills?project=${encodeURIComponent(root)}`)).json()) as { skills: ProjectSkill[] };
    expect(skills).toEqual([{ name: 'pr-review', description: 'Review a pull request before merge', path: '.claude/skills/pr-review/SKILL.md' }]);
    expect((await h.client.raw('GET', `/api/skills?project=${encodeURIComponent('/not/open')}`)).ok).toBe(false);
  });

  test('a skill that points out of the project, or a link that is not http(s), is refused and nothing is stored', async () => {
    const out = await putSkills([{ name: 'pr-review', source: 'skill', required: false, use: 'recommended', where: { kind: 'repo', path: '../../etc' } }]);
    expect(out.status).toBe(400);
    expect(((await out.json()) as { error: string }).error).toContain('relative path inside the project');
    const js = await putSkills([{ name: 'x', source: 'skill', required: false, where: { kind: 'link', url: 'javascript:alert(1)' } }]);
    expect(js.status).toBe(400);
    const item = (await (await h.client.raw('GET', `/api/items/${itemUid}`)).json()) as PlanItem;
    expect(item.skills ?? []).toEqual([]);
  });

  test('skills are stored normalised: a folder means its SKILL.md', async () => {
    const res = await putSkills([
      { name: 'pr-review', source: 'skill', required: false, use: 'recommended', why: 'this task ends in a PR', where: { kind: 'repo', path: '.claude/skills/pr-review' } },
      { name: 'house-style', source: 'skill', required: false, use: 'recommended', where: { kind: 'link', url: LINK } },
      { name: 'typescript', source: 'lang', required: true },
    ]);
    expect(res.ok).toBe(true);
    const item = (await res.json()) as PlanItem;
    expect(item.skills?.[0].where).toEqual({ kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' });
    // People see the link; the next tests show agents never do.
    expect(item.skills?.[1].where).toEqual({ kind: 'link', url: LINK });
  });

  test('get_next_item, claim_item and get_brief each tell the agent which skills to use and where, never the link', async () => {
    await bound('claude-code', root);
    const note = 'Skills for this task: use **pr-review** (`.claude/skills/pr-review/SKILL.md`), because this task ends in a PR; ' +
      'use **house-style**; required: **typescript**.';

    const next = await agent.callTool('get_next_item', { plan_uid: planUid });
    expect(next.isError).toBeFalsy();
    expect(JSON.parse(next.text).skills_note).toBe(note);

    // The required skill still gates the claim (17.N): the agent declares it first.
    expect((await agent.callTool('claim_item', { uid: itemUid })).text).toContain('requires skills you don\'t have: typescript');
    await agent.callTool('register_session', { agent_type: 'claude-code', capabilities: [{ name: 'typescript', source: 'lang' }] });
    const claim = await agent.callTool('claim_item', { uid: itemUid });
    expect(claim.isError).toBeFalsy();
    const claimed = JSON.parse(claim.text) as { ok: boolean; skills: AgentSkill[]; skills_note: string };
    expect(claimed, claim.text).toMatchObject({ ok: true });
    expect(claimed.skills_note).toBe(note);
    expect(claimed.skills.map((s) => [s.name, s.use, s.missing])).toEqual([
      ['pr-review', 'recommended', null], ['house-style', 'recommended', null], ['typescript', 'required', null],
    ]);

    const brief = JSON.parse((await agent.callTool('get_brief', { item_uid: itemUid })).text) as { skills: AgentSkill[]; skills_note: string };
    expect(brief.skills_note).toBe(note);
    expect(brief.skills[0].where).toEqual({ kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' });

    // Nowhere in what the agent reads: not in the skills block, and not in
    // the item that claim_item, get_next_item and get_item return either.
    const got = await agent.callTool('get_item', { uid: itemUid });
    for (const text of [next.text, claim.text, JSON.stringify(brief), got.text]) {
      expect(text).not.toContain('wiki.example.com');
    }
    // The skill is still there without its link, and the person still sees the link.
    expect(JSON.stringify(JSON.parse(got.text))).toContain('house-style');
    const person = (await (await h.client.raw('GET', `/api/items/${itemUid}`)).json()) as PlanItem;
    expect(person.skills?.find((s) => s.name === 'house-style')?.where).toEqual({ kind: 'link', url: LINK });
  });

  test('an agent whose checkout lacks the skill is told so, and how to get it', async () => {
    await bound('codex', old);
    const brief = JSON.parse((await behind.callTool('get_brief', { item_uid: itemUid })).text) as { skills: AgentSkill[]; skills_note: string };
    const pr = brief.skills.find((s) => s.name === 'pr-review')!;
    expect(pr.where).toEqual({ kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' });
    expect(pr.missing).toMatch(/not in your workstream .*bring your branch up to date with the main branch/);
    expect(brief.skills_note).toContain('(missing: .claude/skills/pr-review/SKILL.md is not in your workstream');
  });
});
