/**
 * Phase 32 C3.5 — teammates' material reads.
 *
 * Alex and Sam share "Q4 board pack" through their team's repository, with
 * task state shared (C3.1). Both tasks work from the sales export. Alex's
 * agent drafts the board report from last week's version; Sam replaces the
 * export and his agent updates the figures from the new one. Each app writes
 * which version each of its tasks read, as a record beside the task-state
 * records, one per version and not per read, and reads its teammate's.
 * So on Sam's machine the two tasks read different versions, and the signal
 * says so naming Alex; after a pull, Alex's says the same naming Sam.
 *
 * Who read it is a claim until the record's signature verifies (C3.3): Alex's
 * reads say "unverified" on Sam's machine until Sam trusts Alex's key, then
 * they say Alex's name alone. The switch is separate and on by default while
 * task state is shared (the owner's choice). Off, nothing is written and the
 * teammate's reads are forgotten, so no signal rests on them; turning it back
 * on is the person's, refused from plain HTTP.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface Reads { enabled: boolean; chosen: boolean; mine: number; teammates: number; people: string[]; says: string; changedBy: string | null }
interface Shared { enabled: boolean; writer: string; signing: { how: string; as: string }; materialReads: Reads }
interface Signal { id: string; kind: string; severity: string; workstreams: string[]; summary: string; subject: Record<string, unknown> }

test.describe.serial('Teammates\' material reads', () => {
  test.setTimeout(180_000);
  let alex: Harness;
  let sam: Harness;
  let alexRepo: string;
  let samRepo: string;
  let plan: string;
  let report: string;
  let figures: string;
  const material: Record<string, string> = {};
  let alexAgent: ScriptedAgent;
  let samAgent: ScriptedAgent;

  const git = (repo: string, ...args: string[]) => String(execFileSync('git', ['-C', repo, ...args], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  const shared = async (h: Harness, repo: string) => (await (await h.client.raw('GET', `/api/shared-task-state?project=${encodeURIComponent(repo)}`)).json()) as Shared;
  const put = (h: Harness, repo: string, body: Record<string, unknown>) => h.client.raw('PUT', `/api/shared-task-state?project=${encodeURIComponent(repo)}`, body);
  const signals = async (h: Harness, repo: string) => ((await (await h.client.raw('GET', `/api/awareness?fresh=1&project=${encodeURIComponent(repo)}`)).json()) as { signals: Signal[] }).signals
    .filter((s) => s.subject.material);
  const readsIn = (repo: string, itemUid: string) => {
    const dir = path.join(repo, '.codetrellis', 'reads', plan, itemUid);
    return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  };
  const carry = (from: string, to: string, message: string) => {
    git(from, 'add', '-A');
    try { git(from, 'commit', '-q', '-m', message); } catch { /* nothing new */ }
    git(to, 'pull', '-q', '--no-rebase', '--no-edit', from, git(from, 'rev-parse', '--abbrev-ref', 'HEAD'));
  };
  const readIt = async (agent: ScriptedAgent, attachment: string) => {
    const r = await agent.callTool('read_material', { attachment_uid: attachment });
    expect(r.isError, r.text).toBeFalsy();
  };

  test.beforeAll(async () => {
    alex = await setupHarness('material-reads-alex', { settings: { identity: { displayName: 'Alex Kim', email: 'alex@acme.test' } } });
    sam = await setupHarness('material-reads-sam', { settings: { identity: { displayName: 'Sam Lee', email: 'sam@acme.test' } } });
    alexRepo = alex.fixture.projectPath;
    await alex.client.scanProject(alexRepo);
    fs.mkdirSync(path.join(alexRepo, 'data'), { recursive: true });
    fs.writeFileSync(path.join(alexRepo, 'data/sales.csv'), 'region,q3\nEMEA,120\n');

    plan = (await alex.client.createPlan({ title: 'Q4 board pack', projectPath: alexRepo })).uid;
    const post = async (body: unknown) => ((await (await alex.client.raw('POST', `/api/plans/${plan}/items`, body)).json()) as { uid: string }).uid;
    report = await post({ kind: 'action', title: 'Draft the board report' });
    figures = await post({ kind: 'action', title: 'Update the sales figures' });
    for (const uid of [report, figures]) {
      const res = await alex.client.raw('POST', `/api/items/${uid}/artefacts`, { path: 'data/sales.csv', role: 'material' });
      expect(res.status, await res.clone().text()).toBe(201);
      material[uid] = ((await res.json()) as { uid: string }).uid;
    }
    const planDir = (await alex.client.exportPlan(plan, alexRepo)).planDir;
    git(alexRepo, 'add', '-A');
    git(alexRepo, 'commit', '-q', '-m', 'plan: Q4 board pack');

    samRepo = path.join(sam.fixture.tmpDir, 'board-pack');
    execFileSync('git', ['clone', '-q', alexRepo, samRepo], { env: ENV, stdio: 'ignore' });
    await sam.client.scanProject(samRepo);
    const imported = await sam.client.raw('POST', '/api/plans/import', { planDir: path.join(samRepo, path.relative(alexRepo, planDir)) });
    expect(imported.ok, await imported.clone().text()).toBe(true);

    alexAgent = await alex.spawnAgent({ agentType: 'claude-code' });
    expect((await alexAgent.callTool('get_brief', { item_uid: report })).isError).toBeFalsy();
    samAgent = await sam.spawnAgent({ agentType: 'claude-code' });
    expect((await samAgent.callTool('get_brief', { item_uid: figures })).isError).toBeFalsy();
  });

  test.afterAll(async () => {
    await alex?.teardown();
    await sam?.teardown();
  });

  test('off with task state, then on by default once task state is shared', async () => {
    const off = (await shared(sam, samRepo)).materialReads;
    expect(off).toMatchObject({ enabled: false, chosen: false, says: 'Shared with task state: turn that on first.' });
    // Read before sharing: nothing is written.
    await readIt(alexAgent, material[report]);
    expect(readsIn(alexRepo, report)).toEqual([]);

    for (const [h, repo] of [[alex, alexRepo], [sam, samRepo]] as const) {
      const on = await put(h, repo, { enabled: true });
      expect(on.status, await on.clone().text()).toBe(200);
    }
    const s = (await shared(alex, alexRepo)).materialReads;
    expect(s).toMatchObject({ enabled: true, chosen: false, mine: 0, teammates: 0 });
    expect(s.says).toBe('On: which version of each material your tasks read is written to .codetrellis/reads, and teammates\' reads are compared with yours.');
  });

  test('Alex\'s agent reads last week\'s export: one record of that version, however often it reads it', async () => {
    const me = (await shared(alex, alexRepo)).writer;
    await readIt(alexAgent, material[report]);
    expect(readsIn(alexRepo, report)).toEqual([`${me}-1.yaml`]);
    await readIt(alexAgent, material[report]);
    expect(readsIn(alexRepo, report)).toEqual([`${me}-1.yaml`]);

    const text = fs.readFileSync(path.join(alexRepo, '.codetrellis', 'reads', plan, report, `${me}-1.yaml`), 'utf8');
    expect(text).toMatch(/^# CodeTrellis: which version of a material a task read/);
    expect(text).toContain('material: data/sales.csv');
    expect(text).toContain('name: Alex Kim');
    expect(text).toContain('author: claude-code');
    expect(text).toMatch(/sha256: [a-f0-9]{64}/);
    expect(text).toMatch(/signature:\n\s+how: device/);
    expect((await shared(alex, alexRepo)).materialReads.mine).toBe(1);
  });

  test('Sam replaces the export and works from it: on his machine the two tasks read different versions, naming Alex', async () => {
    carry(alexRepo, samRepo, 'reads: board report');
    fs.writeFileSync(path.join(samRepo, 'data/sales.csv'), 'region,q3\nEMEA,131\n');
    await readIt(samAgent, material[figures]);

    let found: Signal[] = [];
    await expect.poll(async () => (found = await signals(sam, samRepo)).map((s) => s.kind), { timeout: 15_000 }).toEqual(['version-split']);
    const [s] = found;
    expect(s.workstreams).toEqual([`task:${report}`, `task:${figures}`].sort());
    expect(s.subject.readVersions).toEqual({ [`task:${figures}`]: 'current', [`task:${report}`]: 'earlier' });
    expect(s.summary).toContain('“Draft the board report” (Alex Kim, unverified)');
    expect(s.summary).toContain('read different versions of `data/sales.csv`; “Update the sales figures” has the current one');

    const reads = (await shared(sam, samRepo)).materialReads;
    expect(reads).toMatchObject({ teammates: 1, people: ['Alex Kim'] });
    expect(reads.says).toContain('Reads from Alex Kim are here.');

    // The report's brief on Sam's machine says who read what, and that it is unverified.
    const brief = JSON.parse((await samAgent.callTool('get_brief', { item_uid: report })).answer) as { read_so_far: Array<{ path: string; by: string[] }> };
    expect(brief.read_so_far).toEqual([expect.objectContaining({ path: 'data/sales.csv', by: ['claude-code for Alex Kim (unverified)'] })]);
    // Rebind Sam's agent to its own task.
    expect((await samAgent.callTool('get_brief', { item_uid: figures })).isError).toBeFalsy();
  });

  test('Sam trusts Alex\'s key: the same reads now say Alex\'s name alone', async () => {
    const a = await shared(alex, alexRepo);
    const res = await sam.client.raw('POST', '/api/shared-task-state/keys', { writer: a.writer, fingerprint: a.signing.as, trust: true });
    expect(res.status, await res.clone().text()).toBe(200);
    await expect.poll(async () => (await signals(sam, samRepo))[0]?.summary ?? '', { timeout: 15_000 }).not.toContain('unverified');
    expect((await signals(sam, samRepo))[0].summary).toContain('“Draft the board report” (Alex Kim)');
  });

  test('after a pull, Alex sees the same: his task used last week\'s version, and Sam\'s has the current one', async () => {
    carry(samRepo, alexRepo, 'figures: new export');
    let found: Signal[] = [];
    await expect.poll(async () => (found = await signals(alex, alexRepo)).map((s) => s.kind), { timeout: 20_000 }).toEqual(['version-split']);
    expect(found[0].subject.readVersions).toEqual({ [`task:${figures}`]: 'current', [`task:${report}`]: 'earlier' });
    expect(found[0].summary).toContain('“Update the sales figures” (Sam Lee, unverified)');
    expect(found[0].summary).toContain('“Update the sales figures” has the current one');
  });

  test('Sam turns it off: nothing more is written, and no signal rests on Alex\'s reads', async () => {
    const off = await put(sam, samRepo, { materialReads: false });
    expect(off.status).toBe(200);
    const reads = ((await off.json()) as Shared).materialReads;
    expect(reads).toMatchObject({ enabled: false, chosen: true, teammates: 0 });
    expect(reads.says).toBe('Off: which version of each material your tasks read stays on this device, and teammates\' reads are not used.');
    await expect.poll(async () => (await signals(sam, samRepo)).length, { timeout: 15_000 }).toBe(0);

    const before = readsIn(samRepo, figures);
    fs.writeFileSync(path.join(samRepo, 'data/sales.csv'), 'region,q3\nEMEA,140\n');
    await readIt(samAgent, material[figures]);
    expect(readsIn(samRepo, figures)).toEqual(before);

    // Back on, Alex's reads are read again.
    const on = await put(sam, samRepo, { materialReads: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as Shared).materialReads).toMatchObject({ enabled: true, chosen: true, teammates: 1 });
    expect((await put(sam, samRepo, { materialReads: 'yes' })).status).toBe(400);
  });
});

test.describe('Teammates\' material reads from plain HTTP', () => {
  let h: Harness;
  test.beforeAll(async () => {
    h = await setupHarness('material-reads-grant', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
    await h.client.scanProject(h.fixture.projectPath);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('turning them on is refused with where to do it; turning them off is not', async () => {
    const root = encodeURIComponent(h.fixture.projectPath);
    const on = await h.client.raw('PUT', `/api/shared-task-state?project=${root}`, { materialReads: true });
    expect(on.status).toBe(403);
    expect((await on.json()).error).toBe('Only you can share which versions of materials your tasks read — in the CodeTrellis app, Settings → Shared task state.');
    const off = await h.client.raw('PUT', `/api/shared-task-state?project=${root}`, { materialReads: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as Shared).materialReads.changedBy).toMatch(/\(unverified\)$/);
    expect((await h.client.raw('PUT', `/api/shared-task-state?project=${root}`, {})).status).toBe(400);
  });
});
