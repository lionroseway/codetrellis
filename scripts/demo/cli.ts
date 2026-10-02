/**
 * The demo on the command line: connect to the running app, check the window
 * can be watched, play the picked scenes, then put everything back. The
 * scenes live in `groups/`, one module per group, listed in `registry.ts`;
 * the entry point is `scripts/demo.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createMcpClient, type ScriptedMcp } from '../../tests/harness/mcp-client';
import { cleanupFixtures } from '../demo-fixtures';
import type { DemoOptions } from './options';
import { DEFAULT_GROUP, GROUPS } from './registry';
import { createContext, type RunContext } from './context';
import { pickScenes, runScenes } from './runner';

let current: RunContext | null = null;

export async function main(opts: DemoOptions): Promise<void> {
  if (opts.list) {
    for (const g of GROUPS) {
      console.log(`\n${g.id}${g.id === DEFAULT_GROUP ? ' (the default)' : ''} — ${g.title}\n`);
      for (const s of g.scenes) console.log(`  ${s.id.padEnd(14)} ${s.title}`);
    }
    console.log('\n  npm run demo -- --group=<id>[,<id>] | --all | --scene=<id>\n');
    return;
  }

  // Which scenes, before anything connects: a typo should not need the app.
  const chosen = pickScenes(opts);
  if ('error' in chosen) {
    console.error(`\n${chosen.error} Try --list.\n`);
    process.exit(1);
  }

  const tokenPath = path.join(opts.dataDir, 'capability-token');
  if (!fs.existsSync(tokenPath)) {
    console.error(`\nNo capability token at ${tokenPath}.`);
    console.error('Is CodeTrellis running? Point at its data dir with --data-dir=…\n');
    process.exit(1);
  }
  const token = fs.readFileSync(tokenPath, 'utf-8').trim();

  let mcp: ScriptedMcp | null = null;
  try {
    mcp = createMcpClient({ mcpPort: opts.mcpPort, capabilityToken: token, clientName: 'codetrellis-demo' });
    await mcp.connect();
  } catch (err) {
    console.error(`\nCould not reach the MCP server on :${opts.mcpPort} — is the app running?`);
    console.error(String(err instanceof Error ? err.message : err), '\n');
    process.exit(1);
  }

  const client = mcp;
  await client.callTool('register_session', { agent_type: 'codetrellis-demo', model: 'demo' });

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

  const run = createContext(opts, { client, token, mode: 'watch', apiBase: `http://127.0.0.1:${opts.apiPort}` });
  current = run;
  const scenes = chosen.picked.flatMap((p) => p.scenes);
  console.log(`\n  CodeTrellis demo · ${opts.project}`);
  console.log(`  pace: ${opts.pace} · scenes: ${scenes.map((s) => s.id).join(', ')}\n`);

  try {
    await runScenes(run.ctx, chosen.picked);
  } finally {
    await run.tidy();
    await client.disconnect().catch(() => {});
    console.log('\n' + '='.repeat(66));
    if (run.flags.length === 0) console.log('Nothing looked wrong.');
    else {
      console.log(`${run.flags.length} thing(s) worth a look:`);
      run.flags.forEach((f, i) => console.log(` ${i + 1}. ${f}`));
    }
    console.log('');
  }
}

/** If the run dies, put back what it changed before saying so. */
export function onCrash(err: unknown): never {
  current?.restoreFiles();
  cleanupFixtures();
  console.error('\nDemo stopped:', err instanceof Error ? err.message : err);
  console.error('Any edited files were restored.\n');
  process.exit(1);
}
