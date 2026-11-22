/**
 * The talk's demos: an applied AI development lifecycle on one small
 * repository, in two parts.
 *
 * - `talk` (Part 1, one agent): plan → build → check → review. The plan where
 *   an agent can read it; one session claims a task, builds it, and every line
 *   is attributed; a rule that travels with the code; the review against the
 *   plan.
 * - `talk-team` (Part 2, many agents): the same loop run by a team. Three
 *   sessions claim the epic's three stories, two of them meet in one function
 *   and are told, and a breakpoint holds an edit until a person answers.
 *
 * The repository is `fixtures/prefs-api.ts`: a TypeScript API in three layers,
 * `src/endpoints/` → `src/services/` → `src/db/`, with a worktree per line of
 * work. The epic is customer preferences, in three stories: save, read, audit.
 * Agents connect as Claude Code sessions do, each placed by the worktree it
 * runs in, and claim tasks from the plan: they do not divide the work
 * themselves. Nothing is narrated in the window: the videos are captioned
 * where they are cut (`video/compositions/demo-0*`), and spoken over live.
 * Every scene is a moment a video cuts on, so the scenes are short and there
 * are many. Catalogued in `docs/DEMO-JOURNEYS.md`, sections `talk` and
 * `talk-team`.
 *
 * Steps only a person can take in the window (open the Rules view, type to
 * the agents) are taken in the real page when a recorder is listening
 * (`lib/window.ts`); otherwise through `c.person`, as the other groups do.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { ScriptedMcp } from '../../../tests/harness/mcp-client';
import { prefsApiRepo, type PrefsApiFixture } from '../../demo-fixtures';
import {
  ENDPOINT_BREACH, ENDPOINT_FIXED, PREFS_ENDPOINT, PREFS_REPO, PREFS_RULES, PREFS_RULE_ID, PREFS_SERVICE,
} from '../fixtures/prefs-api';
import { runHook } from '../lib/hook';
import { inWindow, recording } from '../lib/window';
import type { Ctx, Group } from '../types';

const SAVE = 'prefs-save';
const READ = 'prefs-read';
const AUDIT = 'prefs-audit';
const CLIENT = 'src/db/client.ts';
const SERVER = 'src/server.ts';
const READ_ENDPOINT = 'src/endpoints/readPreferences.ts';
const AUDIT_SERVICE = 'src/services/auditService.ts';
const AUDIT_REPO = 'src/db/auditRepo.ts';
const NOTICE = '── CodeTrellis awareness ──';

const VALIDATION = "  if (change.language !== undefined && change.language.length !== 2) throw new Error('language is a two-letter code');\n  const current = readPreferences(customerId);";
const MESSAGE = 'prefs-save owns savePreferences. prefs-audit: wrap it, do not change it.';
const NOTE = 'Putting savePreferences back. The audit will wrap it from outside.';
const STEER = 'keep the existing validation, add the new field only';
const BREAKPOINT_NOTE = 'Ask me before the preferences table changes';
const AUDIT_WRAPPER = `import { readPreferences, type PreferencesRow } from '../db/preferencesRepo';

export interface AuditEntry {
  customerId: string;
  changed: Array<keyof PreferencesRow>;
  at: string;
}

const entries: AuditEntry[] = [];

/** Record what a save changed. Called beside savePreferences, never inside it. */
export function recordChange(before: PreferencesRow): AuditEntry {
  const after = readPreferences(before.customerId);
  const changed = (Object.keys(after) as Array<keyof PreferencesRow>).filter((k) => before[k] !== after[k]);
  const entry = { customerId: after.customerId, changed, at: new Date().toISOString() };
  entries.push(entry);
  return entry;
}
`;
const CRITERIA = ['A change for a customer who does not exist is refused', 'A language that is not a two-letter code is refused'];

interface Signal {
  id: string; kind: string; severity: string; summary: string; state: string;
  subject: { file?: string; symbol?: string; rule?: { id: string } };
}

let fx: PrefsApiFixture;
/** The session that scoped the work: it writes the plan and builds nothing. */
let planner: ScriptedMcp;
/** One Claude Code session per line of work. Part 1 has only `save`. */
let save: ScriptedMcp | undefined;
let read: ScriptedMcp | undefined;
let audit: ScriptedMcp | undefined;

/** The plan's items, by a short name. */
let items: Record<string, string> = {};

const q = () => `project=${encodeURIComponent(fx.path)}`;
const abs = (rel: string, tree = 'main') => path.join(fx.trees[tree], rel);

async function signals(c: Ctx): Promise<Signal[]> {
  const body = await c.json('get_awareness', { project_path: fx.path });
  return Array.isArray(body?.signals) ? body.signals : [];
}

/** An ordinary call an agent would make anyway, and everything that came back with it. */
async function ordinary(agent: ScriptedMcp): Promise<string> {
  return (await agent.callTool('list_plans', {})).text;
}

/** A call an agent makes; flagged when it is refused. */
async function as(c: Ctx, agent: ScriptedMcp, tool: string, args: Record<string, unknown>): Promise<any> {
  const r = await agent.callTool(tool, args);
  if (r.isError) { c.flag(`${tool}: ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`); return null; }
  try { return JSON.parse(r.answer); } catch { return {}; }
}

/** Show a file of the main checkout in the reader. */
async function reader(c: Ctx, rel: string, line?: number, extra: Record<string, unknown> = {}): Promise<void> {
  // Line history stays on once it is asked for: every other read turns it off again.
  await c.call('navigate_to', { target: 'code', file_path: abs(rel), ...(line ? { line } : {}), line_history: false, ...extra });
}

async function workspace(c: Ctx): Promise<string> {
  try { return JSON.parse((await c.refuse('ui_ready')).text)?.workspaceMode ?? ''; } catch { return ''; }
}

const PANEL_BUTTON = (title: string) => ({ css: `button[title="${title}"]:has(+ button[title="Hide panel"])` });

/**
 * Show a tab of the panel under the graph (Stack, Awareness, Timeline), opened
 * up to the height of the window: at its usual height a card and its buttons
 * do not fit.
 */
async function panel(c: Ctx, target: 'stack' | 'awareness' | 'timeline', extra: Record<string, unknown> = {}): Promise<void> {
  if ((await workspace(c)) !== 'graph') await c.call('navigate_to', { target: 'graph' });
  // The Timeline has no tool that opens it: Stack brings the panel up, and its tab is a click.
  await c.call('navigate_to', { target: target === 'timeline' ? 'stack' : target, ...extra });
  if (target === 'timeline' && recording()) await inWindow({ do: 'click', target: { css: '.glass-panel button', has: 'Timeline' } }, c.flag);
  if (recording()) await inWindow({ do: 'click', target: PANEL_BUTTON('Expand panel'), timeout: 1200 });
}

async function collapsePanel(): Promise<void> {
  if (recording()) await inWindow({ do: 'click', target: PANEL_BUTTON('Collapse panel'), timeout: 1200 });
}

/** The plan's own page: its name, in the header, goes there from any item. */
async function planHome(c: Ctx): Promise<void> {
  await c.call('navigate_to', { target: 'plan', plan_uid: c.state.plan });
  if (recording()) await inWindow({ do: 'click', target: { testid: 'plan-header-title' }, timeout: 3000 });
}

/** Open the Rules view: a click in the window, since no tool opens it. */
async function openRules(c: Ctx, tab: 'rules' | 'checks' = 'rules'): Promise<boolean> {
  if ((await workspace(c)) !== 'rules') {
    if (recording()) await inWindow({ do: 'click', target: { css: 'button[aria-label="Rules"]' } }, c.flag);
    else if (c.mode === 'watch' && !c.opts.decide) await c.person({ ask: 'Open the Rules view (top bar).', done: async () => (await workspace(c)) === 'rules' });
  }
  if ((await workspace(c)) !== 'rules') return false;
  if (recording()) await inWindow({ do: 'click', target: { testid: `rules-tab-${tab}` } }, c.flag);
  return true;
}

async function closeRules(c: Ctx): Promise<void> {
  if ((await workspace(c)) === 'rules' && recording()) await inWindow({ do: 'click', target: { testid: 'rules-view-close' } });
}

async function ruleView(c: Ctx): Promise<{ rule: { id: string; strength: string }; breaches: unknown[] | null } | undefined> {
  const listed = await c.json('list_rules', { project_path: fx.path });
  return (listed?.rules as Array<{ rule: { id: string; strength: string }; breaches: unknown[] | null }> | undefined)?.find((r) => r.rule.id === PREFS_RULE_ID);
}

/** Has the main checkout's map caught up with what is checked out there? `null` while the imports are being read again. */
async function breaks(c: Ctx): Promise<boolean | null> {
  const view = await ruleView(c);
  return Array.isArray(view?.breaches) ? view.breaches.length > 0 : null;
}

/** The pull request, checked out where the check and the reader look: the main checkout, at the branch's commit. */
async function checkOut(c: Ctx, ref: string, detach = true): Promise<void> {
  fx.git('main', 'checkout', '-q', ...(detach ? ['--detach'] : []), ref);
  await c.call('rescan_project', { project_path: fx.path });
}

/** Run a command in the window's terminal and wait until it has printed `until`. */
async function inTerminal(c: Ctx, input: string, until: RegExp, seconds = 60): Promise<string> {
  if (!c.state.term) {
    const t = await c.json('terminal_create', { cwd: fx.path, title: 'pull request', focus: true });
    c.state.term = t?.session_id ?? '';
    if (!c.state.term) { c.flag('terminal_create gave no session: the terminal capability is not held (run with --grant=terminal)'); return ''; }
    await c.beat(0.6);
    await c.call('terminal_write', { session_id: c.state.term, input: 'clear\n' });
  }
  await c.call('terminal_write', { session_id: c.state.term, input: `${input}\n`, focus: true });
  const out = await c.until(async () => {
    // Only what came after this command: the last run's output is still on screen until `clear` has run.
    const all = (await c.refuse('terminal_read', { session_id: c.state.term, lines: 40 })).text;
    const text = all.slice(all.lastIndexOf(input) + input.length);
    return all.includes(input) && until.test(text) ? text : null;
  }, seconds, `the terminal to print ${until}`);
  return out ?? '';
}

/**
 * `codetrellis check --base main` on the pull request's commit, and what it
 * printed with its exit code on the last line. A person watches it in the
 * window's terminal. With no window (CI's check of this group) it is the same
 * command, run from source against the same backend.
 */
async function check(c: Ctx, clear = false): Promise<string> {
  if (c.mode === 'watch') return inTerminal(c, `${clear ? 'clear; ' : ''}codetrellis check --base main; echo "exit code $?"`, /exit code \d/);
  const r = spawnSync(process.execPath, [path.join(c.opts.repo, 'bin/codetrellis.mjs'), 'check', '--base', 'main', '--no-color', '--data-dir', c.opts.dataDir], { cwd: fx.path, encoding: 'utf-8', timeout: 120_000 });
  return `${r.stdout ?? ''}${r.stderr ?? ''}\nexit code ${r.status}`;
}

/** The repository, open in the window, and the session that will write the plan. */
async function open(c: Ctx, worktrees: string[]): Promise<void> {
  save = read = audit = undefined;
  items = {};
  fx = prefsApiRepo(worktrees);
  await c.call('open_project', { path: fx.path });
  // Listing them is what starts their watchers, as the window's strip does.
  await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
  await c.call('navigate_to', { target: 'graph' });
  // The inspector has nothing to say in these scenes: its room goes to the graph and the panel under it.
  await c.call('toggle_panel', { panel: 'inspector' });
  c.defer('the inspector back', () => c.call('toggle_panel', { panel: 'inspector' }));
  planner = await c.agent('claude-code');
}

const SPEC = [
  '## The epic',
  'A customer can change how we contact them, see what they chose, and we keep a record of every change.',
  '',
  '## Three stories',
  '- **Save**: `PUT /customers/:id/preferences`. The service validates, then writes.',
  '- **Read**: `GET /customers/:id/preferences`.',
  '- **Audit**: every change is recorded, with who and when.',
  '',
  '## Rule',
  'Endpoints never import `src/db/`. They go through `src/services/`.',
].join('\n');

/**
 * The plan, as the capable model scoped it: a page of spec and the epic's
 * three stories. `tasks` is the work under each story: `[name, title, files]`.
 */
async function plan(c: Ctx, stories: Array<[string, Array<[string, string, Array<{ path: string; action: string }>]>]>): Promise<void> {
  const made = await as(c, planner, 'create_plan', {
    title: 'Customer preferences',
    description: 'One epic, three stories: a customer saves how we contact them, reads it back, and every change is audited.',
    project_path: fx.path,
  });
  c.state.plan = made?.uid ?? '';
  if (!c.state.plan) { c.flag('create_plan gave no uid'); return; }
  const built = await as(c, planner, 'bulk_add_items', {
    plan_uid: c.state.plan,
    items: [
      { _temp_uid: 'spec', kind: 'object', title: 'Spec: customer preferences', body: SPEC },
      ...stories.flatMap(([story, tasks], i) => [
        { _temp_uid: `story${i}`, kind: 'object', title: story },
        ...tasks.map(([name, title, files]) => ({ _temp_uid: name, parent_uid: `story${i}`, kind: 'action', title, file_specs: files })),
      ]),
    ],
  });
  for (const it of (built?.items ?? []) as Array<{ _temp_uid: string; uid: string }>) items[it._temp_uid] = it.uid;
  for (const name of ['spec', ...stories.flatMap(([, tasks]) => tasks.map(([n]) => n))]) if (!items[name]) c.flag(`the plan has no "${name}" item`);
}

/** Each task belongs to a line of work, so it is offered only to the agent there. */
async function assign(c: Ctx, pairs: Array<[string, string]>): Promise<void> {
  for (const [name, branch] of pairs) {
    const r = await c.call('assign_workstream', { item_uid: items[name], workstream: branch });
    if (!r.ok) c.flag(`assign_workstream ${name} → ${branch} failed`);
  }
}

async function claim(c: Ctx, agent: ScriptedMcp, name: string): Promise<void> {
  const r = await agent.callTool('claim_item', { uid: items[name] });
  if (r.isError || !/"ok":\s*true/.test(r.answer)) c.flag(`claim ${name}: ${r.text.replace(/\s+/g, ' ').slice(0, 140)}`);
}

// ── Part 1 · one agent ────────────────────────────────────────────────────

async function setUpSolo(c: Ctx): Promise<void> {
  await open(c, [SAVE]);
  await plan(c, [
    ['Story 1 · Save preferences', [
      ['service', 'Validate and save in the service', [{ path: PREFS_SERVICE, action: 'modify' }]],
      ['endpoint', 'PUT /customers/:id/preferences', [{ path: PREFS_ENDPOINT, action: 'create' }, { path: SERVER, action: 'modify' }]],
    ]],
    ['Story 2 · Read preferences', [['read', 'GET /customers/:id/preferences', [{ path: READ_ENDPOINT, action: 'create' }]]]],
    ['Story 3 · Audit every change', [['audit', 'Record who changed what, and when', [{ path: AUDIT_SERVICE, action: 'create' }, { path: AUDIT_REPO, action: 'create' }]]]],
  ]);
  if (!c.state.plan) return;
  // What done means, written with the plan, and a note from whoever scoped it.
  for (const text of CRITERIA) {
    const made = await as(c, planner, 'add_criterion', { item_uid: items.service, text, kind: 'manual' });
    if (made?.uid) c.state[`criterion${CRITERIA.indexOf(text)}`] = made.uid;
  }
  await as(c, planner, 'add_criterion', { item_uid: items.endpoint, text: 'The endpoint goes through the service, never the database', kind: 'manual' });
  await as(c, planner, 'add_item_comment', { uid: items.service, kind: 'note', body: 'The repo already refuses an unknown language. Keep that, and check the shape here before it gets there.' });
  await assign(c, [['service', SAVE], ['endpoint', SAVE]]);
}

async function connectSolo(c: Ctx): Promise<ScriptedMcp> {
  save ??= await c.agent('claude-code', { roots: [fx.trees[SAVE]] });
  await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
  return save;
}

export const talkGroup: Group = {
  id: 'talk',
  title: 'The talk, part 1: one agent plans, builds, checks, reviews',
  setup: setUpSolo,
  scenes: [
    // ── 01 · The plan, where agents can read it ────────────────────────
    {
      id: 'talk-plan',
      title: 'The plan: one epic, three stories',
      watch: 'the plan "Customer preferences" on its own page: three stories and their tasks in the tree, nobody working',
      async run(c) {
        await c.call('open_plan', { plan_uid: c.state.plan });
        await c.beat(2.5);
      },
    },
    {
      id: 'talk-spec',
      title: 'A short page of spec',
      watch: 'the spec page: the epic, the three stories, the rule',
      async run(c) {
        await c.call('select_item', { item_uid: items.spec, plan_uid: c.state.plan });
        await c.beat(3);
      },
    },
    {
      id: 'talk-task',
      title: 'A task, with what done means',
      watch: 'the task "Validate and save in the service": its files, its two acceptance criteria, and a comment',
      async run(c) {
        await c.call('select_item', { item_uid: items.service, plan_uid: c.state.plan });
        await c.beat(1.5);
        await c.call('navigate_to', { target: 'brief', plan_uid: c.state.plan, item_uid: items.service });
        await c.beat(3.5);
      },
    },
    {
      id: 'talk-export',
      title: 'The same plan, as files in the repository',
      watch: 'a file under .codetrellis/plans/ in the reader: the plan as text an agent or a person can read',
      async run(c) {
        const dir = abs('.codetrellis/plans');
        const found = fs.existsSync(dir)
          ? (fs.readdirSync(dir, { recursive: true }) as string[]).map((f) => path.join('.codetrellis/plans', f)).filter((f) => fs.statSync(abs(f)).isFile())
          : [];
        console.log(`    exported: ${found.map((f) => path.basename(f)).join(', ').slice(0, 200) || 'nothing'}`);
        const pick = found.find((f) => path.basename(f).includes('validate-and-save')) ?? found.find((f) => path.basename(f) === 'plan.yaml') ?? found[0];
        if (!pick) { c.flag('the plan should be exported under .codetrellis/plans/'); return; }
        c.state.exported = pick;
        await reader(c, pick, 1);
        await c.beat(3.5);
      },
    },
    {
      id: 'talk-phases',
      title: 'The plan, every story in view',
      watch: 'back on the plan\'s own page, the whole tree open',
      async run(c) {
        await planHome(c);
        await c.beat(3.5);
      },
    },

    // ── 02 · One agent, one task ───────────────────────────────────────
    {
      id: 'talk-claim',
      title: 'One session claims the task',
      watch: 'a chip for prefs-save in the top bar, with its agent; the Timeline shows the claim',
      async run(c) {
        await panel(c, 'timeline');
        await c.beat(1);
        const agent = await connectSolo(c);
        await c.beat(1.2);
        await claim(c, agent, 'service');
        await c.beat(2.5);
      },
    },
    {
      id: 'talk-build',
      title: 'It builds, and the Timeline keeps up',
      watch: 'the Timeline takes each step as it happens: started, what it is doing, the file it changed, the commit',
      async run(c) {
        const agent = await connectSolo(c);
        await as(c, agent, 'update_item', { uid: items.service, status: 'in_progress' });
        await c.beat(0.8);
        await as(c, agent, 'update_item_progress', { uid: items.service, percent: 25, message: 'Reading savePreferences and the repo\'s own checks' });
        await c.beat(1);
        fx.edit(SAVE, PREFS_SERVICE, '  const current = readPreferences(customerId);', VALIDATION);
        await as(c, agent, 'update_item_progress', { uid: items.service, percent: 60, message: 'Refusing a language that is not two letters, before the write' });
        await c.beat(1.2);
        // Beside its task, it also tidies a file no task names: the review will say so.
        fx.edit(SAVE, CLIENT, '/** One table, by name. A stand-in for the database. */', '/** One table, by name, made on first use. A stand-in for the database. */');
        fx.commit(SAVE, 'Validate the language in savePreferences\n\nagent: claude-code');
        await as(c, agent, 'update_item_progress', { uid: items.service, percent: 90, message: 'Committed on prefs-save' });
        await c.beat(2.5);
      },
    },
    {
      id: 'talk-line',
      title: 'Whose line is this?',
      watch: 'line history on the new line of savePreferences: claude-code, from the commit message, and the commit it landed in',
      async run(c) {
        await collapsePanel();
        await checkOut(c, SAVE);
        const line = fs.readFileSync(abs(PREFS_SERVICE), 'utf-8').split('\n').findIndex((l) => l.includes('two-letter code')) + 1;
        if (!line) { c.flag('the pull request\'s commit should hold the new line'); return; }
        const told = (await c.call('line_history', { path: PREFS_SERVICE, line, project_path: fx.path })).text;
        console.log(`    ${told.replace(/\s+/g, ' ').slice(0, 220)}`);
        if (!told.includes('claude-code')) c.flag('line history should name claude-code for the new line');
        await reader(c, PREFS_SERVICE, line, { line_history: true });
        await c.beat(4.5);
        await checkOut(c, 'main', false);
      },
    },
    {
      id: 'talk-done',
      title: 'Done, on its acceptance criteria',
      watch: 'the agent offers each criterion with what shows it; a person approves; the task is done',
      async run(c) {
        const agent = await connectSolo(c);
        await c.call('navigate_to', { target: 'brief', plan_uid: c.state.plan, item_uid: items.service });
        await c.beat(1.2);
        const notes = ['savePreferences throws "no such customer" before anything is read.', 'A language of any other length throws before the write; the repo still refuses an unknown one.'];
        for (const [i, note] of notes.entries()) {
          const uid = c.state[`criterion${i}`];
          if (!uid) { c.flag(`criterion ${i + 1} was not added with the plan`); continue; }
          const offered = await as(c, agent, 'submit_criterion', { criterion_uid: uid, evidence: [], note });
          if (offered && offered.state !== 'submitted') c.flag(`a criterion an agent offers should wait for a person; it is ${offered.state}`);
          await c.beat(0.9);
        }
        await c.beat(0.8);
        for (const i of [0, 1]) {
          const uid = c.state[`criterion${i}`];
          if (!uid) continue;
          await c.person({
            ask: `In the Brief, approve "${CRITERIA[i]}".`,
            decide: () => c.api(`/api/criteria/${uid}/decide`, { decision: 'approved' }),
            done: async () => {
              const list = await c.json('list_criteria', { item_uid: items.service });
              return (Array.isArray(list) ? list : []).find((x: { uid: string }) => x.uid === uid)?.state === 'met';
            },
          });
          await c.beat(0.9);
        }
        await as(c, agent, 'update_item', { uid: items.service, status: 'done' });
        const item = await c.json('get_item', { uid: items.service });
        if (item?.status !== 'done') c.flag(`the task should be done; it is ${item?.status}`);
        await c.call('navigate_to', { target: 'brief', plan_uid: c.state.plan, item_uid: items.service });
        await c.beat(4);
      },
    },

    // ── 03 · The rule travels with the code ────────────────────────────
    {
      id: 'talk-rule',
      title: 'The rule, in the repository',
      watch: `${PREFS_RULES} in the reader: src/endpoints/ may not import src/db/, strength warn`,
      async run(c) {
        await reader(c, PREFS_RULES, 8);
        // Line history is still on from the last demo, and no tool turns it off: its tab does.
        if (recording()) await inWindow({ do: 'click', target: { css: 'button', has: 'Line history' }, timeout: 3000 });
        await c.beat(3);
      },
    },
    {
      id: 'talk-promote',
      title: 'A person promotes it from warn to block',
      watch: 'the Rules view: the rule at warn; entered again at block and saved; the list says block, and the file in the repository says block',
      async run(c) {
        const shown = await openRules(c);
        await c.beat(1.5);
        let done = false;
        if (shown && recording()) {
          done = await inWindow({ do: 'type', target: { testid: 'rule-from' }, text: 'src/endpoints/' }, c.flag)
            && await inWindow({ do: 'type', target: { testid: 'rule-may-not-import' }, text: 'src/db/' }, c.flag)
            && await inWindow({ do: 'type', target: { testid: 'rule-because' }, text: 'Endpoints go through services, which hold the validation.', delay: 14 }, c.flag)
            && await inWindow({ do: 'click', target: { testid: 'rule-strength-block' } }, c.flag);
          await c.beat(0.6);
          done = done && await inWindow({ do: 'click', target: { testid: 'rule-save' } }, c.flag);
        }
        if (!done) {
          await c.person({
            ask: 'In the Rules view, enter "src/endpoints/ may not import src/db/" again at block and save it.',
            decide: () => c.api(`/api/rules/${PREFS_RULE_ID}?${q()}`, { from: 'src/endpoints/', mayNotImport: 'src/db/', because: 'Endpoints go through services, which hold the validation.', strength: 'block', suite: 'architecture' }, 'PUT'),
            done: async () => (await ruleView(c))?.rule.strength === 'block',
          });
        }
        const now = await c.until(async () => ((await ruleView(c))?.rule.strength === 'block' ? 'block' : null), 10, 'the rule to hold at block');
        if (now && recording()) await inWindow({ do: 'scroll', target: { testid: 'rules-list' } });
        await c.beat(2.5);
        await closeRules(c);
        await c.call('navigate_to', { target: 'graph' });
        await reader(c, PREFS_RULES, 8);
        if (!fs.readFileSync(abs(PREFS_RULES), 'utf-8').includes('strength: block')) c.flag('the suite file should say strength: block after the promotion');
        await c.beat(2.5);
        // The check judges a branch by its base's rules: the promotion is committed, and the line of work picks it up.
        fx.commit('main', 'Hold endpoints-not-db at block');
        fx.git(SAVE, 'merge', '-q', '--no-edit', 'main');
      },
    },
    {
      id: 'talk-proposal',
      title: 'An agent proposes a rule; a person decides',
      watch: 'Rules shows "Proposed by agents (1)": src/services/ may not import src/endpoints/, with Accept and Reject. Nothing is written',
      async run(c) {
        const agent = await connectSolo(c);
        const r = await agent.callTool('propose_rule', {
          id: 'src-services-not-src-endpoints', from: 'src/services/', may_not_import: 'src/endpoints/', suite: 'architecture',
          because: 'Services do not know about HTTP.',
          why: 'While validating savePreferences I saw nothing stops a service importing an endpoint. The layers only hold one way.',
        });
        if (r.isError) c.flag(`propose_rule: ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`);
        if (await openRules(c, 'rules')) await inWindow({ do: 'scroll', target: { testid: 'rule-proposals' }, block: 'start' }, c.flag);
        if (fs.readFileSync(abs(PREFS_RULES), 'utf-8').includes('src-services-not-src-endpoints')) c.flag('a proposal must write nothing to the suite');
        await c.beat(3.5);
        await closeRules(c);
      },
    },
    {
      id: 'talk-breach',
      title: 'The agent writes the endpoint straight to the database',
      watch: 'prefs-save adds src/endpoints/preferences.ts importing src/db/; a high rule signal names it, the import and the reason, and says Claude Code was told',
      async run(c) {
        const agent = await connectSolo(c);
        await claim(c, agent, 'endpoint');
        fx.write(SAVE, PREFS_ENDPOINT, ENDPOINT_BREACH);
        await panel(c, 'awareness');
        const hit = await c.until(async () => (await signals(c)).find((s) => s.kind === 'rule' && s.subject.rule?.id === PREFS_RULE_ID), 25, 'the rule signal');
        if (!hit) return;
        if (hit.severity !== 'high') c.flag(`a block rule's breach should be high; it is ${hit.severity}`);
        const told = await c.until(async () => {
          const text = await ordinary(agent);
          return text.includes(NOTICE) ? text : null;
        }, 15, 'Claude Code in prefs-save to be told about the rule');
        if (told) console.log(`    told: ${told.slice(told.indexOf(NOTICE)).split('\n').slice(1, 3).join(' ').slice(0, 170)}`);
        await panel(c, 'awareness', { signal_id: hit.id });
        await c.beat(3.5);
        fx.commit(SAVE, 'Add the preferences endpoint\n\nagent: claude-code');
        await checkOut(c, SAVE);
        await c.until(() => breaks(c), 25, 'the map to show the pull request\'s import');
      },
    },
    {
      id: 'talk-check-fail',
      title: 'codetrellis check: does not conform, exit 3',
      watch: 'the terminal, on the pull request\'s commit: "Does not conform", the rule, the file and line, and exit 3',
      async run(c) {
        const out = await check(c);
        if (!/Does not conform/.test(out)) c.flag(`the check should not conform; the terminal says ${out.replace(/\s+/g, ' ').slice(-200)}`);
        if (!/exit code 3/.test(out)) c.flag('the check should exit 3');
        await c.beat(4);
      },
    },
    {
      id: 'talk-checks',
      title: 'The run is kept, beside the rules',
      watch: 'Rules → Checks lists the failed run, who ran it and where; opened, it shows the finding',
      async run(c) {
        await c.call('toggle_panel', { panel: 'terminal' });
        const shown = await openRules(c, 'checks');
        if (!shown) console.log('    (no recorder to open the Rules view: the run is in list_check_runs)');
        const runs = await c.json('list_check_runs', { project_path: fx.path });
        console.log(`    ${(runs?.runs ?? []).length} check run(s) kept`);
        if (!(runs?.runs ?? []).length) c.flag('the failed check should be kept as a check run');
        await c.beat(1.2);
        if (shown) await inWindow({ do: 'click', target: { testid: 'check-run-row' } }, c.flag);
        await c.beat(4);
        await closeRules(c);
      },
    },
    {
      id: 'talk-fix',
      title: 'The agent moves the call into the service',
      watch: 'the finding on line 2 of the endpoint; then the endpoint importing the service, and the rule signal gone',
      async run(c) {
        await reader(c, PREFS_ENDPOINT, 2);
        await c.beat(2);
        fx.write(SAVE, PREFS_ENDPOINT, ENDPOINT_FIXED);
        fx.commit(SAVE, 'Save preferences through the service\n\nagent: claude-code');
        await checkOut(c, SAVE);
        await c.until(async () => (await breaks(c)) === false, 25, 'the map to show the import gone');
        await c.until(async () => !(await signals(c)).some((s) => s.kind === 'rule' && s.subject.rule?.id === PREFS_RULE_ID), 25, 'the rule signal to clear');
        await c.call('navigate_to', { target: 'graph' });
        await reader(c, PREFS_ENDPOINT, 2);
        await c.beat(3);
      },
    },
    {
      id: 'talk-check-pass',
      title: 'codetrellis check: conforms',
      watch: 'the same command in the same terminal: "Conforms", and exit 0',
      async run(c) {
        const out = await check(c, true);
        if (!/Conforms/.test(out)) c.flag(`the check should conform; the terminal says ${out.replace(/\s+/g, ' ').slice(-200)}`);
        if (!/exit code 0/.test(out)) c.flag('the check should exit 0');
        await c.beat(4);
        await c.call('toggle_panel', { panel: 'terminal' });
        await checkOut(c, 'main', false);
      },
    },

    // ── 04 · Completion needs evidence ─────────────────────────────────
    {
      id: 'talk-review',
      title: 'Review against the plan',
      watch: 'Review against what landed: 1 landed, 1 partly landed, 2 untouched, and one file no item claimed',
      async run(c) {
        // The line of work brought into the main checkout, not yet committed: the working tree against the last commit.
        try { fx.git('main', 'checkout', SAVE, '--', PREFS_SERVICE, PREFS_ENDPOINT, CLIENT); } catch { c.flag('could not bring the work over from prefs-save: has it been committed?'); }
        fx.git('main', 'reset', '-q');
        await c.call('rescan_project', { project_path: fx.path });
        const review = await c.until(async () => {
          const r = await c.json('review_plan', { plan_uid: c.state.plan, project_path: fx.path });
          return r?.summary?.filesChanged >= 3 ? r : null;
        }, 20, 'the review to see the changed files');
        const s = review?.summary;
        if (review) console.log(`    unclaimed: ${JSON.stringify(review.unclaimedChanges).slice(0, 200)}`);
        if (s) console.log(`    ${s.itemsLanded} landed, ${s.itemsPartial} partly, ${s.itemsUntouched} untouched; ${s.unclaimedCount} unclaimed of ${s.filesChanged} files changed`);
        if (s && (s.itemsLanded !== 1 || s.itemsPartial !== 1 || s.itemsUntouched !== 2 || s.unclaimedCount !== 1)) c.flag(`the review should read 1 landed, 1 partly, 2 untouched and 1 unclaimed; it reads ${JSON.stringify(s)}`);
        await planHome(c);
        await c.beat(1);
        if (recording()) await inWindow({ do: 'scroll', target: { text: 'Review against what landed' }, block: 'start' }, c.flag);
        await c.beat(5);
      },
    },
    {
      id: 'talk-draft',
      title: 'The pull request description, drafted',
      watch: 'Copy PR description: the warnings, then the title and body. Nothing was pushed',
      async run(c) {
        const draft = await c.json('get_pr_draft', { plan_uid: c.state.plan, project_path: fx.path });
        if (!draft?.title) c.flag('get_pr_draft gave no title');
        if (recording()) {
          await inWindow({ do: 'click', target: { text: 'Copy PR description' } }, c.flag);
          await c.beat(0.6);
          await inWindow({ do: 'scroll', target: { text: 'Nothing was pushed' }, block: 'end' });
        }
        await c.beat(4.5);
      },
    },
    {
      id: 'talk-summary',
      title: 'The review, as a whole',
      watch: 'back at the top of the review: the counts, each task\'s verdict, the file nobody claimed',
      async run(c) {
        if (recording()) await inWindow({ do: 'scroll', target: { text: 'Review against what landed' }, block: 'start' });
        await c.beat(4.5);
      },
    },
  ],
};

