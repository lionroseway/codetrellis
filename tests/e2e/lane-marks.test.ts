/**
 * What the Timeline lanes show beyond turns (Phase 32 B2.2), end to end: a
 * real repository with a worktree, real commits (a merge among them), an
 * agent working an item in that worktree, and a person deciding and checking
 * its criteria.
 *
 *  - ◆ Each workstream's own commits: the worktree's since it branched, not
 *    main's history again; a merge is marked; an `agent:` line names the agent.
 *  - ✓ / ✗ A criterion decided, and a check run, are events on the lane of the
 *    workstream the item is being worked in, read when they happen.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';
import type { WorkstreamCommit } from '../../src/shared/types';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 's@x', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 's@x' };

interface Stored { type: string; payload: Record<string, unknown>; workstreamRoot: string | null }

test.describe.serial('Lane marks: commits, decisions and checks', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let auth: string;
  let agent: ScriptedMcp;
  let planUid: string;
  let itemUid: string;

  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf-8' }).trim();
  const commit = (cwd: string, file: string, message: string) => {
    fs.appendFileSync(path.join(cwd, file), `\n// ${message}\n`);
    git(cwd, 'commit', '-qam', message);
  };
  const commits = async (query = '') =>
    ((await (await h.client.raw('GET', `/api/workstreams/commits?project=${encodeURIComponent(root)}${query}`)).json()) as { since: number; commits: Record<string, WorkstreamCommit[]> });
  const events = async () => ((await (await h.client.raw('GET', '/api/agent-events?limit=2000')).json()) as { events: Stored[] }).events;
  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);
  const laneOf = (all: Record<string, WorkstreamCommit[]>, folder: string) =>
    Object.entries(all).find(([r]) => !r.startsWith('branch:') && same(r, folder))?.[1] ?? [];

  test.beforeAll(async () => {
    h = await setupHarness('lane-marks', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    auth = `${root}-auth`;
    git(root, 'worktree', 'add', '-q', auth, '-b', 'auth-refresh');
    await h.client.scanProject(root);

    commit(root, 'README.md', 'Main moves on');
    commit(auth, 'packages/shared/src/validators.ts', 'Tighten email check\n\nagent: codex · model: test');
    // A merge on the worktree's branch: a side branch merged back in.
    git(auth, 'checkout', '-q', '-b', 'auth-side');
    commit(auth, 'packages/shared/src/types.ts', 'Side fix');
    git(auth, 'checkout', '-q', 'auth-refresh');
    git(auth, 'merge', '-q', '--no-ff', 'auth-side', '-m', 'Merge auth-side');

    planUid = (await h.client.createPlan({ title: 'Lane marks', projectPath: root })).uid;
    const res = await h.client.raw('POST', `/api/plans/${planUid}/items`, {
      kind: 'action', title: 'Rotate refresh tokens',
      body: 'Rotate on use.\n\n## Acceptance criteria\n- [ ] Old tokens are refused\n- [ ] Rotation is logged\n',
    });
    itemUid = ((await res.json()) as { uid: string }).uid;

    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [auth] });
    await agent.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    try { git(root, 'worktree', 'remove', '--force', auth); } catch { /* */ }
    await h?.teardown();
  });

  test('◆ each lane has its own commits: the worktree\'s since it branched, main\'s on main; a merge and an agent are named', async () => {
    const { commits: all } = await commits();
    const mine = laneOf(all, auth);
    // Made within a second of each other, so compared as a set.
    expect(mine.map((c) => c.subject).sort()).toEqual(['Merge auth-side', 'Side fix', 'Tighten email check']);
    expect(mine.filter((c) => c.merge).map((c) => c.subject)).toEqual(['Merge auth-side']);
    expect(mine.find((c) => c.subject === 'Tighten email check')).toMatchObject({ agent: 'codex', author: 'Sam' });
    expect(mine.every((c) => /^[0-9a-f]{40}$/.test(c.sha) && c.at > Date.now() - 10 * 60_000)).toBe(true);

    const main = laneOf(all, root);
    expect(main.map((c) => c.subject)).toContain('Main moves on');
    expect(main.map((c) => c.subject)).not.toContain('Tighten email check');
  });

  test('the window is at most a day, and a project that is not open is refused', async () => {
    const { since } = await commits('&since=0');
    expect(since).toBeGreaterThanOrEqual(Date.now() - 24 * 60 * 60 * 1000 - 5_000);
    const { commits: none } = await commits(`&since=${Date.now() + 60_000}`);
    expect(laneOf(none, auth)).toEqual([]);
    expect((await h.client.raw('GET', `/api/workstreams/commits?project=${encodeURIComponent('/not/open')}`)).ok).toBe(false);
  });

  test('✓ / ✗ a person\'s decision on an item the agent is working lands on that worktree\'s lane', async () => {
    // The agent's session binds to its worktree, then it claims the item.
    await expect.poll(async () => {
      const sessions = (await (await h.client.raw('GET', '/api/sessions')).json()) as Array<{ agentType: string; workstreamRoot: string | null }>;
      return sessions.some((s) => s.agentType === 'codex' && !!s.workstreamRoot && same(s.workstreamRoot, auth));
    }, { timeout: 10_000 }).toBe(true);
    expect((await agent.callTool('claim_item', { uid: itemUid })).isError).toBeFalsy();

    const criteria = JSON.parse((await agent.callTool('list_criteria', { item_uid: itemUid })).text) as Array<{ uid: string; text: string }>;
    const refused = criteria.find((c) => c.text === 'Old tokens are refused')!;
    const logged = criteria.find((c) => c.text === 'Rotation is logged')!;
    expect((await h.client.raw('POST', `/api/criteria/${refused.uid}/decide`, { decision: 'approved' })).ok).toBe(true);
    expect((await h.client.raw('POST', `/api/criteria/${logged.uid}/decide`, { decision: 'sent_back', note: 'No log line yet' })).ok).toBe(true);

    await expect.poll(async () => (await events()).filter((e) => e.type === 'criterion_decided').length, { timeout: 10_000 }).toBe(2);
    const decided = (await events()).filter((e) => e.type === 'criterion_decided');
    expect(decided.map((e) => [e.payload.text, e.payload.decision])).toEqual([
      ['Old tokens are refused', 'approved'], ['Rotation is logged', 'sent_back'],
    ]);
    for (const e of decided) {
      expect(same(String(e.payload.workstreamRoot), auth)).toBe(true);
      expect(e.payload.actorType).toBe('unverified');
      expect(e.payload.itemTitle).toBe('Rotate refresh tokens');
    }
  });

  test('a check run counts what passed and failed, on the same lane', async () => {
    expect((await h.client.raw('POST', `/api/plans/${planUid}/check-runs`, {})).ok).toBe(true);
    let run: Stored | undefined;
    await expect.poll(async () => {
      run = (await events()).find((e) => e.type === 'check_run');
      return !!run;
    }, { timeout: 10_000 }).toBe(true);
    expect(run!.payload).toMatchObject({ planUid, trigger: 'manual' });
    // Counted as the check-run panel counts trouble: a failing check or a
    // stale criterion. Neither here: the sent-back one is its own ✗ event.
    expect(run!.payload).toMatchObject({ passed: 2, failed: 0 });
    expect(same(String(run!.payload.workstreamRoot), auth)).toBe(true);
  });
});
