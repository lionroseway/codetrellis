/**
 * Phase 32 C2.1 — each item's state from git, for any host or none, on real
 * repositories with a real remote (a bare repository standing in for any
 * host: git neither knows nor cares which).
 *
 * Sam's plan has five sections, each worked on its own branch. With no host
 * turned on, the plan says what git proves: "building" for work not pushed,
 * "pushed, not merged" for a branch on the remote, and "merged" three ways
 * (a merge commit, a squash, a rebase), each with the commit that proves it.
 * A branch that stopped stays "pushed", never "merged". The same words reach
 * the window's route, an agent's get_plan and the task's brief.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface State { itemUid: string; branch: string; state: string; how?: string; commit: string | null; source: string; words: string; base: string | null }

test.describe.serial('Each item\'s state from git', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let plan: string;
  let main: string;
  let agent: ScriptedAgent;
  const uid: Record<string, string> = {};
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env: ENV, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const work = (branch: string, file: string, text: string) => {
    g('checkout', '-q', '-b', branch, main);
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
    g('add', '-A');
    g('commit', '-q', '-m', `${branch}: work`);
    g('checkout', '-q', main);
  };
  const states = async () => {
    const res = await h.client.raw('GET', `/api/plans/${plan}/git-state`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { base: string; items: State[] };
    return Object.fromEntries(body.items.map((s) => [Object.keys(uid).find((k) => uid[k] === s.itemUid)!, s]));
  };

  test.beforeAll(async () => {
    h = await setupHarness('item-git-state');
    root = h.fixture.projectPath;
    main = g('rev-parse', '--abbrev-ref', 'HEAD');
    const origin = path.join(path.dirname(root), `${path.basename(root)}-origin.git`);
    execFileSync('git', ['init', '-q', '--bare', origin]);
    g('remote', 'add', 'origin', origin);
    g('push', '-q', 'origin', main);
    await h.client.scanProject(root);
    for (const b of ['billing', 'exports', 'refunds', 'rebased', 'abandoned']) work(b, `src/${b}/index.ts`, `export const ${b} = 1;\n`);
    g('push', '-q', 'origin', 'billing', 'exports', 'refunds', 'abandoned');

    plan = (await h.client.createPlan({ title: 'Payments', projectPath: root })).uid;
    for (const b of ['billing', 'exports', 'refunds', 'rebased', 'abandoned']) {
      uid[b] = ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'object', title: `${b} section` })).json()) as { uid: string }).uid;
    }
    uid.task = ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title: 'Charge in the right currency', parentUid: uid.billing })).json()) as { uid: string }).uid;
    uid.loose = ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title: 'Not on any branch' })).json()) as { uid: string }).uid;
    // The window lists the branches, so they are known workstreams to assign.
    expect((await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}&idle=1`)).ok).toBe(true);
    for (const b of ['billing', 'exports', 'refunds', 'rebased', 'abandoned']) {
      const res = await h.client.raw('PUT', `/api/items/${uid[b]}/workstream`, { workstream: b });
      expect(res.ok, `${b}: ${await res.clone().text()}`).toBe(true);
    }
    agent = await h.spawnAgent({ agentType: 'codex' });
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('before anything merges: building, or pushed, from git, and the task inherits its section\'s', async () => {
    const s = await states();
    expect(s.billing).toMatchObject({ state: 'pushed', source: 'git', branch: 'billing', base: main, words: 'pushed, not merged' });
    expect(s.rebased).toMatchObject({ state: 'building', words: 'building on rebased, not pushed' });
    expect(s.task).toMatchObject({ state: 'pushed', branch: 'billing' });
    // An item on no branch: git has nothing to say, so nothing is said.
    expect(s.loose).toBeUndefined();
  });

  test('merged three ways, each with the commit that proves it; a stopped branch stays pushed', async () => {
    g('merge', '-q', '--no-ff', '-m', 'Merge exports', 'exports');
    const mergeCommit = g('rev-parse', 'HEAD');
    g('merge', '-q', '--squash', 'billing');
    g('commit', '-q', '-m', 'Billing (#118)');
    const squash = g('rev-parse', 'HEAD');
    g('cherry-pick', 'rebased');
    const rebase = g('rev-parse', 'HEAD');
    // Refunds is squashed with its key in the message, and its branch deleted everywhere.
    g('merge', '-q', '--squash', 'refunds');
    g('commit', '-q', '-m', `Refunds (task ${uid.refunds.slice(0, 8)})`);
    const named = g('rev-parse', 'HEAD');
    g('branch', '-q', '-D', 'refunds');
    g('push', '-q', 'origin', '--delete', 'refunds');

    const s = await states();
    expect(s.exports).toMatchObject({ state: 'merged', how: 'merge', commit: mergeCommit });
    expect(s.exports.words).toMatch(new RegExp(`^merged into ${main} \\(merge commit, \\d+ \\w+\\)$`));
    expect(s.billing).toMatchObject({ state: 'merged', how: 'squash-or-rebase', commit: squash });
    expect(s.task).toMatchObject({ state: 'merged', how: 'squash-or-rebase', commit: squash });
    expect(s.rebased).toMatchObject({ state: 'merged', how: 'squash-or-rebase', commit: rebase });
    expect(s.refunds).toMatchObject({ state: 'merged', how: 'names-key', commit: named });
    // Stopped: pushed, never merged, and nothing claims it was closed.
    expect(s.abandoned).toMatchObject({ state: 'pushed', words: 'pushed, not merged' });
  });

  test('an agent reads the same words, with where they came from', async () => {
    const got = JSON.parse((await agent.callTool('get_plan', { plan_uid: plan })).answer) as {
      git_state: { base: string; items: Array<{ title: string; state: string; says: string; source: string; commit: string | null }>; note: string };
    };
    expect(got.git_state.base).toBe(main);
    const byTitle = Object.fromEntries(got.git_state.items.map((i) => [i.title, i]));
    expect(byTitle['abandoned section']).toMatchObject({ state: 'pushed', says: 'pushed, not merged', source: 'git' });
    expect(byTitle['billing section'].says).toMatch(/^merged into .+ \(squash or rebase, /);
    // No host turned on: the note says what one would add, and where the person turns it on (C2.2).
    expect(got.git_state.note).toContain('need a review host, which the person turns on in Settings → Review hosts');

    const brief = JSON.parse((await agent.callTool('get_brief', { item_uid: uid.task })).answer) as { git_state: { branch: string; state: string; says: string } | null };
    expect(brief.git_state).toMatchObject({ branch: 'billing', state: 'merged' });
    const loose = JSON.parse((await agent.callTool('get_brief', { item_uid: uid.loose })).answer) as { git_state: unknown };
    expect(loose.git_state).toBeNull();
  });

  test('a plan that does not exist is a 404', async () => {
    expect((await h.client.raw('GET', '/api/plans/no-such-plan/git-state')).status).toBe(404);
  });
});