// ── Part 2 · the same loop, run by a team ─────────────────────────────────

async function setUpTeam(c: Ctx): Promise<void> {
  await open(c, [SAVE, READ, AUDIT]);
  await plan(c, [
    ['Story 1 · Save', [['save', 'Save preferences', [{ path: PREFS_REPO, action: 'modify' }, { path: PREFS_SERVICE, action: 'modify' }, { path: PREFS_ENDPOINT, action: 'create' }]]]],
    ['Story 2 · Read', [['read', 'Read preferences', [{ path: READ_ENDPOINT, action: 'create' }]]]],
    ['Story 3 · Audit', [['audit', 'Audit every change', [{ path: AUDIT_SERVICE, action: 'create' }, { path: AUDIT_REPO, action: 'create' }]]]],
  ]);
  if (!c.state.plan) return;
  await assign(c, [['save', SAVE], ['read', READ], ['audit', AUDIT]]);
}

/** The three sessions, each started in its own worktree. Safe to call twice. */
async function connectTeam(c: Ctx): Promise<{ save: ScriptedMcp; read: ScriptedMcp; audit: ScriptedMcp }> {
  save ??= await c.agent('claude-code', { roots: [fx.trees[SAVE]] });
  read ??= await c.agent('claude-code', { roots: [fx.trees[READ]] });
  audit ??= await c.agent('claude-code', { roots: [fx.trees[AUDIT]] });
  await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
  return { save, read, audit };
}

