/**
 * A watchable, repeatable walk through the product.
 *
 * Run it against a running CodeTrellis and watch the window: it opens a
 * project, plans a change from a ticket, does the work, traces it back,
 * asks a question, reviews what landed and drafts the PR — narrating each
 * scene INSIDE the app with a presence card, so you can follow it without
 * reading the terminal.
 *
 * This exists because the bugs that mattered most on this branch were not
 * the ones a green suite would catch. `open_project` returned success
 * having done nothing; the graph rendered while `graph_snapshot` answered
 * empty; a review after a rescan reported that no work had happened. Every
 * one surfaced by driving the app and looking at it. A suite proves the
 * code is consistent with itself; this proves the product does what it
 * says, and it is cheap to re-run when a feature lands.
 *
 *   npm run demo                          # sample fixture, normal pace
 *   npm run demo -- --pace=slow           # pauses long enough to read
 *   npm run demo -- --scene=review        # one scene
 *   npm run demo -- --list                # what scenes exist
 *   npm run demo -- --project=/path/to/repo
 *
 * It needs the app running (packaged or `npm run dev`) with its MCP server
 * up, and the `capture` capability granted if you want it to screenshot.
 * Everything it changes on disk, it changes back.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpClient, type ScriptedMcp } from '../tests/harness/mcp-client';

// ── options ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const PACE = (flag('pace') ?? 'normal') as 'slow' | 'normal' | 'fast';
const BEAT = { slow: 4200, normal: 2400, fast: 900 }[PACE] ?? 2400;
const PROJECT = path.resolve(flag('project') ?? path.join(REPO, 'tests/fixtures/sample-app'));
const DATA_DIR = flag('data-dir') ?? process.env.CODETRELLIS_DATA_DIR ?? path.join(os.homedir(), '.codetrellis');
const MCP_PORT = Number(flag('port') ?? 19432);
const ONLY = flag('scene');
const SHOTS = flag('shots');

// ── plumbing ─────────────────────────────────────────────────────────

interface Ctx {
  call(tool: string, args?: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
  json(tool: string, args?: Record<string, unknown>): Promise<any>;
  /** Narrate in the app itself, and pause long enough to read it. */
  say(title: string, text: string, tone?: 'neutral' | 'success' | 'warning' | 'question'): Promise<void>;
  beat(multiplier?: number): Promise<void>;
  shot(label: string): Promise<void>;
  /** Edit a file; it is restored when the demo ends, however it ends. */
  edit(relative: string, mutate: (src: string) => string): void;
  flag(message: string): void;
  state: Record<string, string>;
}

interface Scene {
  id: string;
  title: string;
  /** Printed before the scene runs: what to look at on screen. */
  watch: string;
  run(ctx: Ctx): Promise<void>;
}

const flagged: string[] = [];
const edited = new Map<string, string>();

// ── the scenes ───────────────────────────────────────────────────────

