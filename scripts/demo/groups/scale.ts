/**
 * The product under a real load, for the hero video and anyone evaluating
 * it for a large team: a full plan (phases, two dozen tasks across every
 * service, in every state, with ticket keys, criteria and a gate), three
 * agents claiming and moving its work while their files change, and the map
 * of a large codebase (CodeTrellis itself) instead of the sample app.
 * Recorded by `video/capture/demo.sh scale-smooth --group=scale`.
 * Catalogued in `docs/DEMO-JOURNEYS.md`, section `scale`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ScriptedMcp } from '../../../tests/harness/mcp-client';
import { sampleAppRepo, type ParallelFixture } from '../../demo-fixtures';
import type { Ctx, Group } from '../types';

const LEDGER = 'services/billing/internal/ledger/ledger.go';
const STATEMENTS = 'services/reporting/Services/StatementBuilder.cs';
const RECONCILE = 'services/scheduler/src/main/kotlin/com/acme/scheduler/jobs/ReconcileJob.kt';

let fx: ParallelFixture;
let planUid = '';
let codex: ScriptedMcp;
let claude: ScriptedMcp;
let cursor: ScriptedMcp;
/** The plan's items by the key each was written under. */
const uids: Record<string, string> = {};
let bigRepo = '';

type Status = 'pending' | 'assigned' | 'in_progress' | 'done' | 'blocked' | 'skipped';
interface Row { key: string; kind: 'object' | 'action'; title: string; parent?: string; status?: Status; files?: string[]; body?: string }

/**
 * The plan a payments team would actually run: ledger v2 and a nightly
 * reconciliation, through discovery, the core, every service that reads
 * the ledger, and the rollout. Phases are objects; tasks are actions.
 */
