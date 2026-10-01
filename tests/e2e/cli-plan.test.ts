/**
 * Phase 32 D1.3 — changing the plan, committing it, and `status`, as an
 * agent that only runs `codetrellis`.
 *
 * Sam's agent reads "Exports" with `plan show`, adds a follow-up task, renames
 * it, adds a step under it and moves the step to the top level; the plan's
 * files follow. It has also changed code of its own. `codetrellis commit`
 * commits CodeTrellis's files and nothing else: the agent's code stays
 * unstaged, the message names the tasks, and the agent is the co-author.
 * Committing again has nothing to do. `status` says what is under way, what
 * is blocked and what waits on Sam, as the plan does.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const CODE = 'packages/shared/src/validators.ts';
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };

test.describe.serial('codetrellis plan, commit and status', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let plan: string;
  let write: string;
  let followUp: string;
  let step: string;

  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  const ct = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args, '--data-dir', h.fixture.dataDir], {
      cwd: root, env: { ...(process.env as Record<string, string>), ...ENV, CLAUDECODE: '1', CODETRELLIS_AGENT: '' }, encoding: 'utf8', timeout: 90_000,
    });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  /** The plan's files have caught up with an edit (they are written ~200 ms after it). */
  const filesSay = async (text: string) => expect.poll(() => {
    const dir = path.join(root, '.codetrellis');
    if (!fs.existsSync(dir)) return false;
    return (fs.readdirSync(dir, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.yaml'))
      .some((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(text));
  }, { timeout: 15_000 }).toBe(true);

  test.beforeAll(async () => {
    h = await setupHarness('cli-plan');
    root = h.fixture.projectPath;
    // The commit's author is the person's own git identity, as the repo has it.
    git('config', 'user.name', 'Sam Lee');
    git('config', 'user.email', 'sam@acme.test');
    await h.client.scanProject(root);
    plan = (await h.client.createPlan({ title: 'Exports', projectPath: root })).uid;
    write = ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title: 'Write the export endpoint' })).json()) as { uid: string }).uid;
    await h.client.exportPlan(plan, root);
    git('add', '-A');
    git('commit', '-q', '-m', 'plan: Exports');
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('plan show reads the plan and its tasks', async () => {
    const r = ct('plan', 'show');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^Exports \(/);
    expect(r.out).toContain(`${write.slice(0, 8)}  Write the export endpoint`);
  });

  test('plan add, edit, add under and move: the plan changes, and its files follow', async () => {
    const added = ct('plan', 'add', 'Add', 'the', 'CSV', 'export', '--body', 'Same columns as the screen.');
    expect(added.code, added.err).toBe(0);
    followUp = /\(([0-9a-f-]{36})\)/.exec(added.out)![1];
    expect(added.out).toBe(`Added task "Add the CSV export" (${followUp}).`);

    const edited = ct('plan', 'edit', followUp.slice(0, 8), '--title', 'Add the CSV and XLSX export');
    expect(edited.code, edited.err).toBe(0);
    const under = ct('plan', 'add', 'Write', 'the', 'header', 'row', '--under', followUp);
    expect(under.code, under.err).toBe(0);
    step = /\(([0-9a-f-]{36})\)/.exec(under.out)![1];
    const moved = ct('plan', 'move', step, '--top');
    expect(moved.code, moved.err).toBe(0);

    const tree = (await (await h.client.raw('GET', `/api/plans/${plan}/items`)).json()) as Array<{ uid: string; title: string; parentUid: string | null }> | { items: Array<{ uid: string; title: string; parentUid: string | null }> };
    const items = Array.isArray(tree) ? tree : tree.items;
    expect(items.find((i) => i.uid === followUp)?.title).toBe('Add the CSV and XLSX export');
    expect(items.find((i) => i.uid === step)?.parentUid ?? null).toBeNull();
    await filesSay('Add the CSV and XLSX export');
    await filesSay('Write the header row');

    expect(ct('plan', 'move', step).code).toBe(2);
    expect(ct('plan', 'edit', step).code).toBe(2);
  });

  test('commit commits only CodeTrellis\'s files, names the tasks, and leaves the agent\'s code alone', async () => {
    fs.appendFileSync(path.join(root, CODE), '\n// strict mode for exports\n');
    const r = ct('commit');
    expect(r.code, r.err + r.out).toBe(0);
    expect(r.out).toMatch(/^Committed \d+ CodeTrellis files? as [0-9a-f]{7}: Update the plan: /);

    const files = git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith('.codetrellis/'))).toBe(true);
    // The agent's code is still its own: changed, not staged, not committed.
    expect(git('status', '--porcelain', '--', CODE)).toBe(`M ${CODE}`);

    const message = git('log', '-1', '--format=%B');
    expect(message).toContain('Update the plan:');
    expect(message).toContain('Add the CSV and XLSX export');
    expect(message).toContain('Write the header row');
    expect(message).toContain("CodeTrellis's own files only");
    expect(message).toMatch(/Co-Authored-By: .*claude-code/i);
    expect(git('log', '-1', '--format=%an')).toBe('Sam Lee');
  });

  test('committing again has nothing to do; -m names the subject', async () => {
    const again = ct('commit');
    expect(again.code).toBe(0);
    expect(again.out).toBe('Nothing of CodeTrellis\'s to commit.');
    expect(ct('plan', 'edit', step, '--body', 'Quote every field.').code).toBe(0);
    await filesSay('Quote every field.');
    const named = ct('commit', '-m', 'Plan: header row quoting', '--json');
    expect(named.code, named.err).toBe(0);
    expect(JSON.parse(named.out)).toMatchObject({ committed: true, subject: 'Plan: header row quoting', tasks: ['Write the header row'] });
    expect(git('log', '-1', '--format=%s')).toContain('Plan: header row quoting');
  });

  test('status says what is under way, blocked and waiting on Sam, as the plan does', async () => {
    expect(ct('claim', write).code).toBe(0);
    expect(ct('update', write, '--progress', '40', '--note', 'drafting').code).toBe(0);
    expect(ct('stuck', followUp, 'waiting', 'for', 'the', 'XLSX', 'library').code).toBe(0);
    expect(ct('request', 'Which date format?', '--no-wait').code).toBe(0);

    const r = ct('status', '--json');
    expect(r.code, r.err).toBe(0);
    const s = JSON.parse(r.out) as { plans: Array<{ uid: string; progress: string; inProgress: Array<{ uid: string }>; blocked: Array<{ uid: string; says: string }>; waitingOnPerson: Array<{ question: string }> }> };
    const mine = s.plans.find((pl) => pl.uid === plan)!;
    const viewed = (await (await h.client.raw('GET', `/api/plans/${plan}/status`)).json()) as { progress: { words: string } };
    expect(mine.progress).toBe(viewed.progress.words);
    expect(mine.inProgress.map((w) => w.uid)).toContain(write);
    expect(mine.blocked).toEqual([expect.objectContaining({ uid: followUp })]);
    expect(mine.blocked[0].says).toContain('waiting for the XLSX library');
    expect(mine.waitingOnPerson.map((q) => q.question)).toContain('Which date format?');

    const text = ct('status').out;
    expect(text).toMatch(/^Exports — /);
    expect(text).toContain('▶ Write the export endpoint');
    expect(text).toContain('■ Add the CSV and XLSX export');
    expect(text).toContain('? Which date format?');
  });
});
