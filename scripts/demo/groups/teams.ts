/**
 * Teams and shared rules (Phase 32 Track C): the ways of working a team
 * keeps in its committed `.codetrellis/config.json`, read the same by every
 * laptop and agent. An architecture rule told only to the line of work that
 * breaks it; a recurring playbook whose run a person starts; "done" refused
 * on tests older than the code; and a plan's status read from git under its
 * ticket, never written. Mirrors the harness tests `awareness-m7`,
 * `recurring-two-machines`, `stale-done`, `grounding-replay` and
 * `plan-status`, against the running app. Catalogued in
 * `docs/DEMO-JOURNEYS.md`, section `teams`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ScriptedMcp } from '../../../tests/harness/mcp-client';
import { sampleAppRepo, type ParallelFixture } from '../../demo-fixtures';
import type { Ctx, Group } from '../types';
import { showSettings } from '../lib/settings';

const DAY = 86_400_000;
const NOTICE = '── CodeTrellis awareness ──';

// The team's rule: the API's routes read settings through the app.
const RULE_ID = 'routes-not-config';
const ROUTES = 'services/api/app/routes/';
const CONFIG = 'services/api/app/config.py';
const USERS = 'services/api/app/routes/users.py';
const ORDERS = 'services/api/app/routes/orders.py';
const BECAUSE = 'routes read settings through the app';

// The team's recurring playbook.
const WEEKLY = 'weekly-security-review';
const WEEKLY_TITLE = 'Weekly security review';

// Grounding: a source file, the test that imports it, and the run's report.
const V = 'packages/shared/src/validators.ts';
const V_TEST = 'packages/shared/src/validators.test.ts';
const REPORT = 'reports/validators.xml';

interface Signal {
  id: string; kind: string; severity: string; summary: string; state: string;
  subject: { file?: string; symbol?: string };
}

interface Run { period: string; label: string; state: string; planUid: string | null; words: string }
interface Series { rule: { id: string; title: string }; words: string; runs: Run[]; due: { period: string; label: string; words: string } | null }

let fx: ParallelFixture;
/** Works in `exports-v2`, the line of work that will cross the rule. */
let exportsAgent: ScriptedMcp;
/** Works in `auth-fix`, whose change breaks nothing. */
let authAgent: ScriptedMcp;

/** The team's committed config: one architecture rule and one recurring playbook, set three weeks ago. */
function seed(dir: string): void {
  const since = new Date(Date.now() - 21 * DAY).toISOString();
  fs.mkdirSync(path.join(dir, '.codetrellis'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.codetrellis', 'config.json'), JSON.stringify({
    rules: [
      { id: RULE_ID, from: ROUTES, mayNotImport: CONFIG, because: BECAUSE, since, by: 'Sam Lee' },
    ],
    recurring: [
      { id: WEEKLY, playbook: 'bug-fix', title: WEEKLY_TITLE, every: 'week', on: 1, at: '00:00', timeZone: 'UTC', carryOver: true, skills: [], since, by: 'Sam Lee' },
    ],
  }, null, 2));
  // The validators' tests, so a run's report reaches the file they import.
  fs.writeFileSync(path.join(dir, V_TEST), "import { isValidEmail } from './validators';\nexport const t = isValidEmail('sam@acme.test');\n");
}

/**
 * A JUnit report of `n` passing validator tests, dated `at`, stamped with
 * its run's time as runners do (vitest, jest-junit, pytest): two runs are two
 * reports. CodeTrellis keeps a report by its content, so a byte-identical
 * rerun would read as the old run.
 */
function writeReport(n: number, at: Date): void {
  const abs = path.join(fx.path, REPORT);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `<?xml version="1.0"?>\n<testsuites>\n<testsuite name="validators" timestamp="${at.toISOString()}">\n${
    Array.from({ length: n }, (_, i) => `<testcase classname="validators" name="case ${i + 1}" file="${V_TEST}" time="0.00${i % 9 + 1}"/>`).join('\n')
  }\n</testsuite>\n</testsuites>\n`);
  fs.utimesSync(abs, at, at);
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function signals(c: Ctx): Promise<Signal[]> {
  const body = await c.json('get_awareness', { project_path: fx.path });
  return Array.isArray(body?.signals) ? body.signals : [];
}

