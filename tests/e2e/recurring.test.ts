/**
 * Phase 32 C4.1 — recurring playbooks, against a real backend.
 *
 * Sam's team committed "Daily security check" three days ago: the Security
 * review playbook, every day at 00:00 UTC, carrying open tasks over, with
 * the security-review skill. Nobody has run it since, so the series says two
 * days missed and today's run due. Started, today's run is a plan from the
 * playbook; started again, it is the same plan. An agent's list_recurring is
 * the same answer. A playbook made recurring now is kept in the committed
 * config and is not due until its first moment. Bad rules are refused with
 * why; from plain HTTP, making a playbook recur is refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type Phone, type ScriptedAgent } from '../harness';
import type { RecurringSeries } from '../../src/shared/types/recurring';
import { periodLabel, periodOf } from '../../src/shared/lib/recurrence';

const DAY = 86_400_000;
const label = (ms: number) => { const d = new Date(ms); return periodLabel(periodOf('day', { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() })); };

function writeRule(root: string, since: number, playbook = 'security-review') {
  fs.mkdirSync(path.join(root, '.codetrellis'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codetrellis', 'config.json'), JSON.stringify({
    recurring: [{
      id: 'daily-security-check', playbook, title: 'Daily security check', every: 'day', at: '00:00', timeZone: 'UTC',
      carryOver: true, skills: [{ name: 'security-review', source: 'skill', required: false }], since: new Date(since).toISOString(), by: 'Sam Lee',
    }],
  }, null, 2));
}

test.describe.serial('Recurring playbooks', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;
  const now = Date.now();

  const q = () => `?project=${encodeURIComponent(root)}`;
  const series = async () => ((await (await h.client.raw('GET', `/api/recurring?project=${encodeURIComponent(root)}`)).json()) as { series: RecurringSeries[] }).series;

  test.beforeAll(async () => {
    h = await setupHarness('recurring');
    root = h.fixture.projectPath;
    writeRule(root, now - 3 * DAY);
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
    // The team's Security review playbook, published from a plan.
    const source = (await h.client.createPlan({ title: 'Security review', projectPath: root })).uid;
    for (const title of ['Review new dependencies', 'Check secrets in the diff', 'Rotate the staging keys']) {
      await h.client.raw('POST', `/api/plans/${source}/items`, { kind: 'action', title });
    }
    const published = await h.client.raw('POST', `/api/plans/${source}/publish-as-template`, { projectRoot: root, templateId: 'security-review', label: 'Security review' });
    expect(published.ok, await published.clone().text()).toBe(true);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('a rule the team committed: two days missed, today\'s run due, and the next', async () => {
    const [s] = await series();
    expect(s.rule).toMatchObject({ id: 'daily-security-check', title: 'Daily security check', by: 'Sam Lee' });
    expect(s.words).toBe('every day 00:00 · skill: security-review');
    expect(s.runs.map((r) => r.state)).toEqual(['missed', 'missed', 'due', 'next']);
    expect(s.runs.map((r) => r.label)).toEqual([label(now - 2 * DAY), label(now - DAY), label(now), label(now + DAY)]);
    expect(s.runs[2].words).toBe(`${label(now)} due since 00:00`);
    expect(s.due).toMatchObject({ label: label(now), words: 'Daily security check is due since 00:00' });
  });

  test('started, today\'s run is a plan from the playbook with the rule\'s skill; started again, the same plan', async () => {
    // C4.3b — an agent on each run, on this device; from plain HTTP it is not started, and the run says why.
    const on = await h.client.raw('PUT', `/api/recurring/daily-security-check/agent?project=${encodeURIComponent(root)}`, { agent: 'claude' });
    expect(on.status, await on.clone().text()).toBe(200);
    const terminals = async () => ((await (await h.client.raw('GET', '/api/terminals')).json()) as unknown[]).length;
    const before = await terminals();
    const first = await h.client.raw('POST', `/api/recurring/daily-security-check/start?project=${encodeURIComponent(root)}`, {});
    expect(first.status, await first.clone().text()).toBe(200);
    const a = (await first.json()) as { planUid: string; title: string; created: boolean; recurrence: { period: string; previous: string | null } };
    expect(a).toMatchObject({ title: `Daily security check — ${label(now)}`, created: true, recurrence: { previous: null } });
    expect((a as unknown as { agent: unknown }).agent).toEqual({
      agent: 'claude', terminalId: null,
      words: 'Claude Code was not started: the run was started over plain HTTP; only you in the app, the schedule, or a phone allowed to open terminals start one',
    });
    expect(await terminals()).toBe(before);

    const again = (await (await h.client.raw('POST', `/api/recurring/daily-security-check/start?project=${encodeURIComponent(root)}`, {})).json()) as { planUid: string; created: boolean };
    expect(again).toEqual({ ...again, planUid: a.planUid, created: false, agent: null });

    const plans = (await (await h.client.raw('GET', `/api/plans?project=${encodeURIComponent(root)}`)).json()) as Array<{ uid: string; title: string }>;
    expect(plans.filter((p) => p.title.startsWith('Daily security check')).map((p) => p.uid)).toEqual([a.planUid]);
    const items = (await (await h.client.raw('GET', `/api/plans/${a.planUid}/items`)).json()) as Array<{ uid: string; kind: string; title: string }>;
    const actions = items.filter((i) => i.kind === 'action');
    expect(actions.map((i) => i.title)).toEqual(['Review new dependencies', 'Check secrets in the diff', 'Rotate the staging keys']);
    for (const i of actions) {
      const full = (await (await h.client.raw('GET', `/api/items/${i.uid}`)).json()) as { skills?: Array<{ name: string }> };
      expect((full.skills ?? []).map((sk) => sk.name)).toEqual(['security-review']);
    }

    const [s] = await series();
    expect(s.runs.map((r) => r.state)).toEqual(['missed', 'missed', 'in_progress', 'next']);
    expect(s.runs[2].planUid).toBe(a.planUid);
    expect(s.due).toBeNull();

    // C4.2b — the run says which series and period it is, and who started it (here, over plain HTTP).
    const rec = (await (await h.client.raw('GET', `/api/plans/${a.planUid}/recurrence`)).json()) as { recurrence: { line: string; words: string } };
    expect(rec.recurrence.line).toMatch(new RegExp(`^Daily security check · ${label(now)} run · started by .+$`));
    expect(rec.recurrence.words).toBe('every day 00:00 · skill: security-review');
    const other = (await h.client.createPlan({ title: 'Not a run', projectPath: root })).uid;
    expect(((await (await h.client.raw('GET', `/api/plans/${other}/recurrence`)).json()) as { recurrence: unknown }).recurrence).toBeNull();
    expect((await h.client.raw('GET', '/api/plans/no-such-plan/recurrence')).status).toBe(404);
  });

  test('an agent\'s list_recurring is the same answer', async () => {
    const r = await agent.callTool('list_recurring', { project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    expect(JSON.parse(r.answer)).toEqual({ series: await series() });
  });

  test('made recurring now, it is kept in the committed config and not due until its first moment', async () => {
    const put = await h.client.raw('PUT', `/api/recurring/monthly-access-review${q()}`, {
      playbook: 'security-review', title: 'Monthly access review', every: 'month', on: 1, at: '09:00', timeZone: 'Europe/London', carryOver: false,
    });
    expect(put.status, await put.clone().text()).toBe(200);
    const config = JSON.parse(fs.readFileSync(path.join(root, '.codetrellis', 'config.json'), 'utf8')) as { recurring: Array<{ id: string; since: string }> };
    expect(config.recurring.map((r) => r.id)).toEqual(['daily-security-check', 'monthly-access-review']);
    expect(Math.abs(Date.parse(config.recurring[1].since) - Date.now())).toBeLessThan(60_000);

    const s = (await series()).find((x) => x.rule.id === 'monthly-access-review')!;
    expect(s.words).toBe('every month on the 1st, 09:00');
    expect(s.runs.map((r) => r.state)).toEqual(['next']);
    const start = await h.client.raw('POST', `/api/recurring/monthly-access-review/start?project=${encodeURIComponent(root)}`, {});
    expect(start.status).toBe(409);
    expect(((await start.json()) as { error: string }).error).toMatch(/^Monthly access review is not due yet: the first run is \w{3} 1 \w{3} 09:00$/);

    expect((await h.client.raw('DELETE', `/api/recurring/monthly-access-review${q()}`)).status).toBe(200);
    expect((await series()).map((x) => x.rule.id)).toEqual(['daily-security-check']);
  });

  test('a bad rule, a playbook the project does not have, and an unknown series are refused with why', async () => {
    const bad = await h.client.raw('PUT', `/api/recurring/weekly${q()}`, { playbook: 'security-review', title: 'Weekly', every: 'fortnight', at: '9am', timeZone: 'UTC' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('every must be day, week or month; at must be a time, HH:MM');
    const unknown = await h.client.raw('PUT', `/api/recurring/weekly${q()}`, { playbook: 'no-such-playbook', title: 'Weekly', every: 'week', on: 1, at: '09:00', timeZone: 'UTC' });
    expect(((await unknown.json()) as { error: string }).error).toBe('No playbook "no-such-playbook" in this project');
    expect((await h.client.raw('POST', `/api/recurring/nope/start?project=${encodeURIComponent(root)}`, {})).status).toBe(404);
    expect((await h.client.raw('DELETE', `/api/recurring/nope${q()}`)).status).toBe(404);
    // C4.3b — an agent the app does not know, and a series the project does not have.
    const agent = await h.client.raw('PUT', `/api/recurring/daily-security-check/agent${q()}`, { agent: 'aider' });
    expect(agent.status).toBe(400);
    expect(((await agent.json()) as { error: string }).error).toBe('agent must be claude, codex or null');
    expect((await h.client.raw('PUT', `/api/recurring/nope/agent${q()}`, { agent: 'codex' })).status).toBe(404);
    const off = await h.client.raw('PUT', `/api/recurring/daily-security-check/agent${q()}`, { agent: null });
    expect(((await off.json()) as { series: RecurringSeries }).series.agent).toBeNull();
    expect((await h.client.raw('GET', `/api/recurring?project=${encodeURIComponent('/tmp/never-opened')}`)).ok).toBe(false);
  });
});

test.describe.serial('Only the person makes a playbook recur', () => {
  test.setTimeout(90_000);
  let h: Harness;

  test.beforeAll(async () => {
    h = await setupHarness('recurring-grant', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
    writeRule(h.fixture.projectPath, Date.now() - 3 * 86_400_000);
    await h.client.scanProject(h.fixture.projectPath);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('from plain HTTP, setting and removing a rule, and an agent on each run, are refused with where to do it; reading is not', async () => {
    const root = encodeURIComponent(h.fixture.projectPath);
    const set = await h.client.raw('PUT', `/api/recurring/weekly?project=${root}`, { playbook: 'bug-fix', title: 'Weekly', every: 'week', on: 1, at: '09:00', timeZone: 'UTC' });
    expect(set.status).toBe(403);
    expect(((await set.json()) as { error: string }).error).toBe('Only you can make a playbook recur — in the CodeTrellis app, Settings → Recurring playbooks.');
    const removed = await h.client.raw('DELETE', `/api/recurring/daily-security-check?project=${root}`);
    expect(removed.status).toBe(403);
    expect(((await removed.json()) as { error: string }).error).toBe('Only you can stop a playbook recurring — in the CodeTrellis app, Settings → Recurring playbooks.');
    expect((await h.client.raw('GET', `/api/recurring?project=${root}`)).status).toBe(200);
    // C4.3b — nor having an agent start on each run: it opens a terminal on this computer.
    const agent = await h.client.raw('PUT', `/api/recurring/daily-security-check/agent?project=${root}`, { agent: 'claude' });
    expect(agent.status).toBe(403);
    expect(((await agent.json()) as { error: string }).error).toBe('Only you can have an agent start on each run — in the CodeTrellis app, Settings → Recurring playbooks.');
  });
});

/**
 * C4.2a — a run that fell due while the app was closed. The app starts a run
 * only as its moment comes while it runs; one due before it opened is asked
 * about. "Not this time" leaves it, on this device, until its period ends;
 * the person can still start it, and once started there is nothing to leave.
 */
