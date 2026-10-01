/**
 * Phase 32 D1.2 — the keep-on-track verbs, as an agent with no hook and no
 * MCP config of its own: it only runs `codetrellis`.
 *
 * Sam's agent works "Exports". `codetrellis next` names the task to pick up;
 * it claims it, reports 40% with a note, and checks a file before editing it:
 * clear, then held once Sam sets a breakpoint there. It asks Sam which
 * currency to use and waits; Sam answers in the app and the answer comes
 * back. Another task is blocked, with why. `done` is refused while a
 * criterion's check fails, and goes through once there is none failing. It
 * reports its JUnit file, reads its brief and its awareness. Every call is
 * the agent's: the Timeline names claude-code. Pointed at no running backend,
 * it says how to start one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const FILE = 'packages/shared/src/validators.ts';

test.describe.serial('codetrellis verbs', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let plan: string;
  let write: string;
  let totals: string;

  const env = () => ({ ...(process.env as Record<string, string>), CLAUDECODE: '1', CODETRELLIS_AGENT: '' });
  const ct = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args, '--data-dir', h.fixture.dataDir], { cwd: root, env: env(), encoding: 'utf8', timeout: 90_000 });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const item = async (uid: string) => (await (await h.client.raw('GET', `/api/items/${uid}`)).json()) as { status: string; progressPercent: number | null; blockedReason: string | null; assignee: string | null };

  test.beforeAll(async () => {
    h = await setupHarness('cli-verbs');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    plan = (await h.client.createPlan({ title: 'Exports', projectPath: root })).uid;
    const post = async (title: string) => ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title })).json()) as { uid: string }).uid;
    write = await post('Write the export endpoint');
    totals = await post('Check the totals');
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('next names the task to pick up; claim takes it, as the agent', async () => {
    const next = ct('next');
    expect(next.code, next.err).toBe(0);
    expect(next.out).toContain('Write the export endpoint');
    const claimed = ct('claim', write.slice(0, 8));
    expect(claimed.code, claimed.err).toBe(0);
    expect((await item(write)).status).toMatch(/assigned|in_progress/);
    // As JSON, what the tool said.
    expect(JSON.parse(ct('next', '--json').out)).toBeTruthy();
  });

  test('update reports progress with a note; a bad percentage is a usage error', async () => {
    const r = ct('update', `task ${write.slice(0, 8)}`, '--progress', '40', '--note', 'drafting the CSV writer');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe('40%: drafting the CSV writer');
    expect((await item(write)).progressPercent).toBe(40);
    const bad = ct('update', write, '--progress', '140');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('--progress takes a whole number from 0 to 100');
  });

  test('check before an edit: clear, then held once a breakpoint is set there', async () => {
    const clear = ct('check', FILE);
    expect(clear.code, clear.err).toBe(0);
    expect(clear.out).toContain(`${FILE}: no breakpoint holds it.`);
    expect((await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: FILE, note: 'Validation is frozen this week' })).status).toBe(201);
    const held = ct('check', FILE);
    expect(held.code).toBe(3);
    expect(held.out).toContain('Validation is frozen this week');
  });

  test('stuck blocks a task and says why', async () => {
    const r = ct('stuck', totals, 'waiting', 'on', 'the', 'ledger', 'export');
    expect(r.code, r.err).toBe(0);
    const t = await item(totals);
    expect(t.status).toBe('blocked');
    expect(t.blockedReason).toBe('waiting on the ledger export');
  });

  test('request asks Sam and waits; his answer in the app comes back', async () => {
    const child = spawn(process.execPath, [BIN, 'request', 'Which currency should totals use?', '--options', 'EUR,USD', '--timeout', '60', '--data-dir', h.fixture.dataDir], { cwd: root, env: env() });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    const done = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
    // The question arrives on the plan as a decision for Sam.
    let question: { uid: string; options?: string[] } | undefined;
    await expect.poll(async () => {
      const list = (await (await h.client.raw('GET', `/api/plans/${plan}/channels`)).json()) as Array<{ uid: string; eventType: string; payload: { message: string; options?: string[] } }> | { events: Array<{ uid: string; eventType: string; payload: { message: string } }> };
      const events = Array.isArray(list) ? list : list.events;
      const e = events.find((x) => x.eventType === 'need-decision' && x.payload.message === 'Which currency should totals use?');
      question = e ? { uid: e.uid } : undefined;
      return !!e;
    }, { timeout: 30_000 }).toBe(true);
    expect((await h.client.raw('POST', `/api/plans/${plan}/channels`, { event_type: 'steer', message: 'EUR, rounded to cents', responds_to: question!.uid })).ok).toBe(true);
    expect(await done).toBe(0);
    expect(out.trim()).toMatch(/: EUR, rounded to cents$/);
  });

  test('request --no-wait asks and returns; with nobody answering in time it exits 3', async () => {
    const asked = ct('request', 'Is the ledger export ready?', '--no-wait');
    expect(asked.code, asked.err).toBe(0);
    expect(asked.out).toMatch(/^Asked \(.+\)\. Not waiting for the answer\.$/);
    const waited = ct('request', 'Anyone there?', '--timeout', '1');
    expect(waited.code).toBe(3);
    expect(waited.out).toContain('it stays open on the plan');
  });

  test('done is refused while a criterion\'s check fails, and goes through once none fails', async () => {
    const c = await h.client.raw('POST', `/api/items/${write}/criteria`, { text: 'The export file is written', kind: 'artefact' });
    expect(c.status).toBe(201);
    const crit = (await c.json()) as { uid: string };
    const check = (await (await h.client.raw('POST', `/api/criteria/${crit.uid}/check`, {})).json()) as { ok: boolean; findings: unknown[] };
    expect(check.ok, JSON.stringify(check)).toBe(false);
    const refused = ct('done', write);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('Not marked done: a criterion\'s check fails.');
    expect(refused.out).toContain('✗ The export file is written');
    expect((await item(write)).status).not.toBe('done');
    // A task with no failing check is marked done.
    const r = ct('done', totals);
    expect(r.code, r.err + r.out).toBe(0);
    expect((await item(totals)).status).toBe('done');
  });

  test('report-tests, brief and awareness answer as the tools do', async () => {
    fs.writeFileSync(path.join(root, 'junit.xml'), '<testsuites><testsuite name="exports" tests="2" failures="0"><testcase classname="exports" name="writes csv"/><testcase classname="exports" name="totals"/></testsuite></testsuites>');
    const rep = ct('report-tests', 'junit.xml');
    expect(rep.code, rep.err + rep.out).toBe(0);
    expect(rep.out).toBe('2 tests, none failing.');
    const brief = ct('brief', write, '--json');
    expect(brief.code, brief.err).toBe(0);
    expect(JSON.stringify(JSON.parse(brief.out))).toContain('Write the export endpoint');
    expect(ct('awareness').code).toBe(0);
  });

  test('every call was the agent\'s: the Timeline names claude-code', async () => {
    const { events } = (await (await h.client.raw('GET', '/api/agent-events?limit=200')).json()) as { events: Array<Record<string, unknown>> };
    const text = JSON.stringify(events);
    for (const tool of ['get_next_item', 'claim_item', 'update_item_progress', 'set_item_blocked', 'check_breakpoint', 'post_channel_event']) expect(text).toContain(tool);
    expect(text).toContain('claude-code');
  });

  test('with no backend running, it says how to start one', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-no-backend-'));
    const r = spawnSync(process.execPath, [BIN, 'next', '--data-dir', empty], { cwd: root, env: env(), encoding: 'utf8', timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('codetrellis serve');
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