/** An ordinary call an agent would make anyway, and everything that came back with it. */
async function ordinary(agent: ScriptedMcp): Promise<string> {
  return (await agent.callTool('list_plans', {})).text;
}

async function weekly(c: Ctx): Promise<Series | undefined> {
  const body = await c.json('list_recurring', { project_path: fx.path });
  return (body?.series as Series[] | undefined)?.find((s) => s.rule.id === WEEKLY);
}

async function addItem(c: Ctx, args: Record<string, unknown>): Promise<string> {
  const item = await c.json('add_item', args);
  if (!item?.uid) c.flag(`add_item "${String(args.title)}" returned no uid`);
  return item?.uid ?? '';
}

export const teamsGroup: Group = {
  id: 'teams',
  title: 'Teams and shared rules',
  async setup(c) {
    fx = sampleAppRepo('teams', ['exports-v2', 'auth-fix'], seed);
    await c.say('A team\'s repository', 'Its committed config holds the team\'s architecture rule and a weekly playbook. Two lines of work: exports-v2 and auth-fix.');
    await c.call('open_project', { path: fx.path });
    exportsAgent = await c.agent('claude-code', { roots: [fx.trees['exports-v2']] });
    authAgent = await c.agent('codex', { roots: [fx.trees['auth-fix']] });
    // Listing them is what starts their watchers, as the window's strip does
    // when an agent arrives: only a line of work with an agent in it is watched.
    await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
  },
  scenes: [
    {
      id: 'rules',
      title: 'The team\'s rule, told only to the work that breaks it',
      watch: 'one high "rule" signal naming exports-v2, the import and the reason; Codex in auth-fix is told nothing',
      async run(c) {
        await c.call('navigate_to', { target: 'awareness' });
        await c.say('The rule is in the repository', `"${ROUTES} may not import ${CONFIG}: ${BECAUSE}". Every laptop and agent reads it from the committed config.`);
        const listed = await c.json('list_rules', { project_path: fx.path });
        const view = (listed?.rules as Array<{ rule: { id: string }; words: string; breachWords: string }> | undefined)?.find((r) => r.rule.id === RULE_ID);
        if (!view) { c.flag(`list_rules should list "${RULE_ID}" from the committed config; it listed ${JSON.stringify(listed).slice(0, 160)}`); return; }
        if (!view.words.includes(BECAUSE)) c.flag(`the rule should read with its reason; it reads "${view.words}"`);
        if (view.breachWords !== 'Nothing breaks this today') c.flag(`nothing breaks the rule on main; list_rules says "${view.breachWords}"`);
        await showSettings(c, 'rules', 't1-rules-settings', 'Where a person sees it', 'Settings → Rules lists the committed rule with its reason, and what breaks it today: nothing.');

        await c.say('An agent can ask first', 'check_conformity says whether an import would cross the rule, before it is written.');
        const across = await c.json('check_conformity', { project_path: fx.path, proposed_imports: [{ from: USERS, importing: CONFIG }] });
        const v = (across?.violations as Array<{ rule: string; because?: string }> | undefined)?.find((x) => x.rule === RULE_ID);
        if (across?.conformant !== false || !v) c.flag(`check_conformity should refuse ${USERS} → ${CONFIG} under the rule; it said ${JSON.stringify(across).slice(0, 160)}`);
        else if (v.because !== BECAUSE) c.flag(`the refusal should carry the team's reason; it carries "${v.because}"`);
        const allowed = await c.json('check_conformity', { project_path: fx.path, proposed_imports: [{ from: USERS, importing: 'services/api/app/db.py' }] });
        if (allowed?.conformant !== true) c.flag(`an import the rule allows should be conformant; check_conformity said ${JSON.stringify(allowed).slice(0, 160)}`);

        await c.say('Two agents at once', 'Claude Code in exports-v2 imports the settings into the users routes. Codex in auth-fix changes the order routes and crosses nothing.');
        fx.edit('auth-fix', ORDERS, 'router = APIRouter()', 'router = APIRouter()  # auth-fix: orders need a session');
        fx.edit('exports-v2', USERS, 'from app.db import', 'from app.config import DATABASE_URL\nfrom app.db import');
        const told = await c.until(async () => {
          const text = await ordinary(exportsAgent);
          return text.includes(NOTICE) ? text : null;
        }, 20, 'Claude Code in exports-v2 to be told about the rule');
        if (told) {
          const line = told.slice(told.indexOf(NOTICE)).split('\n').find((l) => l.includes(' rule: ')) ?? '';
          console.log(`    told: ${line.slice(0, 160)}`);
          if (!line.includes('high rule') || !line.includes('exports-v2') || !line.includes(BECAUSE)) c.flag(`the notice should name the rule, exports-v2 and why; it reads "${line.slice(0, 200)}"`);
          if (!told.includes('not an instruction')) c.flag('the notice should say it is information, not an instruction');
        }
        for (let i = 0; i < 3; i += 1) {
          if ((await ordinary(authAgent)).includes(NOTICE)) { c.flag('Codex in auth-fix broke no rule and should be told nothing'); break; }
          await c.beat(0.3);
        }
        const rule = (await signals(c)).find((s) => s.kind === 'rule');
        if (!rule) c.flag('no rule signal in Awareness');
        else if (rule.severity !== 'high') c.flag(`a broken team rule should be high; it is ${rule.severity}`);
        const digest = (await c.json('get_awareness', { project_path: fx.path }))?.digest as string | undefined;
        if (!digest?.includes('`exports-v2` now imports across the rule')) c.flag(`the digest should name exports-v2 and the rule; it reads "${digest?.slice(0, 200)}"`);
        await c.shot('t1-rules');

        await c.say('The import comes out', 'exports-v2 reads the URL through the app instead. The signal goes on its own.');
        fx.reset('exports-v2');
        fx.reset('auth-fix');
        await c.until(async () => !(await signals(c)).some((s) => s.kind === 'rule'), 20, 'the rule signal to clear');
      },
    },
    {
      id: 'recurring',
      title: 'A weekly playbook, started by a person',
      watch: '"Weekly security review is due since Monday. Start it?" in Awareness; weeks missed before it; starting it twice is one run',
      async run(c) {
        await c.call('navigate_to', { target: 'awareness' });
        await c.say('A recurring playbook', `${WEEKLY_TITLE}, every Monday, from the bug-fix playbook. It is in the committed config, so every laptop sees the same series.`);
        const s = await weekly(c);
        if (!s) { c.flag(`list_recurring should list "${WEEKLY}" from the committed config`); return; }
        console.log(`    ${s.words}: ${s.runs.map((r) => r.words).join(' · ')}`);
        if (!s.due) { c.flag(`this week's run should be due and not started; list_recurring says ${s.runs.map((r) => r.words).join(', ')}`); return; }
        if (!s.due.words.startsWith(`${WEEKLY_TITLE} is due since`)) c.flag(`the due run should say so in words; it says "${s.due.words}"`);
        if (!s.runs.some((r) => r.state === 'missed')) c.flag('the weeks before this one were never started and should read missed');
        const period = s.due.period;
        const q = `?project=${encodeURIComponent(fx.path)}`;

        await c.person({
          ask: `In Awareness, choose "Start ${WEEKLY_TITLE} — ${s.due.label}".`,
          decide: () => c.api(`/api/recurring/${WEEKLY}/start${q}`, {}),
          done: async () => (await weekly(c))?.runs.find((r) => r.period === period && r.state === 'in_progress' && r.planUid),
        });
        const run = (await weekly(c))?.runs.find((r) => r.period === period);
        const uid = run?.planUid;
        if (!run || !uid) return;
        c.defer('archived the recurring run', () => c.call('update_plan', { plan_uid: uid, status: 'archived' }));
        const plan = await c.json('get_plan', { plan_uid: uid });
        if (!String(plan?.title ?? '').startsWith(`${WEEKLY_TITLE} — `)) c.flag(`the run should be an ordinary plan named for its week; it is "${plan?.title}"`);
        console.log(`    started: ${plan?.title} (${run.words})`);

        // A teammate's laptop starting the same week finds this run: one run, not two.
        const again = await c.api(`/api/recurring/${WEEKLY}/start${q}`, {});
        if (again && (again.created !== false || again.planUid !== uid)) c.flag(`starting the same week twice should find the run; it made ${again.planUid}`);
        await c.say('One run per week', 'Started again, from here or a teammate\'s laptop, it finds this run.');
        await c.call('navigate_to', { target: 'plan', plan_uid: uid });
        await c.shot('t2-recurring');
        await showSettings(c, 'recurring', 't2-recurring-settings', 'Per laptop', 'Whether an agent opens on each run is set on each laptop, in Settings → Recurring playbooks. The series itself is the team\'s.');
      },
    },
    {
      id: 'grounding',
      title: '"Done" on tests older than the code is refused',
      watch: 'the task reads "⚠ tests older than the code" after the edit; done is refused with why; after a fresh run it goes through',
      async run(c) {
        const vAbs = path.join(fx.path, V);
        const original = fs.readFileSync(vAbs, 'utf-8');
        // The validators were last changed half an hour ago, before the tests ran.
        fs.utimesSync(vAbs, minutesAgo(30), minutesAgo(30));

        const plan = await c.json('create_plan', { title: 'Email validation', project_path: fx.path });
        if (!plan?.uid) { c.flag('create_plan returned no uid'); return; }
        c.defer('archived the grounding plan', () => c.call('update_plan', { plan_uid: plan.uid, status: 'archived' }));
        const item = await addItem(c, { plan_uid: plan.uid, kind: 'action', title: 'Tighten email validation', file_specs: [{ path: V, action: 'modify' }] });
        const criterion = (await c.json('add_criterion', { item_uid: item, text: 'The validator tests pass', kind: 'test' }))?.uid as string | undefined;
        if (!criterion) { c.flag('add_criterion returned no uid'); return; }
        await c.call('update_item', { uid: item, status: 'in_progress' });

        await c.say('The agent runs the tests', 'CodeTrellis runs nothing. The agent hands over its JUnit report: 12 passing, and the criterion has its evidence.');
        writeReport(12, minutesAgo(20));
        await c.call('report_tests', { path: REPORT, project_path: fx.path });
        const handOver = async () => {
          const art = await c.json('record_artefact', { item_uid: item, path: REPORT, role: 'evidence' });
          if (!art?.attachment_uid) { c.flag('record_artefact returned no attachment_uid'); return; }
          await c.call('submit_criterion', { criterion_uid: criterion, evidence: [{ attachment_uid: art.attachment_uid }] });
        };
        await handOver();
        const fresh = await c.json('get_test_results', { for_file: V, project_path: fx.path });
        if (fresh?.state !== 'passing') c.flag(`${V} should read passing after its tests ran; it reads "${fresh?.says}"`);

        await c.say('Then the code changes again', 'One more edit to the validators, after the run. That report is now about code that is no longer there.');
        fs.writeFileSync(vAbs, original.replace('return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.trim());'));
        const stale = await c.json('get_test_results', { for_file: V, project_path: fx.path });
        if (stale?.state !== 'stale' || !String(stale?.says).startsWith('⚠ tests older than the code')) c.flag(`${V} should read "⚠ tests older than the code"; it reads "${stale?.says}"`);
        await c.call('navigate_to', { target: 'brief', item_uid: item });

        const refused = await c.refuse('update_item', { uid: item, status: 'done' });
        if (refused.ok) c.flag('"done" on a report older than the code should be refused');
        else {
          console.log(`    refused: ${refused.text.slice(0, 140)}`);
          if (!/^Not done: .*tests older than the code.*Nothing was changed\.$/s.test(refused.text)) c.flag(`the refusal should say why and that nothing changed; it says "${refused.text.slice(0, 200)}"`);
        }
        const still = await c.json('get_item', { uid: item });
        if (still && still.status !== 'in_progress') c.flag(`a refused "done" should change nothing; the task is ${still.status}`);
        await c.say('Refused, with why', 'Not done: the tests ran before the last change. Run them again and hand over the new report.', 'warning');
        await c.shot('t3-grounding-stale');

        await c.say('Run again', 'The agent runs the tests on the code as it is now and hands over the new report. Now "done" goes through.', 'success');
        writeReport(12, new Date());
        await c.call('report_tests', { path: REPORT, project_path: fx.path });
        await handOver();
        await c.call('update_item', { uid: item, status: 'done' });
        const after = await c.json('get_test_results', { for_file: V, project_path: fx.path });
        if (after?.state !== 'passing') c.flag(`after a fresh run ${V} should read passing; it reads "${after?.says}"`);

        fs.writeFileSync(vAbs, original);
        fs.rmSync(path.join(fx.path, 'reports'), { recursive: true, force: true });
      },
    },
    {
      id: 'plan-status',
      title: 'Status read from git, under its ticket',
      watch: 'the Exports section says "building on exports-v2, not pushed" from git; the lineage runs FIN-88 → this plan → exports-v2',
      async run(c) {
        // exports-v2 has work committed, not pushed.
        fs.writeFileSync(path.join(fx.trees['exports-v2'], 'services/api/app/routes/exports.py'), 'from fastapi import APIRouter\n\nrouter = APIRouter()\n');
        fx.commit('exports-v2', 'exports: a router for the CSV export');
        await c.call('list_workstreams', { project_path: fx.path, include_idle: true });

        const plan = await c.json('create_plan', { title: 'Q3 exports', project_path: fx.path });
        if (!plan?.uid) { c.flag('create_plan returned no uid'); return; }
        c.defer('archived the status plan', () => c.call('update_plan', { plan_uid: plan.uid, status: 'archived' }));
        await c.call('set_plan_external_ref', { plan_uid: plan.uid, url: 'https://example.atlassian.net/browse/FIN-88', key: 'FIN-88' });
        const exportsSection = await addItem(c, { plan_uid: plan.uid, kind: 'object', title: 'Exports API' });
        const stream = await addItem(c, { plan_uid: plan.uid, kind: 'action', title: 'Stream the CSV export', parent_uid: exportsSection });
        const notes = await addItem(c, { plan_uid: plan.uid, kind: 'object', title: 'Release notes' });
        const write = await addItem(c, { plan_uid: plan.uid, kind: 'action', title: 'Write the release notes', parent_uid: notes });
        const check = await addItem(c, { plan_uid: plan.uid, kind: 'action', title: 'Check the figures', parent_uid: notes });
        const signOff = await addItem(c, { plan_uid: plan.uid, kind: 'action', title: 'Get the auditor\'s sign-off', parent_uid: notes });

        await c.say('A section on a branch', 'The Exports section is worked in exports-v2. Its state comes from git; nobody types it.');
        await c.call('assign_workstream', { item_uid: exportsSection, workstream: 'exports-v2' });
        await c.say('The rest is recorded', 'The notes are 60% written, the figures checked, and the sign-off waits on the auditor.');
        await c.call('update_item', { uid: write, status: 'in_progress', progress_percent: 60 });
        await c.call('update_item', { uid: check, status: 'done' });
        await c.call('set_item_blocked', { uid: signOff, reason: 'waits on the auditor' });

        const got = await c.json('get_plan', { plan_uid: plan.uid });
        const st = got?.state as {
          progress: string; lineage: string[]; waiting: Array<{ item_uid: string; says: string }>;
          items: Array<{ item_uid: string; state: string; source: string; says: string; recorded_by?: string }>;
        } | null;
        if (!st) { c.flag('get_plan returned no state'); return; }
        const by = (uid: string) => st.items.find((i) => i.item_uid === uid);
        console.log(`    ${st.progress}; ${st.lineage.join(' | ')}`);
        if (st.progress !== '1 of 4 tasks done') c.flag(`progress should read "1 of 4 tasks done"; it reads "${st.progress}"`);
        const s = by(stream);
        if (s?.source !== 'git' || s.state !== 'building' || s.says !== 'building on exports-v2, not pushed') c.flag(`the task on exports-v2 should be read from git as "building on exports-v2, not pushed"; it is ${JSON.stringify(s)}`);
        const w = by(write);
        if (w?.source !== 'plan' || w.says !== 'in progress, 60%' || !w.recorded_by) c.flag(`the notes task should say "in progress, 60%" from the plan, with who recorded it; it is ${JSON.stringify(w)}`);
        if (!st.waiting.some((x) => x.item_uid === signOff && x.says === 'blocked: waits on the auditor')) c.flag(`the sign-off should wait on someone, with why; waiting is ${JSON.stringify(st.waiting)}`);
        if (!st.lineage.some((l) => l.startsWith('FIN-88 → this plan → ') && l.includes('exports-v2'))) c.flag(`the lineage should run FIN-88 → this plan → exports-v2; it is ${JSON.stringify(st.lineage)}`);
        if (st.lineage.some((l) => /PR #|MR !/.test(l))) c.flag('the lineage names a pull request with no review host turned on');

        await c.call('navigate_to', { target: 'plan', plan_uid: plan.uid });
        await c.say('Read, never written', 'The window, an agent\'s get_plan and the phone give this one answer, and reading it writes nothing to the repository.', 'success');
        await c.shot('t4-plan-status');
      },
    },
  ],
};
