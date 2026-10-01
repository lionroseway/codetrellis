/**
 * Phase 32 C3.1 — task state shared as records in the project's files.
 *
 * Dana and Sam work on "Q4 board pack" from their own machines; git carries
 * the repository between them. A plan's files hold its intent, not its state
 * (C2.4b), so until they turn sharing on, Sam's progress stays on Sam's
 * machine. Turned on, each change to a task's state is written as one new
 * record, never edited, and each pulls the other's: Sam's "in progress, 40%"
 * reaches Dana as his, in his record, unverified. Dana's "done", made having
 * seen Sam's, reaches Sam. Reading the same records again changes nothing; a
 * sync's conflicted copy is one more copy of a record, and a record in the
 * wrong task's folder is not read. Two people acting at once leaves each
 * with their own state: nothing is picked, and (C3.2) both are named on the
 * task, in what it waits on, in get_plan and in the inbox, until one keeps
 * theirs and the split ends on both machines. A second record forged in
 * Sam's name and number is named as such. Off, nothing is written. And only
 * the person turns it on: from plain HTTP it is refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface Shared { enabled: boolean; writer: string; name: string; records: number; writers: number; says: string; changedBy: string | null }
interface Item { uid: string; status: string; progressPercent: number | null; blockedReason: string | null; updatedAt: number }
interface Status { items: Array<{ itemUid: string; words: string; recorded: { by: string; byType: string } | null; atOnce?: { words: string } }> }
interface Signal { id: string; kind: string; severity: string; state: string; workstreams: string[]; summary: string; subject: Record<string, unknown> }

test.describe.serial('Task state shared as records', () => {
  test.setTimeout(180_000);
  let dana: Harness;
  let sam: Harness;
  let danaRepo: string;
  let samRepo: string;
  let plan: string;
  let write: string;
  let check: string;
  const git = (repo: string, ...args: string[]) => String(execFileSync('git', ['-C', repo, ...args], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  const shared = async (h: Harness, repo: string) => (await (await h.client.raw('GET', `/api/shared-task-state?project=${encodeURIComponent(repo)}`)).json()) as Shared;
  const turn = (h: Harness, repo: string, enabled: boolean) => h.client.raw('PUT', `/api/shared-task-state?project=${encodeURIComponent(repo)}`, { enabled });
  const item = async (h: Harness, uid: string) => (await (await h.client.raw('GET', `/api/items/${uid}`)).json()) as Item;
  const set = async (h: Harness, uid: string, body: Record<string, unknown>) => {
    const res = await h.client.raw('PUT', `/api/items/${uid}`, body);
    expect(res.ok, await res.clone().text()).toBe(true);
  };
  const signals = async (h: Harness, repo: string) => ((await (await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(repo)}`)).json()) as { signals: Signal[] }).signals;
  const statusOf = async (h: Harness, uid: string) => ((await (await h.client.raw('GET', `/api/plans/${plan}/status`)).json()) as Status).items.find((i) => i.itemUid === uid)!;
  const recordsIn = (repo: string, itemUid: string) => {
    const dir = path.join(repo, '.codetrellis', 'records', plan, itemUid);
    return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  };
  /** Commit what is new in one checkout and pull it into the other: what a team does with git. */
  const carry = (from: string, to: string, message: string) => {
    git(from, 'add', '-A', '.codetrellis');
    try { git(from, 'commit', '-q', '-m', message); } catch { /* nothing new */ }
    git(to, 'pull', '-q', '--no-rebase', '--no-edit', from, git(from, 'rev-parse', '--abbrev-ref', 'HEAD'));
  };

  test.beforeAll(async () => {
    dana = await setupHarness('task-records-dana', { settings: { identity: { displayName: 'Dana Ortiz', email: 'dana@acme.test' } } });
    sam = await setupHarness('task-records-sam', { settings: { identity: { displayName: 'Sam Lee', email: 'sam@acme.test' } } });
    danaRepo = dana.fixture.projectPath;
    await dana.client.scanProject(danaRepo);

    plan = (await dana.client.createPlan({ title: 'Q4 board pack', projectPath: danaRepo })).uid;
    const post = async (body: unknown) => ((await (await dana.client.raw('POST', `/api/plans/${plan}/items`, body)).json()) as { uid: string }).uid;
    write = await post({ kind: 'action', title: 'Write the board report' });
    check = await post({ kind: 'action', title: 'Check the figures' });
    const planDir = (await dana.client.exportPlan(plan, danaRepo)).planDir;
    git(danaRepo, 'add', '-A', '.codetrellis');
    git(danaRepo, 'commit', '-q', '-m', 'plan: Q4 board pack');

    samRepo = path.join(sam.fixture.tmpDir, 'board-pack');
    execFileSync('git', ['clone', '-q', danaRepo, samRepo], { env: ENV, stdio: 'ignore' });
    await sam.client.scanProject(samRepo);
    const imported = await sam.client.raw('POST', '/api/plans/import', { planDir: path.join(samRepo, path.relative(danaRepo, planDir)) });
    expect(imported.ok, await imported.clone().text()).toBe(true);
  });

  test.afterAll(async () => {
    await dana?.teardown();
    await sam?.teardown();
  });

  test('off by default: a state change writes nothing, and Settings says what stays where', async () => {
    const s = await shared(sam, samRepo);
    expect(s).toMatchObject({ enabled: false, name: 'Sam Lee', records: 0 });
    expect(s.says).toBe('Off. Task state stays on this device; teammates who pull see the plan, not who is doing what.');
    await set(sam, write, { status: 'in_progress' });
    expect(recordsIn(samRepo, write)).toEqual([]);
    expect(git(samRepo, 'status', '--porcelain', '--untracked-files=all')).toBe('');
  });

  test('turned on, Sam\'s change is one new record in the project\'s files, naming him', async () => {
    for (const [h, repo] of [[dana, danaRepo], [sam, samRepo]] as const) {
      const on = await turn(h, repo, true);
      expect(on.status, await on.clone().text()).toBe(200);
    }
    const s = await shared(sam, samRepo);
    expect(s.says).toBe('On: each change to a task\'s state here is written to .codetrellis/records as Sam Lee, and teammates\' records are read.');

    await set(sam, write, { progressPercent: 40 });
    expect(recordsIn(samRepo, write)).toEqual([`${s.writer}-1.yaml`]);
    const text = fs.readFileSync(path.join(samRepo, '.codetrellis', 'records', plan, write, `${s.writer}-1.yaml`), 'utf8');
    expect(text).toMatch(/^# CodeTrellis task state, written once by one device and never edited\./);
    expect(text).toContain('name: Sam Lee');
    expect(text).toContain('status: in_progress');
    expect(text).toContain('progressPercent: 40');
    // The only change in his checkout is the new record.
    expect(git(samRepo, 'status', '--porcelain', '--untracked-files=all')).toBe(`?? .codetrellis/records/${plan}/${write}/${s.writer}-1.yaml`);
  });

  test('after a pull, Dana sees it as Sam\'s, in his record, unverified', async () => {
    carry(samRepo, danaRepo, 'state: board report');
    await expect.poll(async () => (await item(dana, write)).progressPercent, { timeout: 15_000 }).toBe(40);
    expect((await item(dana, write)).status).toBe('in_progress');
    const line = await statusOf(dana, write);
    expect(line.recorded).toMatchObject({ by: 'Sam Lee', byType: 'record' });
    expect(line.words).toBe('in progress, 40%');
  });

  test('Dana\'s "done", made having seen Sam\'s, reaches Sam as hers', async () => {
    await set(dana, write, { status: 'done' });
    const d = await shared(dana, danaRepo);
    const mine = fs.readFileSync(path.join(danaRepo, '.codetrellis', 'records', plan, write, `${d.writer}-1.yaml`), 'utf8');
    expect(mine).toContain(`${(await shared(sam, samRepo)).writer}: 1`); // seen: Sam's first record
    carry(danaRepo, samRepo, 'state: board report done');
    await expect.poll(async () => (await item(sam, write)).status, { timeout: 15_000 }).toBe('done');
    expect((await statusOf(sam, write)).recorded).toMatchObject({ by: 'Dana Ortiz', byType: 'record' });
  });

  test('reading the same records again changes nothing', async () => {
    const before = await item(sam, write);
    const dir = path.join(samRepo, '.codetrellis', 'plans', fs.readdirSync(path.join(samRepo, '.codetrellis', 'plans'))[0]);
    expect((await sam.client.raw('POST', '/api/plans/import', { planDir: dir })).ok).toBe(true);
    expect((await item(sam, write)).updatedAt).toBe(before.updatedAt);
  });

  test('a sync\'s conflicted copy is one more copy; a record in the wrong task\'s folder is not read', async () => {
    const d = await shared(dana, danaRepo);
    const folder = path.join(samRepo, '.codetrellis', 'records', plan, write);
    fs.copyFileSync(path.join(folder, `${d.writer}-1.yaml`), path.join(folder, `${d.writer}-1 (Sam Lee's conflicted copy 2026-10-01).yaml`));
    const wrong = path.join(samRepo, '.codetrellis', 'records', plan, check);
    fs.mkdirSync(wrong, { recursive: true });
    fs.copyFileSync(path.join(folder, `${d.writer}-1.yaml`), path.join(wrong, `${d.writer}-1.yaml`));
    const before = await item(sam, write);
    await new Promise((r) => setTimeout(r, 1_000)); // the watcher has seen both
    expect(await item(sam, write)).toMatchObject({ status: 'done', updatedAt: before.updatedAt });
    expect((await item(sam, check)).status).toBe('pending');
    fs.rmSync(wrong, { recursive: true });
    fs.rmSync(path.join(folder, `${d.writer}-1 (Sam Lee's conflicted copy 2026-10-01).yaml`));
  });

  test('two people acting at once each keep their own state: nothing is picked between them', async () => {
    await set(dana, check, { status: 'blocked', blockedReason: 'waits on the ledger' });
    await set(sam, check, { status: 'in_progress' });
    carry(samRepo, danaRepo, 'state: sam checks');
    carry(danaRepo, samRepo, 'state: dana blocked');
    await new Promise((r) => setTimeout(r, 1_000));
    expect((await item(dana, check)).status).toBe('blocked');
    expect((await item(sam, check)).status).toBe('in_progress');
    // Two files, one each: git merged nothing.
    expect(recordsIn(samRepo, check)).toHaveLength(2);
  });

  test('C3.2: both are named on the task, it waits on them, and it is a signal in the inbox', async () => {
    await expect.poll(async () => (await statusOf(dana, check)).atOnce?.words, { timeout: 15_000 })
      .toBe('set two ways at once: Sam Lee says in progress, Dana Ortiz says blocked');
    const plan_ = (await (await dana.client.raw('GET', `/api/plans/${plan}/status`)).json()) as Status & { waiting: Array<{ itemUid: string; words: string }> };
    expect(plan_.waiting.find((w) => w.itemUid === check)?.words).toBe('blocked: waits on the ledger; set two ways at once: Sam Lee says in progress, Dana Ortiz says blocked');
    for (const [h, repo] of [[dana, danaRepo], [sam, samRepo]] as const) {
      const sigs = await signals(h, repo);
      expect(sigs.filter((x) => x.kind === 'state-split')).toEqual([expect.objectContaining({
        severity: 'medium', state: 'open', workstreams: [`task:${check}`],
        summary: '“Check the figures”: set two ways at once: Sam Lee says in progress, Dana Ortiz says blocked.',
        subject: expect.objectContaining({ said: [{ name: 'Sam Lee', status: 'in_progress' }, { name: 'Dana Ortiz', status: 'blocked' }] }),
      })]);
    }
    // Dana's phone shows it in the same words: who set it to what.
    const phone = await pairPhone(dana.client, { alias: 'Dana’s phone' });
    try {
      const id = (await signals(dana, danaRepo)).find((x) => x.kind === 'state-split')!.id;
      const { signal } = await phone.rpc<{ signal: { heading: string; sideWords: Array<{ name: string; words: string }> } }>('awareness.signal', { id });
      expect(signal.heading).toBe('Set two ways at once');
      expect(signal.sideWords.map((w) => w.words)).toEqual([
        'Sam Lee set “Check the figures” to in progress, without having seen the other change.',
        'Dana Ortiz set “Check the figures” to blocked, without having seen the other change.',
      ]);
      const onPhone = await phone.rpc<{ waiting: Array<{ itemUid: string; words: string }> }>('plan.status', { planUid: plan });
      expect(onPhone.waiting.find((w) => w.itemUid === check)?.words).toMatch(/set two ways at once/);
    } finally {
      await phone.close().catch(() => {});
    }
    // An agent asking for the plan hears the same.
    const agent = await dana.spawnAgent({ agentType: 'codex' });
    const got = JSON.parse((await agent.callTool('get_plan', { plan_uid: plan })).text) as { state: { items: Array<{ item_uid: string; set_at_once?: string; recorded_in?: string }> } };
    expect(got.state.items.find((i) => i.item_uid === check)?.set_at_once).toBe('set two ways at once: Sam Lee says in progress, Dana Ortiz says blocked');
    // On Sam's machine the report's "done" is Dana's, from her record, and an agent hears that too.
    const samsAgent = await sam.spawnAgent({ agentType: 'claude-code' });
    const sams = JSON.parse((await samsAgent.callTool('get_plan', { plan_uid: plan })).text) as typeof got;
    expect(sams.state.items.find((i) => i.item_uid === write)?.recorded_in).toBe("the teammate's record, unverified");
  });

  test('C3.2: Dana keeps hers; the split ends here, and once it reaches Sam, there', async () => {
    expect((await sam.client.raw('POST', `/api/items/${write}/keep-state`)).status).toBe(409);
    const kept = await dana.client.raw('POST', `/api/items/${check}/keep-state`);
    expect(kept.status, await kept.clone().text()).toBe(200);
    expect((await statusOf(dana, check)).atOnce).toBeUndefined();
    expect((await signals(dana, danaRepo)).filter((x) => x.kind === 'state-split')).toEqual([]);
    carry(danaRepo, samRepo, 'state: dana keeps blocked');
    await expect.poll(async () => (await item(sam, check)).status, { timeout: 15_000 }).toBe('blocked');
    expect((await item(sam, check)).blockedReason).toBe('waits on the ledger');
    expect((await statusOf(sam, check)).atOnce).toBeUndefined();
    expect((await signals(sam, samRepo)).filter((x) => x.kind === 'state-split')).toEqual([]);
  });

  test('C3.2: a second, different record in Sam\'s name and number is named as such, and neither is taken', async () => {
    const s_ = await shared(sam, samRepo);
    const folder = path.join(danaRepo, '.codetrellis', 'records', plan, write);
    const real = fs.readdirSync(folder).find((f) => f.startsWith(`${s_.writer}-1`))!;
    const forged = fs.readFileSync(path.join(folder, real), 'utf8').replace('status: in_progress', 'status: skipped');
    fs.writeFileSync(path.join(folder, `${s_.writer}-1 (copy).yaml`), forged);
    await expect.poll(async () => (await statusOf(dana, write)).atOnce?.words, { timeout: 15_000 })
      .toBe('two different records claim to be the same change by Sam Lee; neither is taken');
    const sig = (await signals(dana, danaRepo)).find((x) => x.kind === 'state-split');
    expect(sig).toMatchObject({ severity: 'high', workstreams: [`task:${write}`] });
    fs.rmSync(path.join(folder, `${s_.writer}-1 (copy).yaml`));
  });

  test('turned off, a change writes nothing more', async () => {
    const off = await turn(sam, samRepo, false);
    expect(off.status).toBe(200);
    const before = recordsIn(samRepo, write);
    await set(sam, write, { status: 'in_progress' });
    expect(recordsIn(samRepo, write)).toEqual(before);
  });
});

test.describe.serial('Only the person shares task state', () => {
  test.setTimeout(90_000);
  let h: Harness;

  test.beforeAll(async () => {
    h = await setupHarness('task-records-grant', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
    await h.client.scanProject(h.fixture.projectPath);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('from plain HTTP, turning it on is refused with where to do it; turning it off is not', async () => {
    const root = encodeURIComponent(h.fixture.projectPath);
    const on = await h.client.raw('PUT', `/api/shared-task-state?project=${root}`, { enabled: true });
    expect(on.status).toBe(403);
    expect((await on.json()).error).toBe("Only you can share task state through the project's files — in the CodeTrellis app, Settings → Shared task state.");
    const off = await h.client.raw('PUT', `/api/shared-task-state?project=${root}`, { enabled: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as Shared).changedBy).toMatch(/\(unverified\)$/);
    expect((await h.client.raw('PUT', `/api/shared-task-state?project=${root}`, { enabled: 'yes' })).status).toBe(400);
  });
});
