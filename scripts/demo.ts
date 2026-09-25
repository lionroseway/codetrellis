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
 *   npm run demo -- --port=19433 --api-port=3002   # a second instance
 *   npm run demo -- --shots=/tmp/ct-shots          # one PNG per scene
 *   npm run demo -- --scene=brief --approve        # approve for you (dev only)
 *   npm run demo -- --scene=brief --connector=out/connector/mcp-connector.cjs
 *
 * It needs the app running (packaged or `npm run dev`) with its MCP server
 * up, and the `capture` capability granted if you want it to screenshot.
 * Everything it changes on disk, it changes back.
 *
 * If another CodeTrellis is already running, the second one moves off
 * :19432 and :3001 and logs the ports it took. Pass them, or you will
 * authenticate with one process's token and talk to another — which
 * presents as a 401 that looks like a product bug and is not.
 *
 * Every journey is catalogued in `docs/DEMO-JOURNEYS.md`, with what to
 * watch for, the fixtures it needs, and the rules for adding one. Two of
 * them live elsewhere and the catalogue says why: planning by hand is a
 * browser spec (`e2e/plan/plan-by-hand.spec.ts`) because every step is a
 * click, and the upgrade journey is a unit test because it needs a fresh
 * boot, which a script driving a running app cannot arrange.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpClient, type ScriptedMcp } from '../tests/harness/mcp-client';
import {
  repoWithHistory, monorepoPackage, noGitDirectory, repoWithNoCommits,
  repoWithPlanConflict, briefFolder, regionalWorkbook, analysisDocx,
  cleanupFixtures, fixtureRoot,
} from './demo-fixtures';

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
const API_PORT = Number(flag('api-port') ?? 3001);
const ONLY = flag('scene');
const SHOTS = flag('shots');
// The brief scene needs a person to approve in the window: MCP cannot, by
// design. `--approve` stands in for them through the desktop's own HTTP
// route — which a packaged build does not serve, so there it waits.
const APPROVE = has('approve');
const APPROVE_WAIT_S = Number(flag('approve-wait') ?? 180);
// The connector bundle a packaged app ships. Without it, the connector
// runs from source — the same code, against the same running app.
const CONNECTOR = flag('connector');

// ── plumbing ─────────────────────────────────────────────────────────

/** What a shot must see on screen before it is taken. */
interface ShotExpect {
  /** The reader must be RENDERING this file (not merely have it selected). */
  file?: string;
  /** At least one VISIBLE line on the file carries this verdict. */
  verdict?: 'aligned' | 'drifted' | 'outstanding';
  /** A criterion row a person can see, whose text includes `text`, in this state. */
  criterion?: { text: string; state: 'open' | 'submitted' | 'met' | 'sent_back' | 'stale' };
  /** The recorded-file viewer is showing a file whose name ends with this. */
  artefact?: string;
}

/** An agent connected the way Claude Desktop is: through the stdio connector. */
interface Bridge {
  call(tool: string, args?: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
  json(tool: string, args?: Record<string, unknown>): Promise<any>;
}

interface Ctx {
  call(tool: string, args?: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
  json(tool: string, args?: Record<string, unknown>): Promise<any>;
  /** Narrate in the app itself, and pause long enough to read it. */
  say(title: string, text: string, tone?: 'neutral' | 'success' | 'warning' | 'question'): Promise<void>;
  beat(multiplier?: number): Promise<void>;
  /**
   * Capture the window — but only once it shows what the shot claims to.
   *
   * A screenshot that cannot say what it is a picture of is not evidence:
   * this scene once captured `app.rb` under a caption claiming it showed
   * `money.go`, and nothing anywhere disagreed. So a shot names its
   * subject (`ShotExpect`), waits for `ui_ready` to report it on screen,
   * and is flagged and not saved when it never is — an image of the wrong
   * thing is worse than no image.
   */
  shot(label: string, expect?: ShotExpect): Promise<void>;
  /** Edit a file; it is restored when the demo ends, however it ends. */
  edit(relative: string, mutate: (src: string) => string): void;
  /** A second (third…) connected agent, for contention journeys. */
  agent(name: string): Promise<ScriptedMcp>;
  /**
   * Read an HTTP endpoint the way the UI does — same token, same route.
   * Some journeys are about what a panel is shown, and the panel does not
   * go through MCP.
   */
  api(pathAndQuery: string, body?: unknown): Promise<any>;
  /** Connect an agent through the stdio connector, as a person's own agent would. */
  bridge(clientName: string): Promise<Bridge>;
  /**
   * A call that SHOULD be refused. Same as `call`, but a refusal is the
   * pass and is not flagged — otherwise the refusal journey reports the
   * product working correctly as a defect.
   */
  refuse(tool: string, args?: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
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
const extraAgents: ScriptedMcp[] = [];
const bridges: Client[] = [];

const collapse = (text: string, n = 220) => text.replace(/\s+/g, ' ').trim().slice(0, n);

/** What `ui_ready` says is on screen, in the terms a shot can ask for. */
interface Seen {
  openFile: string | null;
  marks: Record<string, number>;
  criteria: Array<{ text: string; state: string }>;
  artefact: string | null;
}

function seenFrom(text: string): Seen {
  try {
    const parsed = JSON.parse(text);
    return {
      openFile: parsed.openFile ?? null,
      // Visible marks only. Counting what is merely in the DOM let a shot
      // pass whose aligned lines were under the terminal drawer.
      marks: parsed.visibleVerdicts ?? {},
      criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [],
      artefact: parsed.openArtefact?.name ?? null,
    };
  } catch {
    return { openFile: null, marks: {}, criteria: [], artefact: null };
  }
}

function meets(want: ShotExpect, seen: Seen): boolean {
  if (want.file && !(seen.openFile?.endsWith(want.file) ?? false)) return false;
  if (want.verdict && !((seen.marks[want.verdict] ?? 0) > 0)) return false;
  if (want.criterion && !seen.criteria.some((c) => c.text.includes(want.criterion!.text) && c.state === want.criterion!.state)) return false;
  if (want.artefact && !(seen.artefact?.endsWith(want.artefact) ?? false)) return false;
  return true;
}

function describeWant(want: ShotExpect): string {
  const parts: string[] = [];
  if (want.file || want.verdict) parts.push(`${want.file ?? 'any file'}${want.verdict ? ` with ${want.verdict} lines` : ''}`);
  if (want.criterion) parts.push(`the criterion "${want.criterion.text}" ${want.criterion.state}`);
  if (want.artefact) parts.push(`${want.artefact} in the viewer`);
  return parts.join(' and ');
}

function describeSeen(want: ShotExpect, seen: Seen): string {
  const parts: string[] = [];
  if (want.file || want.verdict) {
    const marks = Object.entries(seen.marks).map(([k, n]) => `${n} ${k}`).join(', ') || 'no VISIBLE marked lines';
    parts.push(`${seen.openFile ?? 'no file'} with ${marks}`);
  }
  if (want.criterion) {
    parts.push(seen.criteria.length
      ? `criteria ${seen.criteria.map((c) => `"${collapse(c.text, 40)}" ${c.state}`).join(', ')}`
      : 'no criteria visible');
  }
  if (want.artefact) parts.push(seen.artefact ? `${seen.artefact} in the viewer` : 'no file in the viewer');
  return parts.join('; ');
}

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

      // Show it, use it, put it away — the drawer is a place you visit,
      // not somewhere you live.
      await c.say('Putting it away', 'Hiding the drawer must not kill the session. Killing it should.');
      await c.call('toggle_panel', { panel: 'terminal' });
      await c.beat();
      const alive = await c.json('terminal_list', { alive_only: true });
      const stillThere = JSON.stringify(alive).includes(c.state.term);
      console.log('    session survives hiding the drawer:', stillThere ? 'yes' : 'NO');
      if (!stillThere) c.flag('hiding the terminal drawer killed the session');
      // And it stays away. This used to toggle straight back, which
      // contradicted the narration two lines above and left the drawer
      // covering the bottom half of every later scene — including the
      // one whose whole point is the gutter, which then sat below the
      // fold in every screenshot.
    },
  },

