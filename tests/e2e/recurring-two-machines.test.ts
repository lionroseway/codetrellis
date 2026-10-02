/**
 * Phase 32 C4.3b — the C4 done-when: one recurring playbook, two machines,
 * one plans folder (shared-work doc C-4, journey C4).
 *
 * Sam's team runs "Weekly security review" every Monday, from a playbook,
 * carrying open tasks over; its plans live in the team's planning
 * repository. Both laptops read the same series from the committed config.
 * On his own laptop Sam has Claude Code start on each run; Dana has not.
 * Sam starts this week's run from his phone (allowed to open terminals): the
 * run is made on his laptop, written to the planning repository, and Claude
 * Code opens there on it. Through the repository Dana's laptop has Sam's run;
 * starting it there finds his (the same id) and opens no agent, so there is
 * one run and one agent. A phone not allowed to open terminals starts a run
 * without its agent, and says why.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type Phone } from '../harness';
import type { RecurringSeries } from '../../src/shared/types/recurring';

const DAY = 86_400_000;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (repo: string, ...args: string[]) => String(execFileSync('git', ['-C', repo, ...args], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })).trim();
const WEEKLY = 'weekly-security-review';
const DAILY = 'daily-dependency-check';

interface Started { planUid: string; title: string; created: boolean; agent: { agent: string; terminalId: string | null; words: string } | null; series: RecurringSeries[] }

test.describe.serial('One recurring playbook, two machines, one plans folder', () => {
  test.setTimeout(240_000);
  let dana: Harness;
  let sam: Harness;
  let danaCode: string;
  let samCode: string;
  let danaPlans: string;
  let samPlans: string;
  let phone: Phone;
  let run: Started;

  const q = (repo: string) => `?project=${encodeURIComponent(repo)}`;
  const series = async (h: Harness, repo: string) => ((await (await h.client.raw('GET', `/api/recurring${q(repo)}`)).json()) as { series: RecurringSeries[] }).series;
  const weekly = async (h: Harness, repo: string) => (await series(h, repo)).find((s) => s.rule.id === WEEKLY)!;
  const marks = (s: RecurringSeries) => s.runs.map((r) => ({ period: r.period, state: r.state, planUid: r.planUid }));

  test.beforeAll(async () => {
    dana = await setupHarness('recurring-dana', { settings: { identity: { displayName: 'Dana Ortiz', email: 'dana@acme.test' } } });
    sam = await setupHarness('recurring-sam', { settings: { identity: { displayName: 'Sam Lee', email: 'sam@acme.test' } } });
    danaCode = dana.fixture.projectPath;

    // The team's planning repository, and Dana's copy of it.
    const bare = path.join(dana.fixture.tmpDir, 'acme-plans.git');
    execFileSync('git', ['init', '-q', '--bare', bare], { env: ENV });
    danaPlans = path.join(dana.fixture.tmpDir, 'work', 'acme-plans');
    execFileSync('git', ['clone', '-q', bare, danaPlans], { env: ENV, stdio: 'ignore' });
    fs.writeFileSync(path.join(danaPlans, 'README.md'), 'Acme plans\n');
    git(danaPlans, 'add', '-A');
    git(danaPlans, 'commit', '-q', '-m', 'start');
    git(danaPlans, 'push', '-q', 'origin', 'HEAD');

    // The committed config: where the plans live, that new plans are shared,
    // and the two recurring playbooks, set three weeks ago.
    const since = new Date(Date.now() - 21 * DAY).toISOString();
    fs.mkdirSync(path.join(danaCode, '.codetrellis'), { recursive: true });
    fs.writeFileSync(path.join(danaCode, '.codetrellis', 'config.json'), JSON.stringify({
      plans: { folder: { kind: 'git', remote: bare }, defaultVisibility: 'shared' },
      recurring: [
        { id: WEEKLY, playbook: 'bug-fix', title: 'Weekly security review', every: 'week', on: 1, at: '00:00', timeZone: 'UTC', carryOver: true, skills: [], since, by: 'Sam Lee' },
        { id: DAILY, playbook: 'bug-fix', title: 'Daily dependency check', every: 'day', at: '00:00', timeZone: 'UTC', carryOver: false, skills: [], since, by: 'Sam Lee' },
      ],
    }, null, 2));
    git(danaCode, 'add', '.codetrellis/config.json');
    git(danaCode, 'commit', '-q', '-m', 'recurring security review');
    await dana.client.scanProject(danaCode);
    const linked = await dana.client.raw('POST', `/api/plans-folder/link${q(danaCode)}`, { path: danaPlans });
    expect(linked.status, await linked.clone().text()).toBe(200);

    // Sam clones both, his planning copy at another path, and links it.
    samCode = path.join(sam.fixture.tmpDir, 'acme-app');
    execFileSync('git', ['clone', '-q', danaCode, samCode], { env: ENV, stdio: 'ignore' });
    samPlans = path.join(sam.fixture.tmpDir, 'elsewhere', 'my-plans');
    execFileSync('git', ['clone', '-q', `file://${bare}`, samPlans], { env: ENV, stdio: 'ignore' });
    await sam.client.scanProject(samCode);
    const samLinked = await sam.client.raw('POST', `/api/plans-folder/link${q(samCode)}`, { path: samPlans });
    expect(samLinked.status, await samLinked.clone().text()).toBe(200);

    phone = await pairPhone(sam.client, { alias: 'Sam\'s phone', capabilities: ['read', 'write', 'terminal'] });
  });

  test.afterAll(async () => {
    await phone?.close?.();
    await dana?.teardown();
    await sam?.teardown();
  });

  test('both laptops read the same series from the committed config: weeks missed, this one due', async () => {
    const d = await weekly(dana, danaCode);
    const s = await weekly(sam, samCode);
    expect(marks(s)).toEqual(marks(d));
    expect(s.runs.at(-2)!.state).toBe('due');
    expect(s.runs.slice(0, -2).every((r) => r.state === 'missed')).toBe(true);
    expect(s.due!.words).toBe('Weekly security review is due since Monday 00:00');
  });

  test('on his own laptop Sam has Claude Code start on each run; Dana\'s laptop and the committed config are untouched', async () => {
    const set = await sam.client.raw('PUT', `/api/recurring/${WEEKLY}/agent${q(samCode)}`, { agent: 'claude' });
    expect(set.status, await set.clone().text()).toBe(200);
    expect(((await set.json()) as { series: RecurringSeries }).series.agent).toMatchObject({ agent: 'claude' });
    expect((await sam.client.raw('PUT', `/api/recurring/${DAILY}/agent${q(samCode)}`, { agent: 'codex' })).status).toBe(200);
    expect((await weekly(dana, danaCode)).agent).toBeNull();
    expect(fs.readFileSync(path.join(samCode, '.codetrellis', 'config.json'), 'utf8')).not.toContain('"agent"');
    expect(git(samCode, 'status', '--porcelain')).toBe('');
  });

  test('from his phone, Sam starts this week\'s run: made on his laptop, written to the plans folder, and Claude Code opens there on it', async () => {
    const before = (await (await sam.client.raw('GET', '/api/terminals')).json()) as unknown[];
    run = (await phone.rpc('recurring.start', { projectPath: samCode, ruleId: WEEKLY })) as Started;
    expect(run.created).toBe(true);
    expect(run.title).toMatch(/^Weekly security review — W\d{2}$/);
    expect(run.agent).toMatchObject({ agent: 'claude', words: 'Claude Code started in a terminal on the computer' });

    const terminals = (await (await sam.client.raw('GET', '/api/terminals')).json()) as Array<{ id: string; title: string; cwd: string }>;
    expect(terminals).toHaveLength(before.length + 1);
    const term = terminals.find((t) => t.id === run.agent!.terminalId)!;
    expect(term).toMatchObject({ title: `${run.title} · Claude Code`, cwd: samCode });
    // The agent is asked to work this run's plan, by its id, in one shell
    // argument (the harness makes the program `echo`, so a test never starts a real
    // agent; unit tests check `claude`).
    const asked = `Work the CodeTrellis plan "${run.title}" (plan_uid ${run.planUid}): call get_next_item with that plan_uid, claim the task, read its brief with get_brief, do it, and repeat until no task is left.`;
    await expect.poll(async () => ((await (await sam.client.raw('GET', `/api/terminals/${term.id}/history`)).json()) as { data: string }).data
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''), { timeout: 15_000 }).toContain(asked);

    const written = (fs.readdirSync(path.join(samPlans, '.codetrellis', 'plans'), { recursive: true }) as string[]).filter((f) => f.endsWith('plan.yaml'));
    expect(written.some((f) => fs.readFileSync(path.join(samPlans, '.codetrellis', 'plans', f), 'utf8').includes(run.planUid))).toBe(true);
    git(samPlans, 'add', '-A');
    git(samPlans, 'commit', '-q', '-m', `run: ${run.title}`);
    git(samPlans, 'push', '-q', 'origin', 'HEAD');
  });

  test('through the planning repository Dana\'s laptop has Sam\'s run; starting it there finds his and opens no agent', async () => {
    git(danaPlans, 'pull', '-q', '--no-rebase', '--no-edit', 'origin', git(danaPlans, 'rev-parse', '--abbrev-ref', 'HEAD'));
    await expect.poll(async () => (await dana.client.raw('GET', `/api/plans/${run.planUid}`)).status, { timeout: 20_000 }).toBe(200);
    await expect.poll(async () => (await weekly(dana, danaCode)).runs.at(-2)!.planUid, { timeout: 10_000 }).toBe(run.planUid);

    const before = ((await (await dana.client.raw('GET', '/api/terminals')).json()) as unknown[]).length;
    const again = (await (await dana.client.raw('POST', `/api/recurring/${WEEKLY}/start${q(danaCode)}`, {})).json()) as Started;
    expect(again).toMatchObject({ planUid: run.planUid, created: false, agent: null });
    expect(((await (await dana.client.raw('GET', '/api/terminals')).json()) as unknown[]).length).toBe(before);

    const plans = (await (await dana.client.raw('GET', `/api/plans${q(danaCode)}`)).json()) as Array<{ uid: string; title: string }>;
    expect(plans.filter((p) => p.title === run.title).map((p) => p.uid)).toEqual([run.planUid]);
    // One series, one run, on both laptops.
    expect(marks(await weekly(dana, danaCode))).toEqual(marks(await weekly(sam, samCode)));
    expect((await weekly(sam, samCode)).runs.at(-2)!.state).toBe('in_progress');
  });

  test('a phone not allowed to open terminals starts a run without its agent, and says why', async () => {
    await phone.grant(['read', 'write']);
    const before = ((await (await sam.client.raw('GET', '/api/terminals')).json()) as unknown[]).length;
    const daily = (await phone.rpc('recurring.start', { projectPath: samCode, ruleId: DAILY })) as Started;
    expect(daily.created).toBe(true);
    expect(daily.agent).toEqual({ agent: 'codex', terminalId: null, words: 'Codex was not started: this phone is not allowed to open terminals (Settings → Devices)' });
    expect(((await (await sam.client.raw('GET', '/api/terminals')).json()) as unknown[]).length).toBe(before);
  });
});