export const talkTeamGroup: Group = {
  id: 'talk-team',
  title: 'The talk, part 2: the same loop, run by a team',
  setup: setUpTeam,
  scenes: [
    // ── 05 · One epic, three agents, at once ───────────────────────────
    {
      id: 'team-stack',
      title: 'The Stack: three stories, nobody on them yet',
      watch: 'Stack lists Customer preferences with its three stories, each with its line of work and no agent',
      async run(c) {
        await panel(c, 'stack');
        await c.beat(2.5);
      },
    },
    {
      id: 'team-claim',
      title: 'Three sessions, each claims its story',
      watch: 'a chip per worktree appears in the top bar as each session connects; in Stack each story takes its agent',
      async run(c) {
        const team = await connectTeam(c);
        await c.beat(1.2);
        for (const [agent, name] of [[team.save, 'save'], [team.read, 'read'], [team.audit, 'audit']] as const) {
          await claim(c, agent, name);
          await c.beat(0.8);
        }
        const stack = await c.json('get_stack', { project_path: fx.path });
        const held = ((stack?.plans?.[0]?.tasks ?? []) as Array<{ title: string; assignee: string | null }>).filter((t) => t.assignee);
        console.log(`    ${held.length} stories held: ${held.map((t) => `${t.title} (${t.assignee})`).join('; ')}`);
        if (held.length < 3) c.flag(`every story should be held; ${held.length} of 3 are`);
        await c.beat(1);
      },
    },
    {
      id: 'team-lines',
      title: 'Each agent in its own line of work',
      watch: 'the top bar has prefs-save, prefs-read and prefs-audit, each with its agent',
      async run(c) {
        await connectTeam(c);
        await collapsePanel();
        await c.call('navigate_to', { target: 'graph' });
        await c.call('graph_set_depth', { depth: 'file' });
        const seen = await c.until(async () => {
          const body = await c.json('list_workstreams', { project_path: fx.path, include_idle: true });
          const ws: Array<{ agents: unknown[] }> = body?.workstreams ?? [];
          return ws.filter((w) => w.agents.length).length >= 3 ? ws : null;
        }, 15, 'an agent in each of the three lines of work');
        if (seen) console.log(`    ${seen.length} lines of work`);
        await c.beat(2.5);
      },
    },
    {
      id: 'team-claimed',
      title: 'The Stack with every story claimed',
      watch: 'every story in Stack names Claude Code and its branch',
      async run(c) {
        await panel(c, 'stack');
        await c.beat(3.5);
      },
    },

    // ── 06 · Agents that talk to each other ────────────────────────────
    {
      id: 'team-overlap',
      title: 'Two sessions change savePreferences',
      watch: 'one high overlap in Awareness naming savePreferences, prefs-save and prefs-audit',
      async run(c) {
        await connectTeam(c);
        fx.edit(SAVE, PREFS_SERVICE, '  const current = readPreferences(customerId);', VALIDATION);
        await panel(c, 'awareness');
        await c.beat(0.8);
        fx.edit(AUDIT, PREFS_SERVICE, '  return writePreferences({ ...current, ...change });', "  const saved = writePreferences({ ...current, ...change });\n  console.log('audit', customerId, Object.keys(change));\n  return saved;");
        const hit = await c.until(async () => (await signals(c)).find((s) => s.kind === 'collision' && s.subject.symbol === 'savePreferences'), 25, 'the overlap on savePreferences');
        if (!hit) return;
        c.state.overlap = hit.id;
        if (hit.severity !== 'high') c.flag(`the same function in two lines of work should be high; it is ${hit.severity}`);
        console.log(`    ${hit.severity}: ${hit.summary.slice(0, 150)}`);
        await panel(c, 'awareness', { signal_id: hit.id });
        await c.beat(3);
      },
    },
    {
      id: 'team-message',
      title: 'A person messages the agents; one answers',
      watch: 'Message the agents, typed and sent; the card shows it read, and Claude Code in prefs-audit answers that it will put the function back',
      async run(c) {
        const team = await connectTeam(c);
        const id = c.state.overlap;
        if (!id) { c.flag('no overlap to answer'); return; }
        const card = { testid: 'awareness-signal', has: 'savePreferences' };
        let sent = false;
        if (recording()) {
          sent = await inWindow({ do: 'click', target: { testid: 'awareness-message-agents', within: card } }, c.flag)
            && await inWindow({ do: 'type', target: { label: 'Message to the agents' }, text: MESSAGE, delay: 28 }, c.flag);
          await c.beat(0.5);
          sent = sent && await inWindow({ do: 'click', target: { role: 'button', name: 'Send', within: { testid: 'awareness-message-box' } } }, c.flag);
        }
        if (!sent) {
          await c.person({
            ask: `On the savePreferences overlap, choose "Message the agents" and send: ${MESSAGE}`,
            decide: () => c.api(`/api/awareness/${id}/reply?${q()}`, { message: MESSAGE }),
            done: async () => ((await c.api(`/api/awareness?${q()}`))?.signals as Array<{ id: string; replies?: unknown[] }> | undefined)?.find((s) => s.id === id)?.replies?.length,
          });
        }
        await c.beat(1.2);
        // Each agent reads it on its next step, whatever that step is.
        const toldSave = await ordinary(team.save);
        const toldAudit = await ordinary(team.audit);
        if (!toldAudit.includes(MESSAGE)) c.flag('the message did not reach Claude Code in prefs-audit on its next call');
        if (!toldSave.includes(MESSAGE)) c.flag('the message did not reach Claude Code in prefs-save on its next call');
        await c.beat(1.2);
        const ack = await team.audit.callTool('acknowledge_signal', { id, note: NOTE });
        if (ack.isError) c.flag(`acknowledge_signal: ${ack.text.slice(0, 140)}`);
        await panel(c, 'awareness', { signal_id: id });
        await c.beat(3.5);
      },
    },
    {
      id: 'team-adjust',
      title: 'It puts the function back, and the overlap goes',
      watch: 'prefs-audit reverts its edit; the overlap leaves Awareness on its own',
      async run(c) {
        fx.reset(AUDIT);
        await c.until(async () => !(await signals(c)).some((s) => s.kind === 'collision' && s.subject.symbol === 'savePreferences' && s.state !== 'dismissed'), 25, 'the overlap to clear');
        await c.beat(1.5);
        fx.commit(SAVE, 'Validate the language in savePreferences\n\nagent: claude-code');
        // The audit, built the way it said: beside savePreferences, reading the row's shape from the repo.
        fx.write(AUDIT, AUDIT_SERVICE, AUDIT_WRAPPER);
        fx.commit(AUDIT, 'Record each change beside savePreferences\n\nagent: claude-code');
      },
    },

    // ── 07 · "Ask me before you change that" ───────────────────────────
    {
      id: 'team-breakpoint',
      title: 'A breakpoint on the preferences table',
      watch: `${PREFS_REPO} in the reader, then a breakpoint on it`,
      async run(c) {
        await connectTeam(c);
        await reader(c, PREFS_REPO, 1);
        await c.beat(1.2);
        await c.person({
          ask: `Set a breakpoint on ${PREFS_REPO} ("Ask me before this changes").`,
          decide: async () => {
            const bp = await c.api('/api/breakpoints', { kind: 'code', path: PREFS_REPO, note: BREAKPOINT_NOTE });
            if (bp?.breakpoint?.id) c.state.breakpoint = bp.breakpoint.id;
          },
          done: async () => (await runHook(c.opts, fx.trees[SAVE], PREFS_REPO))?.permissionDecision === 'deny',
        });
        if (c.state.breakpoint) c.defer('cleared the breakpoint', () => c.api(`/api/breakpoints/${c.state.breakpoint}`, undefined, 'DELETE'));
      },
    },
    {
      id: 'team-held',
      title: 'The edit is held: Continue, Continue with steer, Stop',
      watch: 'Waiting on you: Claude Code in prefs-save wants to change preferencesRepo.ts; the edit was not made; three choices',
      async run(c) {
        const held = await runHook(c.opts, fx.trees[SAVE], PREFS_REPO);
        const ref = /ref "(bp-[0-9a-f]+)"/.exec(held?.permissionDecisionReason ?? '')?.[1];
        if (!ref || !held?.permissionDecisionReason?.includes('paused: waiting for a decision')) { c.flag(`the hook should pause the edit; it said ${JSON.stringify(held).slice(0, 160)}`); return; }
        c.state.hit = ref;
        await panel(c, 'awareness', { breakpoint_ref: ref });
        if (fs.readFileSync(abs(PREFS_REPO, SAVE), 'utf-8').includes('smsUpdates')) c.flag('a held edit must not be written');
        await c.beat(5);
      },
    },
    {
      id: 'team-steer',
      title: 'Continue with steer, and the agent carries on',
      watch: 'answered with a steer (from the phone, in the video); the card goes; the edit lands: one new field, by claude-code, the validation as it was',
      async run(c) {
        const team = await connectTeam(c);
        const ref = c.state.hit;
        if (!ref) { c.flag('no held edit to answer'); return; }
        // The answer arrives as the phone's would: through the desktop, not typed in this window.
        await c.person({
          ask: `Answer the held edit with "Continue with steer": ${STEER}`,
          decide: () => c.api(`/api/breakpoint-hits/${ref}/answer`, { decision: 'steer', note: STEER }),
          done: async () => JSON.parse((await team.save.callTool('await_decision', { ref, wait_seconds: 2 })).answer)?.status === 'answered',
        });
        await c.beat(1.5);
        const through = await runHook(c.opts, fx.trees[SAVE], PREFS_REPO);
        if (through?.permissionDecision) c.flag(`after the steer the edit should go through; the hook said ${through.permissionDecision}`);
        else if (!(through?.additionalContext ?? '').includes(STEER)) c.flag('the steer did not reach the edit');
        fx.edit(SAVE, PREFS_REPO, '  language: string;\n}', '  language: string;\n  smsUpdates: boolean;\n}');
        fx.edit(SAVE, PREFS_REPO, "emailUpdates: true, language: 'en' };", "emailUpdates: true, language: 'en', smsUpdates: false };");
        fx.commit(SAVE, 'Add smsUpdates to the preferences row\n\nagent: claude-code');
        await c.beat(1);
        // What it wrote, read where the reader can see it: the main checkout, at the line of work's commit.
        await checkOut(c, SAVE);
        const line = fs.readFileSync(abs(PREFS_REPO), 'utf-8').split('\n').findIndex((l) => l.includes('smsUpdates: boolean')) + 1;
        if (!line) c.flag('the new field should be in the committed file');
        if (!fs.readFileSync(abs(PREFS_REPO), 'utf-8').includes("throw new Error('unknown language')")) c.flag('the existing validation should still be there');
        await reader(c, PREFS_REPO, line || 1, { line_history: true });
        await c.beat(5);
        await checkOut(c, 'main', false);
      },
    },
  ],
};