  {
    id: 'trace',
    title: 'Trace the change back to why',
    watch: 'the gutter goes amber on the edited lines, and the overlay names the item and its intent',
    async run(c) {
      await c.say('Reading the change', 'Changed lines are marked, and the plan item that wanted this file is above the source.');
      const abs = path.join(PROJECT, 'services/shared-go/money/money.go');
      await c.call('navigate_to', { target: 'code', file_path: abs, line: 25 });
      await c.beat(2);
      await c.shot('04-trace', { file: 'services/shared-go/money/money.go', verdict: 'aligned' });
    },
  },

  {
    id: 'verdict',
    title: 'Planned, drifted, outstanding — one answer per line',
    watch: 'three different gutter marks in one file: ✓ aligned, ◆ drifted, ◇ still outstanding',
    async run(c) {
      if (!c.state.plan) return;
      await c.say(
        'What the plan wanted, and what actually happened',
        'Green where they agree. Pink where something changed that no item asked for. Hollow where the plan is still waiting.',
      );

      // An edit nobody planned, in a file no item targets — drift, by
      // construction rather than by luck.
      // A file NO item targets. This used to be `services/notifier/app.rb`,
      // described as untargeted — but the plan's third item targets exactly
      // that file, so once file-level claims counted (514c70f) the edit
      // correctly read as aligned, and the scene's own shot check refused
      // to photograph "drift" that was not there.
      c.edit('services/api/app/config.py', (src) => `${src}\n# demo: unplanned tweak\n`);
      const unplanned = path.join(PROJECT, 'services/api/app/config.py');
      await c.call('navigate_to', { target: 'code', file_path: unplanned, line: 9 });
      await c.beat(2);
      console.log('    unplanned edit in config.py — expect ◆ drifted');
      await c.shot('14-verdict-drift', { file: 'services/api/app/config.py', verdict: 'drifted' });

      // The Go file was edited in `work` AND is targeted by an item.
      const planned = path.join(PROJECT, 'services/shared-go/money/money.go');
      await c.say('The same file, from the other side', 'This one was planned and it happened, so it reads as aligned.');
      // Scroll to where the change actually is, not to line 1.
      await c.call('navigate_to', { target: 'code', file_path: planned, line: 25 });
      await c.beat(2);
      // Assert the precondition the screenshot depends on.
      //
      // A shot of a file with no changed lines proves nothing, and that
      // is exactly what this scene produced for a whole session after the
      // fixture drifted: a correctly rendered file with nothing to render,
      // captioned as proof that the verdict worked.
      const onDisk = fs.readFileSync(planned, 'utf-8');
      const original = edited.get(planned);
      if (original === undefined || onDisk === original) {
        c.flag('money.go is unchanged — the aligned screenshot would show an unmarked file');
      } else {
        console.log('    money.go differs from its pre-edit state — the gutter should mark it');
      }
      console.log('    planned + changed in money.go — expect ✓ aligned');
      await c.shot('15-verdict-aligned', { file: 'services/shared-go/money/money.go', verdict: 'aligned' });
    },
  },

