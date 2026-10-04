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
 *   npm run demo -- --list                # every group and its scenes
 *   npm run demo -- --group=main          # one group (main is the default)
 *   npm run demo -- --all                 # every group, in order
 *   npm run demo -- --pace=slow           # pauses long enough to read
 *   npm run demo -- --scene=review        # one scene
 *   npm run demo -- --project=/path/to/repo
 *   npm run demo -- --port=19433 --api-port=3002   # a second instance
 *   npm run demo -- --shots=/tmp/ct-shots          # one PNG per scene
 *   npm run demo -- --scene=brief --decide         # decide for the person (dev only)
 *   npm run demo -- --grant=terminal               # hold a capability for the run (test backend only)
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
 * The scenes live in `scripts/demo/groups/`, one module per group, listed
 * in `scripts/demo/registry.ts`; the runner is `scripts/demo/cli.ts`.
 *
 * Every journey is catalogued in `docs/DEMO-JOURNEYS.md`, with what to
 * watch for, the fixtures it needs, and the rules for adding one. Two of
 * them live elsewhere and the catalogue says why: planning by hand is a
 * browser spec (`e2e/plan/plan-by-hand.spec.ts`) because every step is a
 * click, and the upgrade journey is a unit test because it needs a fresh
 * boot, which a script driving a running app cannot arrange.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions } from './demo/options';
import { main, onCrash } from './demo/cli';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

main(parseOptions(process.argv.slice(2), REPO)).catch(onCrash);