const SCENES: Scene[] = [
  {
    id: 'orient',
    title: 'Open a codebase and look at it',
    watch: 'the graph fills in, then switches from clusters to files',
    async run(c) {
      await c.say('Opening the project', 'Parsing the codebase and drawing the graph.');
      const opened = await c.call('open_project', { path: PROJECT });
      console.log('   ', opened.text.split('\n')[0].slice(0, 100));
      await c.beat(2);

      await c.call('graph_set_depth', { depth: 'file' });
      await c.beat();
      const xs = await c.json('list_cross_system_edges');
      if (xs?.stats) {
        console.log(`    cross-system: ${xs.stats.callsiteCount} callsites · ${xs.stats.routeCount} routes · ${xs.stats.edgeCount} edges`);
        if (xs.stats.edgeCount === 0) c.flag('cross-system map is empty — nothing paired');
      }
      await c.shot('01-graph');
    },
  },

  {
    id: 'plan',
    title: 'Plan the change from a ticket',
    watch: 'a plan appears with the ticket key in its title',
    async run(c) {
      await c.say('Importing PAY-318', 'The epic and its children become a plan, keeping the ticket key.');
      const imported = await c.json('create_plan_from_external', {
        title: 'Consistent money rounding across services',
        description: 'Amount.Add rounds differently to the reporter and the notifier.',
        external: { url: 'https://acme.atlassian.net/browse/PAY-318', key: 'PAY-318', title: 'Rounding mismatch' },
        items: [
          { title: 'Align rounding in the Go money package' },
          { title: 'Match the reporter to the Go behaviour' },
          { title: 'Notifier should format, not re-round' },
        ],
      });
      c.state.plan = imported?.plan_uid ?? '';
      if (!c.state.plan) { c.flag('ticket import returned no plan'); return; }
      console.log('    plan:', c.state.plan, '·', imported?.items_created, 'items');

      const items = await c.json('list_items', { plan_uid: c.state.plan });
      const list: Array<{ uid: string; title: string }> = Array.isArray(items) ? items : (items?.items ?? []);
      const find = (frag: string) => list.find((i) => i.title.toLowerCase().includes(frag))?.uid ?? '';
      c.state.go = find('go money');
      c.state.cs = find('reporter');
      c.state.rb = find('notifier');

      await c.say('Anchoring the work', 'Each item points at the file it will change — Go, C# and Ruby.');
      for (const [uid, file] of [
        [c.state.go, 'services/shared-go/money/money.go'],
        [c.state.cs, 'services/reporting/Ledger/EntryReader.cs'],
        [c.state.rb, 'services/notifier/app.rb'],
      ] as const) {
        if (uid) await c.call('update_item', { uid, file_specs: [{ path: file, action: 'modify' }] });
      }
      await c.call('open_plan', { plan_uid: c.state.plan });
      await c.beat(2);
      await c.shot('02-plan');
    },
  },

  {
    id: 'budget',
    title: 'Put a ceiling on it',
    watch: 'the budget chip in the plan toolbar',
    async run(c) {
      if (!c.state.plan) return;
      await c.say('Setting a budget', '90 minutes and $5. Advisory — nothing halts an agent, so it has to ask.');
      await c.call('set_budget', { plan_uid: c.state.plan, minutes: 90, cost_usd: 5 });
      const chk = await c.json('check_budget', { plan_uid: c.state.plan });
      console.log('    check_budget:', chk?.state, '—', String(chk?.reason ?? '').slice(0, 60));
      await c.beat();
    },
  },

  {
    id: 'work',
    title: 'Do the work',
    watch: 'the Timeline and the activity feed as the item is claimed and progressed',
    async run(c) {
      if (!c.state.go) return;
      await c.say('Taking the first item', 'Claiming it, then actually changing the file.');
      await c.call('claim_item', { uid: c.state.go });
      await c.beat();
      await c.call('update_item_progress', { uid: c.state.go, percent: 40, message: 'rounding half-up in Amount.Add' });

      c.edit('services/shared-go/money/money.go', (src) => src.replace(
        'func normalise(minor int64) int64 { return minor }',
        '// normalise rounds half-up so every service agrees.\nfunc normalise(minor int64) int64 { return (minor + 1) / 2 * 2 }',
      ));
      console.log('    edited money.go');
      await c.call('rescan_project', { project_path: PROJECT });
      await c.beat(2);
    },
  },

  {
    id: 'terminal',
    title: 'Run something in a terminal you can watch',
    watch: 'the terminal drawer at the bottom',
    async run(c) {
      await c.say('Checking formatting', 'An agent-driven terminal — you see what it runs and what comes back.');
      const t = await c.json('terminal_create', { cwd: PROJECT, title: 'demo', focus: true });
      c.state.term = t?.session_id ?? '';
      if (!c.state.term) { c.flag('terminal_create returned no session_id'); return; }
      await c.call('terminal_write', {
        session_id: c.state.term,
        input: 'gofmt -l services/shared-go/money/ || echo "gofmt clean"\n',
      });
      await c.beat(2);
      const out = await c.call('terminal_read', { session_id: c.state.term, lines: 25 });
      console.log('    terminal:', out.text.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 100));
      await c.shot('03-terminal');
    },
  },

  {
    id: 'trace',
    title: 'Trace the change back to why',
    watch: 'the gutter goes amber on the edited lines, and the overlay names the item and its intent',
    async run(c) {
      await c.say('Reading the change', 'Changed lines are marked, and the plan item that wanted this file is above the source.');
      const abs = path.join(PROJECT, 'services/shared-go/money/money.go');
      await c.call('graph_focus', { path: abs, highlight: true });
      await c.call('graph_select', { paths: [abs] });
      await c.beat(2);
      await c.shot('04-trace');
    },
  },

  {
    id: 'channel',
    title: 'The agent hits a decision it cannot make',
    watch: 'the Channel badge, then the thread',
    async run(c) {
      if (!c.state.plan) return;
      await c.say('Asking rather than guessing', 'Half-up or banker\'s rounding? This changes published totals.', 'question');
      const ev = await c.json('post_channel_event', {
        plan_uid: c.state.plan, item_uid: c.state.go || undefined, event_type: 'need-decision',
        message: 'Half-up or banker’s rounding? The reporter truncates today, so this changes published totals.',
        options: ['half-up (matches finance)', 'banker’s (matches the reporter today)'],
      });
      c.state.event = ev?.uid ?? '';
      if (!c.state.event) c.flag('need-decision did not post');
      await c.call('toggle_panel', { panel: 'channel' });
      await c.beat(2);
      await c.shot('05-channel');
      if (c.state.event) await c.call('resolve_channel_event', { event_uid: c.state.event });
      await c.call('toggle_panel', { panel: 'channel' });
    },
  },

  {
    id: 'review',
    title: 'Did we do what we said?',
    watch: 'one item landed, two still missing — that asymmetry is the point',
    async run(c) {
      if (!c.state.plan) return;
      await c.say('Reviewing the plan', 'One of three files was changed. The review should say so.');
      const rev = await c.json('review_plan', { plan_uid: c.state.plan, project_path: PROJECT });
      const items: Array<{ title: string; verdict: string }> = rev?.items ?? rev?.review?.items ?? [];
      for (const i of items) console.log(`    ${String(i.verdict).padEnd(10)} ${i.title}`);
      const landed = items.filter((i) => i.verdict === 'landed').length;
      console.log(`    → ${landed} landed of ${items.length}`);
      if (items.length > 0 && landed === 0) {
        c.flag('review says nothing landed, but a file was edited — check the default comparand');
      }
      if (landed > 1) c.flag(`review says ${landed} landed; only one file was edited`);
      await c.beat();
    },
  },

  {
    id: 'pr',
    title: 'Draft the pull request',
    watch: 'the ticket key in the title, and the review folded into the body',
    async run(c) {
      if (!c.state.plan) return;
      await c.say('Writing the PR description', 'The ticket and the review travel with it.');
      const pr = await c.json('get_pr_draft', { plan_uid: c.state.plan, project_path: PROJECT });
      const title = pr?.draft?.title ?? pr?.title ?? '';
      const body: string = pr?.draft?.body ?? pr?.body ?? '';
      console.log('    title:', String(title).slice(0, 90));
      if (!body.includes('PAY-318')) c.flag('the PR draft does not carry the ticket it came from');
      await c.beat();
    },
  },

  {
    id: 'compare',
    title: 'What actually moved',
    watch: 'one file modified, not forty',
    async run(c) {
      const list = await c.json('list_comparands', { project_path: PROJECT });
      const commits = (Array.isArray(list) ? list : []).filter((x: { kind: string }) => x.kind === 'commit');
      const before = commits[0]?.spec ?? 'baseline';
      const cmp = await c.json('compare_snapshots', { project_path: PROJECT, before, after: 'live' });
      const d = cmp?.result?.diff?.summary ?? cmp?.diff?.summary;
      if (!d) { c.flag('compare returned no summary'); return; }
      console.log(`    vs ${before}: added ${d.added} · modified ${d.modified} · removed ${d.removed}`);
      if (d.modified > 3) c.flag(`compare says ${d.modified} files modified; the demo edited one`);
      await c.beat();
    },
  },

  {
    id: 'finish',
    title: 'Hand back to the human',
    watch: 'the card with a Got it button — the agent waits for you',
    async run(c) {
      await c.say(
        'Rounding aligned in the Go package',
        'money.go rounds half-up now. The reporter and notifier are still open. Shall I carry on?',
        'question',
      );
      await c.beat(2);
      await c.shot('06-finish');
    },
  },
];