  {
    id: 'roundtrip',
    title: 'Follow the trace, and come back',
    watch: 'the plan header grows a back button naming the file — click it and you land on the same line',
    async run(c) {
      if (!c.state.go) return;
      await c.say(
        'Code to the item and back again',
        'Following "this item wants this file" used to cost you your place. The header now carries the way back.',
      );
      const abs = path.join(PROJECT, 'services/shared-go/money/money.go');
      await c.call('navigate_to', { target: 'code', file_path: abs, line: 25 });
      await c.beat(2);
      // The file, with the marker naming the item — this is the half a
      // screenshot can actually show.
      await c.shot('16a-roundtrip-from-code', { file: 'services/shared-go/money/money.go', verdict: 'aligned' });

      // `select_item` is NOT the journey. It jumps to the item without
      // going through the code reader's banner, so no breadcrumb is left
      // and the header grows no way back — which is exactly what the
      // first screenshot of this scene proved, while the caption claimed
      // otherwise.
      //
      // The real path is a click on "…wants this file", and it is covered
      // by `e2e/review-regressions/round-trip.spec.ts`, which drives that
      // button and fails when the back control is reverted. A demo scene
      // cannot click it, so it says so rather than implying it did.
      await c.say(
        'The way back',
        'Clicking "wants this file" leaves a breadcrumb, so the plan header carries a way back to the line. That click is covered by the round-trip spec.',
      );
      await c.call('select_item', { item_uid: c.state.go });
      await c.beat(2);
      console.log('    on the item (via select_item — no breadcrumb; the click path is in round-trip.spec.ts)');
      await c.shot('16b-roundtrip-on-item');
    },
  },

