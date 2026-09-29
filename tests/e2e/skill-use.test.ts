/**
 * Proof that a recommended skill was used (Phase 32 C1.3), end to end: a
 * Claude Code session in a worktree, found by the real watcher; the MCP
 * session of the same agent claims a task; the agent loads a skill, which
 * Claude Code records as a `Skill` tool call in its session log.
 *
 *  - Before: the task's skills read "not used" (a Claude Code agent is on it).
 *  - After: the loaded one reads "used", the other still "not used"; the
 *    Timeline has a skill_used event naming the task; the sign-off pack says
 *    so, in its data and on its page.
 *  - A task another client works reads "unknown", never "not used".
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';
import type { SkillProof } from '../../src/shared/types';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Proof of skill use', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let worktree: string;
  let claudeHome: string;
  let jsonl: string;
  let planUid: string;
  let taskUid: string;
  let otherUid: string;
  let claude: ScriptedMcp;
  let codex: ScriptedMcp;

  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);
  const proofs = async (uid: string) => {
    const { skills } = (await (await h.client.raw('GET', `/api/items/${uid}/skills`)).json()) as { skills: Array<{ skill: { name: string }; proof: SkillProof | null }> };
    return Object.fromEntries(skills.map((r) => [r.skill.name, r.proof]));
  };
  const bound = (clientName: string, folder: string) => expect.poll(async () => {
    const sessions = (await (await h.client.raw('GET', '/api/sessions')).json()) as Array<{ agentType: string; workstreamRoot: string | null }>;
    return sessions.some((s) => s.agentType === clientName && !!s.workstreamRoot && same(s.workstreamRoot, folder));
  }, { timeout: 10_000 }).toBe(true);
  const skills = [
    { name: 'pr-review', source: 'skill', required: false, use: 'recommended', why: 'this task ends in a PR' },
    { name: 'migrations', source: 'skill', required: false, use: 'recommended' },
  ];

  test.beforeAll(async () => {
    h = await setupHarness('skill-use', { env: { CODETRELLIS_WATCHER_POLL_MS: '100' } });
    root = h.fixture.projectPath;
    claudeHome = path.join(h.fixture.dataDir, 'claude-home');
    worktree = `${root}-skills`;
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', worktree, '-b', 'ws-skills'], { env: ENV });

    // The Claude Code session Claude Code would write for an agent in the worktree.
    const dir = path.join(claudeHome, 'projects', worktree.replace(/\//g, '-'));
    fs.mkdirSync(path.join(claudeHome, 'sessions'), { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(claudeHome, 'sessions', 'cc-skills.json'), JSON.stringify({ sessionId: 'cc-skills', cwd: worktree, pid: process.pid }));
    jsonl = path.join(dir, 'cc-skills.jsonl');
    fs.writeFileSync(jsonl, '');
    await h.client.scanProject(root);

    planUid = (await h.client.createPlan({ title: 'Skill use', projectPath: root })).uid;
    const create = async (title: string) => ((await (await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title })).json()) as { uid: string }).uid;
    taskUid = await create('Currency support');
    otherUid = await create('Refunds');
    for (const uid of [taskUid, otherUid]) expect((await h.client.raw('PUT', `/api/items/${uid}`, { skills })).ok).toBe(true);

    claude = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [worktree] });
    codex = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await claude.connect();
    await codex.connect();
  });

  test.afterAll(async () => {
    await claude?.disconnect().catch(() => {});
    await codex?.disconnect().catch(() => {});
    try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', worktree]); } catch { /* */ }
    await h?.teardown();
  });

  test('nobody on the task yet: no answer at all, never "not used"', async () => {
    expect(await proofs(taskUid)).toEqual({ 'pr-review': null, migrations: null });
  });

  test('a Claude Code agent claims it: both read not used until it loads one', async () => {
    await bound('claude-code', worktree);
    await bound('codex', root);
    expect(JSON.parse((await claude.callTool('claim_item', { uid: taskUid })).text).ok).toBe(true);
    expect(JSON.parse((await codex.callTool('claim_item', { uid: otherUid })).text).ok).toBe(true);
    expect(await proofs(taskUid)).toEqual({ 'pr-review': 'not_used', migrations: 'not_used' });
    // Another client cannot say which skills it loads.
    expect(await proofs(otherUid)).toEqual({ 'pr-review': 'unknown', migrations: 'unknown' });
  });

  test('the agent loads pr-review: used, on its task only, and in the Timeline', async () => {
    await expect.poll(async () => {
      const s = (await (await h.client.raw('GET', '/api/agent/status')).json()) as { sessions: Array<{ sessionId: string }> };
      return s.sessions.some((x) => x.sessionId === 'cc-skills');
    }, { timeout: 20_000 }).toBe(true);
    fs.appendFileSync(jsonl, JSON.stringify({
      type: 'assistant', sessionId: 'cc-skills', timestamp: new Date().toISOString(),
      message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'pr-review' } }] },
    }) + '\n');

    await expect.poll(() => proofs(taskUid), { timeout: 15_000 }).toEqual({ 'pr-review': 'used', migrations: 'not_used' });
    expect(await proofs(otherUid)).toEqual({ 'pr-review': 'unknown', migrations: 'unknown' });

    const { events } = (await (await h.client.raw('GET', '/api/agent-events?limit=2000')).json()) as { events: Array<{ type: string; payload: Record<string, unknown> }> };
    const used = events.find((e) => e.type === 'skill_used');
    expect(used?.payload).toMatchObject({ skill: 'pr-review', itemUids: [taskUid], sessionId: 'cc-skills' });
  });

  test('the sign-off pack says which skills were used, in its data and on its page', async () => {
    const pack = (await (await h.client.raw('GET', `/api/plans/${planUid}/signoff-pack`)).json()) as { skills: Array<{ itemTitle: string; name: string; use: string; proof: SkillProof | null }> };
    expect(pack.skills.map((s) => [s.itemTitle, s.name, s.proof])).toEqual([
      ['Currency support', 'pr-review', 'used'], ['Currency support', 'migrations', 'not_used'],
      ['Refunds', 'pr-review', 'unknown'], ['Refunds', 'migrations', 'unknown'],
    ]);
    const html = await (await h.client.raw('GET', `/api/plans/${planUid}/signoff-pack.html`)).text();
    expect(html).toContain('<h2>Skills</h2>');
    expect(html).toContain('<td>Currency support</td><td>pr-review</td><td>recommended</td><td>✓ used (Claude Code session log)</td>');
    expect(html).toContain('<td>Refunds</td><td>pr-review</td><td>recommended</td><td>unknown (nothing seen: the agent may have read the file itself)</td>');
  });
});