const PLAN: Row[] = [
  { key: 'discovery', kind: 'object', title: 'Discovery and design', status: 'done' },
  { key: 'writers', kind: 'action', parent: 'discovery', title: 'Map every writer of the ledger', status: 'done', files: [LEDGER, 'services/billing/internal/store/store.go'] , body: 'Billing, the orders API and the reconcile job all write entries today; reporting only reads. The store is the one place a write lands.' },
  { key: 'schema', kind: 'action', parent: 'discovery', title: 'Agree the v2 entry schema with Finance', status: 'done', files: ['schema.sql'] , body: 'Finance signed off the v2 schema: entry id, pair id, account, amount in minor units, currency, idempotency key, posted at.' },
  { key: 'design', kind: 'action', parent: 'discovery', title: 'Design note: balanced pairs, idempotent writes', status: 'done',
    body: 'Every movement is two entries that sum to zero. A write carries an idempotency key; a retry is a no-op, never a second charge.' },
  { key: 'core', kind: 'object', title: 'Ledger core', status: 'in_progress' },
  { key: 'pairs', kind: 'action', parent: 'core', title: 'Write entries as balanced pairs', status: 'pending', files: [LEDGER, 'services/billing/internal/ledger/entry.go'] , body: 'Every movement becomes a debit and a credit with the same pair id. A write that cannot produce its pair is rejected, not half-applied.' },
  { key: 'rounding', kind: 'action', parent: 'core', title: 'Half-even rounding in the shared money package', status: 'done', files: ['services/shared-go/money/money.go'] , body: 'Half-even, in one place: shared-go/money. Billing, reporting and the mobile client stop rounding for themselves.' },
  { key: 'migration', kind: 'action', parent: 'core', title: 'Migration 041: ledger entries v2', status: 'in_progress', files: ['db/migrations/040_create_invoice_totals.sql'] , body: 'Adds ledger_entries_v2 beside the old table. Shadow writes fill it; the old table stays the source of truth until cut-over.' },
  { key: 'idempotent', kind: 'action', parent: 'core', title: 'Idempotent writes in the store', status: 'assigned', files: ['services/billing/internal/store/store.go'] , body: 'A retried write with the same key returns the first result. No second charge, whatever the client does.' },
  { key: 'services', kind: 'object', title: 'Services that read the ledger', status: 'in_progress' },
  { key: 'statements', kind: 'action', parent: 'services', title: 'Statements from v2 entries', status: 'pending', files: [STATEMENTS, 'services/reporting/Ledger/EntryReader.cs'] , body: 'Statements read v2 pairs, so a statement always balances. The old reader stays behind a flag until the 30 days are up.' },
  { key: 'reconcile', kind: 'action', parent: 'services', title: 'Nightly reconcile against the bank file', status: 'pending', files: [RECONCILE] , body: 'Every night, compare the day\'s entries with the bank\'s file. Differences go to a queue with the entries that explain them.' },
  { key: 'orders', kind: 'action', parent: 'services', title: 'Orders API writes through billing', status: 'pending', files: ['services/api/app/routes/orders.py'] , body: 'Orders stop writing entries themselves and call billing. Waits on the security review of the new internal endpoint.' },
  { key: 'notify', kind: 'action', parent: 'services', title: 'Statement-ready email', status: 'pending', files: ['services/notifier/lib/channels/email.rb'] , body: 'Customers get one email when a statement is ready, with the period and the closing balance.' },
  { key: 'web', kind: 'action', parent: 'services', title: 'Web: invoice totals from v2', status: 'pending', files: ['packages/web/src/OrderList.tsx'] , body: 'Invoice totals come from v2 entries, not a running sum in the browser.' },
  { key: 'mobile', kind: 'action', parent: 'services', title: 'Mobile: BillingCore reads v2 totals', status: 'pending', files: ['mobile-client/Sources/BillingCore/Invoice.swift'] , body: 'BillingCore reads v2 totals from the API; the app no longer adds up invoice lines on the phone.' },
  { key: 'rollout', kind: 'object', title: 'Verify and roll out', status: 'pending' },
  { key: 'penny', kind: 'action', parent: 'rollout', title: 'Reconciliation matches to the penny for 30 days', status: 'pending' , body: 'Thirty consecutive nightly reconciliations with zero unexplained differences before cut-over.' },
  { key: 'security', kind: 'action', parent: 'rollout', title: 'Security review sign-off', status: 'pending' , body: 'Review of the billing write endpoint and the idempotency store. Blocks the orders change.' },
  { key: 'shadow', kind: 'action', parent: 'rollout', title: 'Shadow-write in production behind a flag', status: 'pending' , body: 'Write v2 alongside v1 in production behind a flag; compare daily; no reads from v2 yet.' },
  { key: 'runbook', kind: 'action', parent: 'rollout', title: 'Cut-over runbook and rollback drill', status: 'pending' , body: 'Cut-over steps, the rollback, and a rehearsal of the rollback before the real thing.' },
];

async function agents(c: Ctx): Promise<void> {
  codex ??= await c.agent('codex', { roots: [fx.trees['ledger-v2']] });
  claude ??= await c.agent('claude-code', { roots: [fx.trees.statements] });
  cursor ??= await c.agent('cursor', { roots: [fx.trees.reconcile] });
}

/** A call made as one agent, failing the scene loudly when it is refused. */
async function as(c: Ctx, agent: ScriptedMcp, tool: string, args: Record<string, unknown>): Promise<void> {
  const r = await agent.callTool(tool, args);
  if (r.isError) c.flag(`${tool} as an agent was refused: ${r.text.slice(0, 160)}`);
}