  {
    id: 'colleague',
    title: 'Review work that is not yours',
    watch: 'a review against a branch, not the working tree',
    async run(c) {
      if (!c.state.plan) return;
      await c.say(
        'Someone else’s branch',
        'The comparison does not care whose work it is. Any ref the repo can resolve is a comparand.',
      );
      const comparands = await c.json('list_comparands', { project_path: PROJECT });
      const list: Array<{ spec?: string; kind?: string }> =
        Array.isArray(comparands) ? comparands : (comparands?.comparands ?? []);
      const offered = new Set(list.map((x) => x.spec));

      // A named branch rather than one of the offered commits — the point
      // is that a ref nobody listed still works.
      const ref = 'commit:main';
      console.log('    picker offered', list.length, 'comparands ·', offered.has(ref) ? 'including' : 'NOT including', ref);
      const r = await c.json('review_plan', {
        plan_uid: c.state.plan, project_path: PROJECT, before: ref, after: 'live',
      });
      if (!r) { c.flag(`reviewing against ${ref} returned nothing`); return; }
      const sm = r.summary ?? {};
      console.log(`    vs ${ref}: ${sm.itemsLanded ?? '?'} landed · ${sm.filesChanged ?? '?'} files · ${sm.unclaimedCount ?? '?'} unclaimed`);
      if (!offered.has(ref)) {
        console.log('    ↑ accepted a ref the picker never listed — capability is ahead of its disclosure');
      }
      await c.beat();
      await c.shot('17-colleague');
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
    watch: 'the items whose files were touched read landed; the rest read untouched',
    async run(c) {
      if (!c.state.plan) return;

      // Derive the expectation from what this run actually touched.
      //
      // This used to assert "only one file was edited" as a literal, and
      // then I added a scene that edits a second one. The review started
      // reporting two landed — correctly — and the flag called it
      // over-counting. The review was right and the flag had gone stale
      // the moment a later scene changed the premise.
      //
      // Third time a flag has lied in this file. A flag that hard-codes a
      // number is a fact about the script at the moment it was written,
      // not about the product, and it decays silently.
      const changedHere = [...edited.keys()].map((abs) => path.relative(PROJECT, abs));
      await c.say(
        'Reviewing the plan',
        `${changedHere.length} of three files changed so far. The review should say which.`,
      );

      const rev = await c.json('review_plan', { plan_uid: c.state.plan, project_path: PROJECT });
      const items: Array<{ title: string; verdict: string; landed?: string[] }> =
        rev?.items ?? rev?.review?.items ?? [];
      for (const i of items) console.log(`    ${String(i.verdict).padEnd(10)} ${i.title}`);

      const landed = items.filter((i) => i.verdict === 'landed');
      console.log(`    → ${landed.length} landed of ${items.length}`);
      console.log(`    edited this run: ${changedHere.join(', ') || 'nothing'}`);

      if (items.length > 0 && changedHere.length > 0 && landed.length === 0) {
        c.flag('review says nothing landed, but files were edited — check the default comparand');
      }

      // The invariant that cannot go stale: an item reads landed only if
      // a file this run actually touched is among its landed targets.
      for (const item of landed) {
        const claimed = item.landed ?? [];
        const real = claimed.some((t) => changedHere.some((f) => f.endsWith(t) || t.endsWith(f)));
        if (!real) {
          c.flag(`"${item.title}" reads landed, but nothing this run edited is among its targets`);
        }
      }
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
    id: 'graph',
    title: 'Explore the graph properly',
    watch: 'depth changes, a file focuses into its symbols, then the scope narrows to one service',
    async run(c) {
      await c.say('Reading the architecture', 'Clusters group what people talk about. Files show imports. Symbols open a file up.');
      for (const depth of ['package', 'file', 'symbol'] as const) {
        await c.call('graph_set_depth', { depth });
        await c.beat();
      }

      await c.say('Focusing one file', 'Focus mode is where symbols appear — a file opened into its functions and types.');
      const abs = path.join(PROJECT, 'services/shared-go/money/money.go');
      await c.call('graph_focus', { path: abs, highlight: true });
      await c.beat(2);

      const snap = await c.json('graph_snapshot');
      const n = snap?.nodeCount ?? snap?.nodes?.length ?? 0;
      console.log(`    graph_snapshot: ${n} nodes`);
      if (n === 0) {
        // Do not assert what has not been checked.
        //
        // This used to flag "an empty graph WHILE THE CANVAS IS DRAWING
        // ONE", and it had no idea whether the canvas was drawing
        // anything. Chased as a snapshot bug, it turned out the canvas
        // really was blank — the tool was right and the flag was the
        // thing lying. A wrong flag costs more attention than a missing
        // one, and it sends you to the wrong file.
        c.flag('graph_snapshot returned 0 nodes — check whether the canvas is actually drawing a graph');
      }

      await c.say('Narrowing the scope', 'One service at a time, when the whole estate is too much.');
      await c.call('graph_set_scope', { scope_path: path.join(PROJECT, 'services') });
      await c.beat();
      await c.shot('07-graph-scoped');
      await c.call('graph_set_scope', { scope_path: PROJECT });
      await c.call('graph_set_depth', { depth: 'file' });
    },
  },

  {
    id: 'blocked',
    title: 'An agent gets blocked, and a human unblocks it',
    watch: 'the item goes visibly blocked with a reason, then resumes — not a silent stall',
    async run(c) {
      if (!c.state.cs) return;
      await c.say('Hitting something it cannot decide', 'The reporter truncates. Changing it moves published totals.', 'warning');
      await c.call('claim_item', { uid: c.state.cs });
      await c.call('set_item_blocked', { uid: c.state.cs, reason: 'Needs sign-off: changing this moves published totals.' });
      const ev = await c.json('post_channel_event', {
        plan_uid: c.state.plan, item_uid: c.state.cs, event_type: 'stuck',
        message: 'Blocked on the reporter — changing rounding here restates figures we have already published.',
        attempted: ['matched the Go behaviour locally', 'checked the reporter tests'],
      });
      await c.beat(2);

      const blocked = await c.json('get_item', { uid: c.state.cs });
      const isBlocked = Boolean(blocked?.blockedReason ?? blocked?.blocked_reason);
      console.log('    item reports blocked:', isBlocked ? 'yes' : 'NO');
      if (!isBlocked) c.flag('set_item_blocked did not leave a visible reason on the item');
      await c.shot('08-blocked');

      await c.say('The human answers', 'Finance signed it off — half-up. Carry on.', 'success');
      if (ev?.uid) await c.call('resolve_channel_event', { event_uid: ev.uid });
      await c.call('set_item_blocked', { uid: c.state.cs, reason: '' });
      const after = await c.json('get_item', { uid: c.state.cs });
      const stillBlocked = Boolean(after?.blockedReason ?? after?.blocked_reason);
      console.log('    unblocked:', stillBlocked ? 'NO — still blocked' : 'yes');
      if (stillBlocked) c.flag('clearing the reason did not unblock the item');
      await c.beat();
    },
  },

  {
    id: 'agents',
    title: 'Two agents on one plan',
    watch: 'the second agent gets a different item — not the one the first just claimed',
    async run(c) {
      if (!c.state.plan) return;
      await c.say('A second agent connects', 'Both want work. Claiming is atomic, so they must not collide.');
      const second = await c.agent('claude-code-2');

      const askFirst = await c.json('get_next_item', { plan_uid: c.state.plan });
      const firstUid = askFirst?.uid ?? '';
      if (firstUid) await c.call('claim_item', { uid: firstUid });

      const r = await second.callTool('get_next_item', { plan_uid: c.state.plan });
      let secondUid = '';
      try { secondUid = JSON.parse(r.text)?.uid ?? ''; } catch { /* may be empty */ }

      console.log('    agent 1 claimed:', firstUid.slice(0, 8) || '(none)');
      console.log('    agent 2 offered:', secondUid.slice(0, 8) || '(nothing left)');
      if (firstUid && secondUid && firstUid === secondUid) {
        c.flag('both agents were offered the same item — claiming is not exclusive');
      }

      const dup = await second.callTool('claim_item', { uid: firstUid });
      const refused = dup.isError || /already|claimed/i.test(dup.text);
      console.log('    second claim on the same item refused:', refused ? 'yes' : 'NO');
      if (firstUid && !refused) c.flag('a claimed item was claimed again by another agent');
      await c.beat();
      await c.shot('09-two-agents');
    },
  },

  {
    id: 'docs',
    title: 'Write the architecture down, and watch it go stale',
    watch: 'a doc appears in Docs, then freshness reports it drifting once the code moves',
    async run(c) {
      await c.say('Writing a system doc', 'The written architecture lives with the code, and is checked against it.');
      const doc = await c.json('write_system_doc', {
        project_path: PROJECT,
        title: 'Money rounding',
        body: '# Money rounding\n\nAll services round half-up via `Amount.Add` in the Go money package.\n',
      });
      c.state.doc = doc?.uid ?? doc?.doc?.uid ?? '';
      const listed = await c.json('list_system_docs', { project_path: PROJECT });
      const count = Array.isArray(listed) ? listed.length : (listed?.docs?.length ?? 0);
      console.log('    system docs:', count);
      if (count === 0) c.flag('the doc was written but does not list');
      await c.call('navigate_to', { target: 'graph' });
      await c.beat();

      if (!c.state.doc) c.flag('write_system_doc returned no uid');
      // The doc is a file in the repo. Leaving it behind is not cosmetic:
      // three stray copies under `.codetrellis/docs/` made a harness test
      // that asserts "exactly one system doc" fail three runs in a row,
      // looking exactly like a product regression.

      const fresh = c.state.doc ? await c.json('check_doc_freshness', { uid: c.state.doc }) : null;
      console.log('    freshness:', JSON.stringify(fresh).slice(0, 110));
      await c.shot('10-docs');
    },
  },

  {
    id: 'drift',
    title: 'Where reality moved away from the plan',
    watch: 'drift reported as information, not as a blocker',
    async run(c) {
      if (!c.state.plan) return;
      await c.say('Checking drift', 'Two items are still open and one file changed. That gap is the report.');
      const drift = await c.json('get_drift_report', { plan_uid: c.state.plan });
      console.log('    drift:', JSON.stringify(drift).slice(0, 160));
      const dev = await c.json('detect_deviations', { plan_uid: c.state.plan });
      console.log('    deviations:', JSON.stringify(dev).slice(0, 110));
      await c.beat();
    },
  },

  {
    id: 'refusal',
    title: 'An agent asks for something it does not hold',
    watch: 'the refusal names the capability and where to grant it',
    async run(c) {
      await c.say('Asking for a project that is not open', 'Path-taking tools are confined to projects you opened.', 'warning');
      const r = await c.refuse('review_plan', { plan_uid: c.state.plan || 'x', project_path: '/etc' });
      if (r.ok) c.flag('/etc was accepted as a project path');
      else {
        const legible = /not open/i.test(r.text) && /Settings/i.test(r.text);
        console.log('    refusal is actionable:', legible ? 'yes' : 'NO');
        if (!legible) c.flag('the refusal does not say how to proceed');
      }
      await c.beat();
    },
  },

  {
    id: 'history',
    title: 'Come back to it a day later, on a branch with other work in it',
    watch: 'the comparand list offers commits, and review against one differs from review against the tree',
    async run(c) {
      const fixture = repoWithHistory();
      await c.say(
        'A repo with history',
        'Three commits, one of them somebody else’s, and uncommitted work on top. "What landed?" now has more than one answer.',
      );
      await c.call('open_project', { path: fixture.path });
      await c.beat();

      const comparands = await c.json('list_comparands', { project_path: fixture.path });
      const list: Array<{ spec?: string; kind?: string; label?: string }> =
        Array.isArray(comparands) ? comparands : (comparands?.comparands ?? []);
      const kinds = new Set(list.map((x) => x.kind).filter(Boolean));
      console.log(`    comparands: ${list.length} · kinds: ${[...kinds].join(', ') || 'none'}`);
      if (!kinds.has('commit')) c.flag('the comparand picker offered no commits on a repo with three');
      if (!kinds.has('live')) c.flag('the comparand picker did not offer the working tree');

      const plan = await c.json('create_plan', {
        title: 'Round money consistently (history)',
        description: 'Planned before the branch moved on.',
        project_path: fixture.path,
      });
      const planUid = plan?.uid ?? plan?.plan_uid ?? '';
      if (!planUid) { c.flag('could not create a plan against the history fixture'); return; }
      c.state.historyPlan = planUid;
      c.state.historyRepo = fixture.path;

      await c.call('add_item', {
        plan_uid: planUid, kind: 'action', title: 'Round in the Go money package',
        file_specs: [{ path: 'src/money.go', action: 'modify' }],
      });
      await c.call('add_item', {
        plan_uid: planUid, kind: 'action', title: 'Round in the Python report',
        file_specs: [{ path: 'src/report.py', action: 'modify' }],
      });

      await c.say(
        'Against the working tree, then against a commit',
        'The same plan, two questions. One asks what is different right now; the other asks what has happened since a point you choose.',
      );

      const live = await c.json('review_plan', {
        plan_uid: planUid, project_path: fixture.path, before: 'baseline', after: 'live',
      });
      // Use what the picker offered, verbatim. A journey that invents its
      // own identifier tests the journey's guess rather than the product:
      // comparands are `commit:<short-sha>`, and a bare SHA is refused.
      const olderEntry = list.filter((x) => x.kind === 'commit')[1] ?? list.find((x) => x.kind === 'commit');
      const older = olderEntry?.spec ?? 'baseline';
      const sinceCommit = await c.json('review_plan', {
        plan_uid: planUid, project_path: fixture.path, before: older, after: 'live',
      });

      const summarise = (r: any) => {
        if (!r) return 'no answer';
        const sm = r.summary ?? {};
        return `${sm.itemsLanded ?? '?'} landed · ${sm.itemsPartial ?? '?'} partial · ${sm.itemsUntouched ?? '?'} untouched`
          + ` · ${sm.filesChanged ?? '?'} files · ${sm.unclaimedCount ?? (r.unclaimedChanges?.length ?? '?')} unclaimed`;
      };
      console.log('    vs working tree :', summarise(live));
      console.log(`    vs ${older.padEnd(16)}:`, summarise(sinceCommit));

      if (JSON.stringify(live) === JSON.stringify(sinceCommit)) {
        c.flag('reviewing against a commit gave exactly the working-tree answer — the comparand was ignored');
      }

      const unclaimed: string[] = sinceCommit?.unclaimedChanges ?? [];
      const names = unclaimed.join(', ');
      console.log('    unclaimed since that commit:', names || 'none');
      if (!names.includes('notify.rb')) {
        c.flag('notify.rb landed after that commit and is in no plan item, but review did not surface it');
      }
      await c.shot('11-history');
    },
  },

  {
    id: 'scoping',
    title: 'A package inside a bigger repo',
    watch: 'the changes list shows the package’s own work, not the monorepo’s',
    async run(c) {
      const { repo, project } = monorepoPackage();
      await c.say(
        'Opening one package of a monorepo',
        'Two sibling packages have uncommitted work. None of it belongs to the one you opened.',
      );
      await c.call('open_project', { path: project });
      await c.beat();

      const status = await c.api(`/api/git/status?path=${encodeURIComponent(project)}`);
      const files: string[] = [
        ...(status?.unstaged ?? []), ...(status?.staged ?? []), ...(status?.untracked ?? []),
      ].map((f: any) => (typeof f === 'string' ? f : f.path ?? f.file));
      console.log('    changed, as the panel sees it:', files.length ? files.join(', ') : 'none');
      const leaked = files.filter((f) => f.includes('billing') || f.includes('tools/'));
      if (leaked.length) c.flag(`the parent repo's files leaked into the package: ${leaked.join(', ')}`);
      console.log('    (the repo root has 2 modified files; the package has 0)');
      void repo;
      await c.shot('12-scoping');
    },
  },

  {
    id: 'degrade',
    title: 'No git, or no commits yet',
    watch: 'both states answer honestly instead of erroring or inventing a comparand',
    async run(c) {
      const bare = noGitDirectory();
      await c.say('A directory with no git in it', 'There is nothing to compare against. Saying so is the correct answer.');
      await c.call('open_project', { path: bare });
      const noGit = await c.json('list_comparands', { project_path: bare });
      const noGitList: any[] = Array.isArray(noGit) ? noGit : (noGit?.comparands ?? []);
      console.log('    no-git comparands:', noGitList.map((x) => x.kind ?? x.id).join(', ') || 'none');
      if (noGitList.some((x) => x.kind === 'commit')) c.flag('commits were offered for a directory with no git');

      const fresh = repoWithNoCommits();
      await c.say('A repo on its first day', 'Initialised, nothing committed. Also a real state, and also not an error.');
      await c.call('open_project', { path: fresh });
      const noCommits = await c.json('list_comparands', { project_path: fresh });
      const freshList: any[] = Array.isArray(noCommits) ? noCommits : (noCommits?.comparands ?? []);
      console.log('    no-commits comparands:', freshList.map((x) => x.kind ?? x.id).join(', ') || 'none');
      if (freshList.some((x) => x.kind === 'commit')) c.flag('commits were offered for a repo with no commits');
      if (freshList.length === 0) c.flag('a fresh repo offered nothing at all — not even the working tree');
      await c.beat();
    },
  },

  {
    id: 'conflict',
    title: 'Two people planned on two branches',
    watch: 'the conflict is named per field, and resolving it leaves valid YAML rather than markers',
    async run(c) {
      const fixture = repoWithPlanConflict();
      await c.say(
        'A plan that conflicts',
        'Plans are files in the repo, so two branches planning at once conflict like any other file. Resolving that by hand-editing markers is what this avoids.',
        'warning',
      );
      await c.call('open_project', { path: fixture.path });
      await c.beat();

      const found = await c.json('detect_conflicts', { project_path: fixture.path });
      const conflicted: any[] = found?.files ?? found?.conflicts ?? (Array.isArray(found) ? found : []);
      console.log('    conflicted manifests:', conflicted.length);
      if (conflicted.length === 0) {
        c.flag('a repo left mid-merge with a conflicted plan manifest reported no conflicts');
        return;
      }
      console.log('    ', JSON.stringify(conflicted[0]).slice(0, 180));

      await c.say('Taking one side', 'Whole-side is the blunt resolution; the per-field one is in the panel.');
      const resolved = await c.call('resolve_conflict', {
        project_path: fixture.path,
        file_path: fixture.manifest,
        mode: 'by_side',
        side: 'theirs',
      });
      if (!resolved.ok) return;

      const after = fs.readFileSync(path.join(fixture.path, fixture.manifest), 'utf-8');
      if (/^<{7}|^={7}|^>{7}/m.test(after)) c.flag('conflict markers survived the resolution');
      if (!/title:/.test(after)) c.flag('the resolved manifest lost its fields');
      console.log('    resolved to:', after.split('\n').filter(Boolean).join(' · '));

      const still = await c.json('detect_conflicts', { project_path: fixture.path });
      const left: any[] = still?.files ?? still?.conflicts ?? (Array.isArray(still) ? still : []);
      if (left.length !== 0) c.flag('the file still reports as conflicted after being resolved');
      await c.shot('13-conflict');
    },
  },

  {
    id: 'brief',
    title: 'A brief with no code in it',
    watch: 'the Brief on "Analyse": its criterion goes waiting → approved → stale when the spreadsheet changes',
    async run(c) {
      const folder = briefFolder();
      const abs = (rel: string) => path.join(folder.path, rel);
      const cite = `${folder.cited.sheet}!${folder.cited.range}`;
      await c.say(
        'Work that is not code',
        'A folder with a spreadsheet and a guide in it — no git, no source. The same loop: a brief, evidence, and a person signing it off.',
      );
      if (!(await c.call('open_project', { path: folder.path })).ok) return;

      const made = await c.json('create_plan_from_template', {
        template_id: 'analysis-report',
        project_path: folder.path,
        placeholder_values: { report: 'Regional review', period: 'Q3' },
      });
      const planUid: string | undefined = made?.plan?.uid;
      if (!planUid) { c.flag('the analysis-report playbook made no plan'); return; }
      c.state.briefPlan = planUid;
      const items: Array<{ uid: string; title: string }> = (await c.json('list_items', { plan_uid: planUid }))?.items ?? [];
      const analyse = items.find((i) => i.title === 'Analyse');
      if (!analyse) { c.flag(`the playbook has no "Analyse" step — it has ${items.map((i) => i.title).join(', ')}`); return; }

      // What a person hands over: the data, and how the team writes it up.
      const workbook = await c.json('record_artefact', { item_uid: analyse.uid, path: folder.workbook, role: 'material', note: 'Q3 figures by region' });
      await c.json('record_artefact', { item_uid: analyse.uid, path: folder.guide, role: 'material', note: 'How we write the review' });
      if (!workbook?.attachment_uid) return;
      await c.call('navigate_to', { target: 'brief', plan_uid: planUid, item_uid: analyse.uid });

      // The agent, connected the way Claude Desktop connects: through the
      // stdio connector, as `claude-ai`. Everything from here is its work.
      const agent = await c.bridge('claude-ai');
      await c.say('An agent picks it up', 'Connected through the bridge, the way Claude Desktop is. It starts where any agent should: the brief.');
      const brief = await agent.json('get_brief', { item_uid: analyse.uid });
      if (!brief) return;
      console.log(`    brief: ${brief.item?.title} · ${brief.guide?.length ?? 0} guide page(s) · ${brief.materials?.length ?? 0} material(s) · ${brief.criteria?.length ?? 0} criteria`);
      const criterion = (brief.criteria ?? []).find((x: { kind: string }) => x.kind === 'citation');
      if (!criterion) { c.flag('the Analyse step carries no citation criterion'); return; }
      if (criterion.policy === 'agent') c.flag('a citation criterion from a playbook is agent-approved — a file must not grant that');
      await agent.call('claim_item', { uid: analyse.uid });

      const read = await agent.call('read_material', {
        attachment_uid: workbook.attachment_uid,
        locator: { sheet: folder.cited.sheet, range: 'A1:C4' },
      });
      if (!read.ok) return;
      if (!read.text.includes(String(folder.cited.value))) c.flag(`read_material did not return ${cite} (${folder.cited.value})`);
      console.log(`    read ${folder.workbook} ${folder.cited.sheet}!A1:C4 — EMEA Q3 is ${folder.cited.value}`);

      // Its output: a Word document that states the figure and cites it.
      fs.mkdirSync(path.dirname(abs(folder.output)), { recursive: true });
      fs.writeFileSync(abs(folder.output), analysisDocx(folder.cited.value, cite));
      const output = await agent.json('record_artefact', { item_uid: analyse.uid, path: folder.output, role: 'output', note: 'The analysis' });
      if (!output?.attachment_uid) return;

      await c.say('It offers its evidence', `The figure, and the cell it came from: ${cite}. The checks run first; then it waits for a person.`);
      const submitted = await agent.call('submit_criterion', {
        criterion_uid: criterion.uid,
        evidence: [
          { attachment_uid: workbook.attachment_uid, locator: { sheet: folder.cited.sheet, range: folder.cited.range } },
          { attachment_uid: output.attachment_uid },
        ],
        note: `EMEA Q3 is ${folder.cited.value} — ${cite}`,
      });
      if (!submitted.ok) return;
      await c.call('navigate_to', { target: 'brief', plan_uid: planUid, item_uid: analyse.uid });
      await c.shot('18a-brief-submitted', { criterion: { text: criterion.text, state: 'submitted' } });

      // A person decides. MCP cannot approve — by design, not omission —
      // so the scene waits for someone to, rather than faking it.
      const stateOf = async (): Promise<string | null> => {
        const list = await c.json('list_criteria', { item_uid: analyse.uid });
        return (Array.isArray(list) ? list : []).find((x: { uid: string }) => x.uid === criterion.uid)?.state ?? null;
      };
      const until = async (want: string[], seconds: number): Promise<string | null> => {
        const deadline = Date.now() + seconds * 1000;
        let now = await stateOf();
        while (!(now && want.includes(now)) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1000));
          now = await stateOf();
        }
        return now;
      };

      if (APPROVE) {
        await c.say('Approving for you', 'Through the desktop\'s own route — the one the Approve button uses. It stands in for a person; it is not the agent approving itself.', 'warning');
        await c.api(`/api/criteria/${criterion.uid}/decide`, { decision: 'approved' });
      } else {
        await c.say('Your turn', `Approve "${criterion.text}" in the window — or send it back with a note. Waiting up to ${APPROVE_WAIT_S}s.`, 'question');
      }
      const decided = await until(['met', 'sent_back'], APPROVE ? 15 : APPROVE_WAIT_S);
      if (decided === 'sent_back') {
        console.log('    sent back — the agent would read the note in get_brief and try again');
        return;
      }
      if (decided !== 'met') {
        c.flag(`nobody approved "${criterion.text}" (it is ${decided ?? 'unknown'}) — run with --approve on a dev build, or approve it in the window`);
        return;
      }
      await c.shot('18b-brief-approved', { criterion: { text: criterion.text, state: 'met' } });

      // The data changes after sign-off. The approval was of THAT file, so
      // it no longer vouches for this one — and the Brief says so.
      await c.say('The spreadsheet changes', `A late correction to ${cite}. The approval was given on the file as it was, so it goes stale.`, 'warning');
      fs.writeFileSync(abs(folder.workbook), regionalWorkbook(folder.cited.value + 9));
      const after = await until(['stale'], 20);
      if (after !== 'stale') { c.flag(`editing the cited workbook left the criterion ${after ?? 'unknown'}, not stale`); return; }
      await c.call('navigate_to', { target: 'brief', plan_uid: planUid, item_uid: analyse.uid });
      await c.shot('18c-brief-stale', { criterion: { text: criterion.text, state: 'stale' } });

      // And the place it cited, as it is now.
      await c.call('navigate_to', {
        target: 'artefact',
        attachment_uid: workbook.attachment_uid,
        locator: { sheet: folder.cited.sheet, range: folder.cited.range },
      });
      await c.shot('18d-brief-cited-cell', { artefact: path.basename(folder.workbook) });
      // Close the viewer: it is a modal, and left open it blocks the next
      // run's preflight — which is how this step was found missing.
      await c.call('navigate_to', { target: 'brief', plan_uid: planUid, item_uid: analyse.uid });
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
      // Collapse rather than take the first line: an error whose body is
      // pretty-printed JSON has "{" as its first line, and a flag reading
      // `review_plan: {` says nothing at all.
      if (r.isError) ctx.flag(`${tool}: ${collapse(r.text)}`);
      return { ok: !r.isError, text: r.text };
    },
    async refuse(tool, args = {}) {
      const r = await client.callTool(tool, args);
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
    async shot(label, want = {}) {
      if (!SHOTS) return;

      // Wait for the window to actually be showing the subject, rather
      // than photographing whatever happens to be there when the beat
      // elapses. Navigation is async and a fixed pause is a guess.
      if (Object.keys(want).length > 0) {
        let seen = seenFrom('');
        for (let attempt = 0; attempt < 16; attempt += 1) {
          seen = seenFrom((await client.callTool('ui_ready', {})).text);
          if (meets(want, seen)) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!meets(want, seen)) {
          ctx.flag(`shot "${label}" wanted ${describeWant(want)}; the window showed ${describeSeen(want, seen)} — not captured`);
          return;
        }
        console.log(`    on screen: ${describeSeen(want, seen)}`);
      }

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
      const before = edited.get(abs)!;
      const after = mutate(before);

      // An edit that changes nothing is the scene not happening.
      //
      // `String.replace` with no match returns the original, silently. The
      // work scene replaced a line that was no longer in the fixture — I
      // had committed the demo's own mutation into it with `git add -A`
      // mid-run — so "do the work" wrote the same bytes back, git reported
      // no change, no line was annotated, and the verdict scene rendered a
      // file with nothing marked while narrating what the marks meant.
      //
      // Every layer said success. Only the screenshot disagreed.
      if (after === before) {
        ctx.flag(`edit to ${relative} changed nothing — the fixture may already contain the edit`);
        return;
      }

      fs.writeFileSync(abs, after);
    },
    async agent(name) {
      const extra = createMcpClient({ mcpPort: MCP_PORT, capabilityToken: token, clientName: name });
      await extra.connect();
      await extra.callTool('register_session', { agent_type: name, model: 'demo' });
      extraAgents.push(extra);
      return extra;
    },
    async api(pathAndQuery, body) {
      const method = body === undefined ? 'GET' : 'POST';
      try {
        const res = await fetch(`http://127.0.0.1:${API_PORT}${pathAndQuery}`, body === undefined
          ? { headers: { 'x-codetrellis-token': token } }
          : {
            method,
            headers: { 'x-codetrellis-token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        if (!res.ok) { ctx.flag(`${method} ${pathAndQuery} -> ${res.status}`); return null; }
        return await res.json();
      } catch (err) {
        // A packaged build serves the renderer over IPC and binds no TCP
        // port, so there is simply nothing to call. That is the Phase 19
        // posture working, not a fault — flagging it would train us to
        // ignore flags.
        const msg = err instanceof Error ? err.message : String(err);
        if (/fetch failed|ECONNREFUSED/i.test(msg)) {
          console.log(`    (no HTTP API on :${API_PORT} — packaged builds are IPC-only; skipping this check)`);
          return null;
        }
        ctx.flag(`${method} ${pathAndQuery} failed: ${msg}`);
        return null;
      }
    },
    async bridge(clientName) {
      // The connector reads the port and the token from the data dir on
      // every connect, exactly as it does for Claude Desktop — so this is
      // the path a person's own agent takes, not the demo's shortcut.
      const args = CONNECTOR
        ? [path.resolve(CONNECTOR), '--data-dir', DATA_DIR]
        : ['--import', 'tsx', path.join(REPO, 'src/backend/mcp/connector/main.ts'), '--data-dir', DATA_DIR];
      const bridged = new Client({ name: clientName, version: 'demo' }, { capabilities: {} });
      await bridged.connect(new StdioClientTransport({ command: process.execPath, args, cwd: REPO, stderr: 'pipe' }));
      bridges.push(bridged);
      const call: Bridge['call'] = async (tool, a = {}) => {
        const r = await bridged.callTool({ name: tool, arguments: a }) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
        const text = (r.content ?? []).filter((x) => x.type === 'text').map((x) => x.text ?? '').join('\n');
        if (r.isError) ctx.flag(`${clientName} ${tool}: ${collapse(text)}`);
        return { ok: !r.isError, text };
      };
      return {
        call,
        async json(tool, a) {
          const r = await call(tool, a);
          try { return JSON.parse(r.text); } catch { return null; }
        },
      };
    },
  };

  // ── Preflight: is anyone actually looking at the product? ──────────
  //
  // This exists because a full run once reported "Nothing looked wrong"
  // across twenty-four scenes against an app that had never mounted. The
  // first-run wizard rendered in place of the shell, the backend answered
  // every call correctly, and every screenshot was of a sign-up form.
  //
  // A demo that cannot tell the window is blocked is worth less than no
  // demo, because it converts "unverified" into "verified" without doing
  // any verifying. So this refuses to start rather than producing a green
  // run nobody should trust.
  const readyRaw = await client.callTool('ui_ready', {});
  let ready: { ready?: boolean; shellMounted?: boolean; blockedBy?: string[]; projectOpen?: boolean } | null = null;
  try { ready = JSON.parse(readyRaw.text); } catch { /* reported below */ }

  if (!ready || ready.ready !== true) {
    console.error('\n  The window is not in a state anyone could watch.\n');
    if (!ready) {
      console.error(`  ${readyRaw.text.replace(/\s+/g, ' ').slice(0, 160)}`);
    } else if (!ready.shellMounted) {
      console.error('  The app shell is not mounted — something is rendering instead of it.');
    } else if (ready.blockedBy?.length) {
      console.error(`  A dialog is covering it: ${ready.blockedBy.join(', ')}`);
    }
    console.error('\n  Nothing was run. Clear the window and try again.\n');
    await client.disconnect().catch(() => {});
    process.exit(1);
  }

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
    if (ctx.state.historyPlan) {
      await client.callTool('delete_plan', { plan_uid: ctx.state.historyPlan }).catch(() => {});
    }
    if (ctx.state.briefPlan) {
      await client.callTool('delete_plan', { plan_uid: ctx.state.briefPlan }).catch(() => {});
      console.log('   deleted the brief plan');
    }
    for (const b of bridges) await b.close().catch(() => {});
    if (ctx.state.doc) {
      await client.callTool('delete_system_doc', { uid: ctx.state.doc }).catch(() => {});
      console.log('   deleted the demo system doc');
    }
    for (const extra of extraAgents) await extra.disconnect().catch(() => {});
    await client.callTool('dismiss_presence', {}).catch(() => {});
    // Some journeys open a throwaway repo. Put the user back where they
    // started before the fixtures are deleted underneath the app.
    await client.callTool('open_project', { path: PROJECT }).catch(() => {});
    await client.callTool('rescan_project', { project_path: PROJECT }).catch(() => {});
    await client.disconnect().catch(() => {});
    if (fixtureRoot()) console.log('   removed the throwaway fixtures');
    cleanupFixtures();

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
  cleanupFixtures();
  console.error('\nDemo stopped:', err instanceof Error ? err.message : err);
  console.error('Any edited files were restored.\n');
  process.exit(1);
});