test.describe.serial('A run due while the app was closed', () => {
  test.setTimeout(90_000);
  let h: Harness;
  let root: string;
  const series = async () => ((await (await h.client.raw('GET', `/api/recurring?project=${encodeURIComponent(root)}`)).json()) as { series: RecurringSeries[] }).series;

  test.beforeAll(async () => {
    h = await setupHarness('recurring-due');
    root = h.fixture.projectPath;
    writeRule(root, Date.now() - 3 * DAY, 'bug-fix');
    await h.client.scanProject(root);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('it is asked about, not started; "Not this time" leaves it here; started anyway, there is nothing to leave', async () => {
    const [before] = await series();
    expect(before.rule.playbook).toBe('bug-fix');
    expect(before.due).toMatchObject({ label: label(Date.now()), words: 'Daily security check is due since 00:00', dismissed: false });

    const left = await h.client.raw('POST', `/api/recurring/daily-security-check/dismiss?project=${encodeURIComponent(root)}`, {});
    expect(left.status, await left.clone().text()).toBe(200);
    expect(await left.json()).toEqual({ period: before.due!.period, label: before.due!.label });
    const [after] = await series();
    expect(after.due!.dismissed).toBe(true);
    expect(after.runs.at(-2)!.state).toBe('due');

    const started = await h.client.raw('POST', `/api/recurring/daily-security-check/start?project=${encodeURIComponent(root)}`, {});
    expect(((await started.json()) as { created: boolean }).created).toBe(true);
    const nothing = await h.client.raw('POST', `/api/recurring/daily-security-check/dismiss?project=${encodeURIComponent(root)}`, {});
    expect(nothing.status).toBe(409);
    expect(((await nothing.json()) as { error: string }).error).toBe('Daily security check has no run due now');
    expect((await h.client.raw('POST', `/api/recurring/nope/dismiss?project=${encodeURIComponent(root)}`, {})).status).toBe(404);
  });
});

/**
 * C4.3a — from the phone. Away from the desk, the person sees the series as
 * the window does and starts the run due now; it is theirs, and starting it
 * again (or after a teammate) is the same run. A phone allowed only to read
 * sees the series and cannot start one.
 */
test.describe.serial('Recurring runs from the phone', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let phone: Phone;
  const series = async () => ((await (await h.client.raw('GET', `/api/recurring?project=${encodeURIComponent(root)}`)).json()) as { series: RecurringSeries[] }).series;

  test.beforeAll(async () => {
    h = await setupHarness('recurring-phone');
    root = h.fixture.projectPath;
    writeRule(root, Date.now() - 3 * DAY, 'bug-fix');
    await h.client.scanProject(root);
    phone = await pairPhone(h.client, { alias: 'Sam\'s phone' });
  });
  test.afterAll(async () => { await phone?.close?.(); await h?.teardown(); });

  test('the phone lists the series as the window does, and starts the due run as the person; twice is one run', async () => {
    expect(await phone.rpc('recurring.list', { projectPath: root })).toEqual({ series: await series() });

    const run = (await phone.rpc('recurring.start', { projectPath: root, ruleId: 'daily-security-check' })) as {
      planUid: string; title: string; created: boolean; recurrence: { startedBy: string }; series: RecurringSeries[];
    };
    expect(run).toMatchObject({ title: `Daily security check — ${label(Date.now())}`, created: true });
    expect(run.series).toEqual(await series());
    expect(run.series[0].runs.at(-2)).toMatchObject({ state: 'in_progress', planUid: run.planUid });
    const plan = (await (await h.client.raw('GET', `/api/plans/${run.planUid}`)).json()) as { author: string; authorType: string };
    expect(plan.authorType).toBe('human');
    expect(run.recurrence.startedBy).toBe(plan.author);

    const again = (await phone.rpc('recurring.start', { projectPath: root, ruleId: 'daily-security-check' })) as { planUid: string; created: boolean };
    expect(again).toMatchObject({ planUid: run.planUid, created: false });
    const viaWindow = (await (await h.client.raw('POST', `/api/recurring/daily-security-check/start?project=${encodeURIComponent(root)}`, {})).json()) as { planUid: string; created: boolean };
    expect(viaWindow).toMatchObject({ planUid: run.planUid, created: false });
  });

  test('an unknown series and a project never opened are refused with why', async () => {
    expect(await phone.rpcError('recurring.start', { projectPath: root, ruleId: 'nope' })).toMatch(/nope/);
    expect(await phone.rpcError('recurring.list', { projectPath: '/tmp/never-opened' })).toBeTruthy();
  });

  test('a phone allowed only to read sees the series and cannot start a run', async () => {
    await phone.grant(['read']);
    expect(((await phone.rpc('recurring.list', { projectPath: root })) as { series: unknown[] }).series).toHaveLength(1);
    expect(await phone.rpcError('recurring.start', { projectPath: root, ruleId: 'daily-security-check' })).toMatch(/write/);
  });
});