export const scaleGroup: Group = {
  id: 'scale',
  title: 'The product under a real load',
  async setup(c) {
    // The large codebase for the map: a throwaway clone of CodeTrellis itself.
    // First, and hardlinked (a second, not several): a long quiet gap between
    // two calls is how the first run lost a kept-alive connection.
    bigRepo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-scale-')), 'codetrellis');
    execFileSync('git', ['clone', '-q', '--local', process.cwd(), bigRepo]);
    // On `main`, not whatever branch this checkout happens to be on.
    execFileSync('git', ['-C', bigRepo, 'checkout', '-q', '-B', 'main']);
    // Without the source checkout's own branches, which would show as lines of work.
    execFileSync('git', ['-C', bigRepo, 'remote', 'remove', 'origin']);
    c.defer('removed the large codebase', () => fs.rmSync(path.dirname(bigRepo), { recursive: true, force: true }));
    fx = sampleAppRepo('scale', ['ledger-v2', 'statements', 'reconcile']);
    await c.call('open_project', { path: fx.path });
    await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
    const plan = await c.json('create_plan', {
      title: 'Ledger v2 and daily reconciliation',
      project_path: fx.path,
      description: 'PAY-2140. Move every service onto a double-entry ledger with idempotent writes, and reconcile against the bank file every night. Nothing ships until reconciliation matches to the penny for 30 days.',
    });
    planUid = plan?.uid ?? '';
    if (!planUid) { c.flag('create_plan returned no uid'); return; }
    c.defer('archived the ledger plan', () => c.call('update_plan', { plan_uid: planUid, status: 'archived' }));
    const created = await c.json('bulk_add_items', {
      plan_uid: planUid,
      items: PLAN.map((r) => ({
        _temp_uid: r.key, kind: r.kind, title: r.title, parent_uid: r.parent, status: r.status, body: r.body,
        file_specs: r.files?.map((f) => ({ path: f, action: 'modify' })),
      })),
    });
    const list: Array<{ uid: string; title: string }> = Array.isArray(created) ? created : created?.items ?? [];
    for (const r of PLAN) {
      const hit = list.find((i) => i.title === r.title);
      if (hit) uids[r.key] = hit.uid; else c.flag(`bulk_add_items did not return "${r.title}"`);
    }
    const design = uids.design ? await c.json('get_item', { uid: uids.design }) : null;
    if (!String(design?.body ?? design?.item?.body ?? '').includes('idempotency key')) c.flag(`the design note's body did not stick: ${JSON.stringify(design).slice(0, 200)}`);
    // Tickets, criteria, a gate and a budget: what a team's plan carries.
    for (const [key, n] of [['pairs', 2141], ['migration', 2142], ['statements', 2143], ['reconcile', 2144], ['security', 2149]] as const) {
      if (uids[key]) await c.call('add_external_ref', { item_uid: uids[key], url: `https://tickets.example.test/browse/PAY-${n}`, title: `PAY-${n}` });
    }
    if (uids.penny) await c.call('add_criterion', { item_uid: uids.penny, text: 'Thirty consecutive nightly runs with zero unexplained differences', kind: 'test' });
    if (uids.pairs) await c.call('add_criterion', { item_uid: uids.pairs, text: 'Every entry has a counter-entry; the ledger sums to zero after every write', kind: 'test' });
    await c.call('set_budget', { plan_uid: planUid, minutes: 480 });

  },
  scenes: [
    {
      id: 'full-plan',
      title: 'A plan a whole team runs',
      watch: 'the ledger plan in its workspace: four phases, eighteen tasks, done and in flight and waiting, ticket keys, a budget',
      async run(c) {
        await c.call('open_plan', { plan_uid: planUid });
        await c.call('navigate_to', { target: 'plan', plan_uid: planUid });
        await c.say('One plan, every service', 'Ledger v2 and nightly reconciliation: discovery, the core, every service that reads the ledger, and the rollout. Each task points at the files it will change.');
        for (const key of ['design', 'migration', 'statements', 'penny']) {
          if (uids[key]) await c.call('select_item', { item_uid: uids[key], plan_uid: planUid });
          await c.beat(0.7);
        }
      },
    },
    {
      id: 'in-flight',
      title: 'Three agents moving it at once',
      watch: 'Codex, Claude Code and Cursor claim a task each; their progress and files land in the plan and on the map as they work; the orders task is blocked on security',
      async run(c) {
        await agents(c);
        await c.call('open_plan', { plan_uid: planUid, split_view: true });
        await c.say('Three agents, one plan', 'Each claims a task in its own line of work. You see who has what, how far along it is, and the files it is touching, as it happens.');
        // One change at a time, each given a moment, so a person watching
        // sees it land: the task's status and bar, the Activity feed, the map.
        if (uids.pairs) await c.call('select_item', { item_uid: uids.pairs, plan_uid: planUid });
        await c.beat(0.6);
        await as(c, codex, 'claim_item', { uid: uids.pairs });
        await c.beat(0.8);
        fx.edit('ledger-v2', LEDGER, '// Ledger is an append-only list of entries.', '// Ledger is an append-only list of balanced entry pairs.');
        await as(c, codex, 'update_item_progress', { uid: uids.pairs, percent: 40, message: 'Pairs written; the store still writes singles' });
        await c.beat(0.8);
        await as(c, claude, 'claim_item', { uid: uids.statements });
        await c.beat(0.6);
        fx.edit('statements', STATEMENTS, 'foreach (var entry in _reader.Recent(50))', 'foreach (var entry in _reader.RecentPairs(50))');
        await as(c, claude, 'update_item_progress', { uid: uids.statements, percent: 25, message: 'Reading v2 pairs' });
        await c.beat(0.6);
        await as(c, cursor, 'claim_item', { uid: uids.reconcile });
        await c.beat(0.6);
        fx.edit('reconcile', RECONCILE, 'runs += 1', 'runs += 1\n        // compare against the bank file');
        await as(c, cursor, 'update_item_progress', { uid: uids.reconcile, percent: 15, message: 'Parsing the bank file' });
        await c.beat(0.6);
        await as(c, codex, 'set_item_blocked', { uid: uids.orders, reason: 'Waiting on security review (PAY-2149)' });
        await c.beat(0.6);
        await as(c, codex, 'update_item_progress', { uid: uids.pairs, percent: 70, message: 'Store writes pairs too' });
        await c.beat(1.2);
      },
    },
    {
      id: 'merge-order',
      title: 'How it all stacks up',
      watch: 'the Stack tab: the three lines of work against main and what to merge first; the Timeline with three lanes',
      async run(c) {
        await agents(c);
        await c.call('navigate_to', { target: 'stack' });
        await c.say('What to merge first', 'Every line of work against main, what each one changes, and the order that keeps the ledger whole.');
        await c.beat(1.5);
        await c.call('navigate_to', { target: 'timeline', plan_uid: planUid });
        await c.beat(1.5);
      },
    },
    {
      id: 'big-map',
      title: 'A large codebase, mapped',
      watch: 'CodeTrellis\'s own repository (about 1,800 files) opened and mapped: clusters, then packages, then files',
      async run(c) {
        const opened = await c.call('open_project', { path: bigRepo });
        const files = Number(opened.text.match(/(\d+) files/)?.[1] ?? 0);
        console.log(`    ${opened.text.split('\n')[0].slice(0, 120)}`);
        if (files < 500) c.flag(`the large codebase should map hundreds of files; open_project said "${opened.text.slice(0, 120)}"`);
        // The window scans the project again for itself: wait for its map,
        // not just the server's. With no window (the check) there is none.
        if (c.mode === 'watch') await c.until(async () => {
          // A busy window may not answer one probe; that is a no, not a fault.
          let ready: { scanStatus?: string; graphNodes?: number } | null = null;
          // `refuse` because this call is allowed to fail: `call` would report it.
          try { ready = JSON.parse((await c.refuse('ui_ready', {})).text); } catch { /* not yet */ }
          return ready?.scanStatus === 'ready' && (ready?.graphNodes ?? 0) > 10;
        }, 90, 'the window\'s map of the large codebase');
        await c.call('navigate_to', { target: 'graph' });
        await c.say('However large the codebase', `This is CodeTrellis mapping itself: a desktop app, a server, a phone app and their tools, ${files.toLocaleString('en-GB')} files.`);
        for (const depth of ['package', 'file'] as const) {
          await c.call('graph_set_depth', { depth });
          await c.beat(1.2);
        }
        // Hold the whole map long enough to take in. On a fast machine the
        // scan above takes no time, and the scene was gone (and the map with
        // it) about ten seconds after it opened.
        await c.beat(4);
        await c.call('graph_set_depth', { depth: 'package' });
        await c.call('open_project', { path: fx.path });
      },
    },
  ],
};