// ── runner ───────────────────────────────────────────────────────────

async function main() {
  if (has('list')) {
    console.log('\nScenes:\n');
    for (const s of SCENES) console.log(`  ${s.id.padEnd(10)} ${s.title}`);
    console.log('\n  npm run demo -- --scene=<id>\n');
    return;
  }

  const tokenPath = path.join(DATA_DIR, 'capability-token');
  if (!fs.existsSync(tokenPath)) {
    console.error(`\nNo capability token at ${tokenPath}.`);
    console.error('Is CodeTrellis running? Point at its data dir with --data-dir=…\n');
    process.exit(1);
  }
  const token = fs.readFileSync(tokenPath, 'utf-8').trim();

  let mcp: ScriptedMcp | null = null;
  try {
    mcp = createMcpClient({ mcpPort: MCP_PORT, capabilityToken: token, clientName: 'codetrellis-demo' });
    await mcp.connect();
  } catch (err) {
    console.error(`\nCould not reach the MCP server on :${MCP_PORT} — is the app running?`);
    console.error(String(err instanceof Error ? err.message : err), '\n');
    process.exit(1);
  }

  const client = mcp;
  await client.callTool('register_session', { agent_type: 'codetrellis-demo', model: 'demo' });

  const ctx: Ctx = {
    state: {},
    flag: (m) => { flagged.push(m); console.log(`    ⚠  ${m}`); },
    beat: (mult = 1) => new Promise((r) => setTimeout(r, BEAT * mult)),
    async call(tool, args = {}) {
      const r = await client.callTool(tool, args);
      if (r.isError) ctx.flag(`${tool}: ${r.text.split('\n')[0].slice(0, 140)}`);
      return { ok: !r.isError, text: r.text };
    },
    async json(tool, args = {}) {
      const r = await ctx.call(tool, args);
      try { return JSON.parse(r.text); } catch { return null; }
    },
    async say(title, text, tone = 'neutral') {
      await client.callTool('present', { title, text, tone }).catch(() => {});
      await ctx.beat();
    },
    async shot(label) {
      if (!SHOTS) return;
      const r = await client.callTool('screenshot', {});
      const img = r.content.find((x) => x.type === 'image') as { data?: string } | undefined;
      if (!img?.data) { ctx.flag(`screenshot "${label}" came back empty — is the capture capability on?`); return; }
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, `${label}.png`), Buffer.from(img.data, 'base64'));
      console.log(`    📸 ${label}`);
    },
    edit(relative, mutate) {
      const abs = path.join(PROJECT, relative);
      if (!edited.has(abs)) edited.set(abs, fs.readFileSync(abs, 'utf-8'));
      fs.writeFileSync(abs, mutate(edited.get(abs)!));
    },
  };

  const scenes = ONLY ? SCENES.filter((s) => s.id === ONLY) : SCENES;
  if (scenes.length === 0) {
    console.error(`\nNo scene called "${ONLY}". Try --list.\n`);
    process.exit(1);
  }

  console.log(`\n  CodeTrellis demo · ${PROJECT}`);
  console.log(`  pace: ${PACE} · scenes: ${scenes.map((s) => s.id).join(', ')}\n`);

  try {
    for (const [i, scene] of scenes.entries()) {
      console.log(`${'─'.repeat(66)}\n${i + 1}. ${scene.title}\n   watch: ${scene.watch}`);
      await scene.run(ctx);
    }
  } finally {
    console.log(`${'─'.repeat(66)}\nTidying up`);
    for (const [abs, original] of edited) {
      fs.writeFileSync(abs, original);
      console.log('   restored', path.relative(PROJECT, abs));
    }
    if (ctx.state.term) await client.callTool('terminal_kill', { session_id: ctx.state.term }).catch(() => {});
    if (ctx.state.plan) {
      await client.callTool('delete_plan', { plan_uid: ctx.state.plan }).catch(() => {});
      console.log('   deleted the demo plan');
    }
    await client.callTool('dismiss_presence', {}).catch(() => {});
    await client.callTool('rescan_project', { project_path: PROJECT }).catch(() => {});
    await client.disconnect().catch(() => {});

    console.log('\n' + '='.repeat(66));
    if (flagged.length === 0) console.log('Nothing looked wrong.');
    else {
      console.log(`${flagged.length} thing(s) worth a look:`);
      flagged.forEach((f, i) => console.log(` ${i + 1}. ${f}`));
    }
    console.log('');
  }
}

main().catch((err) => {
  for (const [abs, original] of edited) fs.writeFileSync(abs, original);
  console.error('\nDemo stopped:', err instanceof Error ? err.message : err);
  console.error('Any edited files were restored.\n');
  process.exit(1);
});
