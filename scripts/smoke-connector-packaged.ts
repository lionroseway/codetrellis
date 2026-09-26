/**
 * Does the connector command a packaged build hands out still start once the
 * launch that produced it has gone?
 *
 * The unit tests pin the command's shape. They cannot show that a real
 * AppImage runtime, AppRun and Electron in Node mode accept it, or what
 * electron-builder's portable launcher really does with its temp folder —
 * this runs the built artifact and finds out.
 *
 *   npx tsx scripts/smoke-connector-packaged.ts appimage out/make/CodeTrellis-X-x86_64.AppImage
 *   npx tsx scripts/smoke-connector-packaged.ts portable out/make/CodeTrellis-Portable-X.exe
 *
 * Each run: launch the artifact once and record what the app would see
 * (execPath, resourcesPath, the launcher's variables); resolve the command
 * from that, exactly as `mcp/server.ts` does; let the launch end; then start
 * the command and complete an MCP handshake over stdio. The data dir is
 * empty, so the connector answers as "app not running" — which is the point:
 * the command has to work whether or not a CodeTrellis is up.
 *
 * Exits 0 when every check holds, 1 on the first that does not.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONNECTOR_SCRIPT, PORTABLE_CAVEAT, resolveConnectorCommand, type ConnectorCommand } from '../src/backend/mcp/connector/command';

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function note(msg: string): void {
  console.log(`  · ${msg}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What the app sees about itself — written by a probe run in the artifact's own Node mode. */
interface Seen {
  execPath: string;
  resourcesPath: string;
  electron: string;
  env: { APPIMAGE?: string; APPDIR?: string; PORTABLE_EXECUTABLE_FILE?: string };
  scriptExists: boolean;
  appImageExists: boolean;
}

const PROBE = `
const fs = require('fs'), path = require('path');
const out = process.argv[process.argv.indexOf('--probe-out') + 1];
const hold = Number(process.argv[process.argv.indexOf('--probe-hold') + 1] || 0);
const script = path.join(process.resourcesPath, 'connector', '${CONNECTOR_SCRIPT}');
fs.writeFileSync(out, JSON.stringify({
  execPath: process.execPath,
  resourcesPath: process.resourcesPath,
  electron: process.versions.electron,
  env: {
    APPIMAGE: process.env.APPIMAGE,
    APPDIR: process.env.APPDIR,
    PORTABLE_EXECUTABLE_FILE: process.env.PORTABLE_EXECUTABLE_FILE,
  },
  scriptExists: fs.existsSync(script),
  appImageExists: !!process.env.APPIMAGE && fs.existsSync(process.env.APPIMAGE),
}));
process.stdout.write('probe-stdout-marker\\n');
setTimeout(() => {}, hold);
`;

interface Run {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  /** True once it has exited, or failed to start at all. */
  done: () => boolean;
  exited: Promise<number | null>;
}

function start(command: string, args: string[], env: Record<string, string>): Run {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  let done = false;
  child.stdout!.on('data', (d) => { out += d; });
  child.stderr!.on('data', (d) => { err += d; });
  const exited = new Promise<number | null>((resolve) => {
    child.on('error', (e) => { err += String(e); done = true; resolve(-1); });
    child.on('exit', (code) => { done = true; resolve(code); });
  });
  return { child, stdout: () => out, stderr: () => err, done: () => done, exited };
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: timed out after ${ms}ms`)), ms); });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

/** Launch the artifact once in Node mode with the probe and read what it saw. */
async function probe(command: string, prefix: string[], hold: number, scratch: string): Promise<{ seen: Promise<Seen>; run: Run }> {
  const probeFile = path.join(scratch, 'probe.cjs');
  fs.writeFileSync(probeFile, PROBE);
  const outFile = path.join(scratch, `seen-${Date.now()}.json`);
  // Trailing --no-sandbox: the sentinel the AppImage command carries, for the
  // same reason (see appImageCommand). Only an argv entry to the probe.
  const run = start(command, [...prefix, probeFile, '--probe-out', outFile, '--probe-hold', String(hold), '--no-sandbox'], { ELECTRON_RUN_AS_NODE: '1' });
  const seen = (async () => {
    for (let i = 0; i < 600; i++) {
      if (fs.existsSync(outFile)) {
        try { return JSON.parse(fs.readFileSync(outFile, 'utf-8')) as Seen; } catch { /* still being written */ }
      }
      if (run.done() && !fs.existsSync(outFile)) break;
      await sleep(250);
    }
    throw new Error(`the probe wrote nothing (stderr: ${run.stderr().trim() || 'none'})`);
  })();
  return { seen, run };
}

/** Resolve the command from what the launch saw, as `currentConnector()` does. */
function resolveFrom(seen: Seen, dataDir: string, exists: (p: string) => boolean): ConnectorCommand | null {
  return resolveConnectorCommand({
    execPath: seen.execPath,
    electronVersion: seen.electron,
    resourcesPath: seen.resourcesPath,
    cwd: path.parse(process.cwd()).root,
    dataDir,
    exists,
    env: seen.env,
  });
}

/** Start the command, `initialize`, `tools/list`, close stdin; the replies or why not. */
async function handshake(cmd: ConnectorCommand, extraEnv: Record<string, string> = {}): Promise<{ ok: boolean; detail: string }> {
  const run = start(cmd.command, cmd.args, { ...cmd.env, ...extraEnv });
  const replies = new Map<number, { result?: { serverInfo?: { name?: string }; tools?: unknown[] } }>();
  let buffer = '';
  run.child.stdout!.on('data', (d) => {
    buffer += d;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (typeof msg.id === 'number') replies.set(msg.id, msg);
      } catch {
        replies.set(-1, { result: { serverInfo: { name: `NOT JSON ON STDOUT: ${line}` } } });
      }
    }
  });
  const send = (msg: object) => run.child.stdin!.write(`${JSON.stringify(msg)}\n`);
  const waitFor = async (id: number) => {
    for (let i = 0; i < 120 && !replies.has(id) && !run.done(); i++) await sleep(250);
    return replies.get(id);
  };
  run.child.stdin!.on('error', () => { /* it exited; reported below */ });
  try {
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'connector-smoke', version: '1' } },
    });
    const init = await waitFor(1);
    if (replies.has(-1)) return { ok: false, detail: replies.get(-1)!.result!.serverInfo!.name! };
    if (init?.result?.serverInfo?.name !== 'codetrellis') {
      return { ok: false, detail: `no initialize reply (exit ${run.child.exitCode ?? 'none'}; stderr: ${run.stderr().trim() || 'none'})` };
    }
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await waitFor(2);
    if (!Array.isArray(list?.result?.tools)) return { ok: false, detail: `no tools/list reply (stderr: ${run.stderr().trim()})` };
    run.child.stdin!.end();
    const code = await withTimeout(run.exited, 15_000, 'exit after stdin closed');
    return { ok: true, detail: `initialize + tools/list answered, exit ${code} on stdin close` };
  } finally {
    if (!run.done()) run.child.kill();
  }
}

async function smokeAppImage(file: string): Promise<void> {
  const appImage = path.resolve(file);
  if (!fs.existsSync(appImage)) fail(`no such AppImage: ${appImage}`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-connector-smoke-'));
  const dataDir = path.join(scratch, 'data');
  fs.mkdirSync(dataDir);
  console.log(`AppImage: ${appImage}`);

  // Launch A: what the app sees about itself.
  const a = await probe(appImage, [], 0, scratch);
  const seen = await a.seen.catch((e) => fail(String(e)));
  await a.run.exited;
  note(`launch A ran from ${seen.execPath}`);
  if (!seen.env.APPIMAGE || !seen.env.APPDIR) fail('the runtime set no APPIMAGE / APPDIR');
  if (path.dirname(seen.execPath) !== seen.env.APPDIR) fail(`the binary is not directly in APPDIR (${seen.env.APPDIR})`);
  ok('the runtime sets APPIMAGE and APPDIR, and the binary sits directly in APPDIR');
  await sleep(1000);
  if (fs.existsSync(seen.execPath)) fail(`launch A's mount is still there after it exited: ${seen.env.APPDIR}`);
  ok(`launch A's mount (${seen.env.APPDIR}) is gone once it exits`);

  const recorded = (p: string) =>
    (p === seen.env.APPIMAGE && seen.appImageExists)
    || (p === path.join(seen.resourcesPath, 'connector', CONNECTOR_SCRIPT) && seen.scriptExists);
  const cmd = resolveFrom(seen, dataDir, recorded);
  if (!cmd) fail('no connector command resolved');
  if (cmd.command !== appImage) fail(`the command is ${cmd.command}, not the AppImage file`);
  if (JSON.stringify(cmd).includes(seen.env.APPDIR)) fail('the command still names launch A\'s mount');
  ok('the resolved command names the AppImage file and nothing from launch A\'s mount');

  // The bug this fixes: the command as it was before, from launch A.
  const before: ConnectorCommand = {
    command: seen.execPath,
    args: [path.join(seen.resourcesPath, 'connector', CONNECTOR_SCRIPT), '--data-dir', dataDir],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
  const old = await handshake(before);
  if (old.ok) fail('the old per-launch command still worked — the premise of this fix is wrong');
  ok(`control: the old per-launch command fails once launch A is gone (${old.detail.slice(0, 80)})`);

  const now = await handshake(cmd);
  if (!now.ok) fail(`the resolved command did not start the connector: ${now.detail}`);
  ok(`the resolved command starts the connector from a fresh mount: ${now.detail}`);

  // Ubuntu 24.04 and anything else where unprivileged user namespaces are
  // refused: AppRun's `unshare -Ur true` fails and it prepends --no-sandbox.
  const noUserns = path.join(scratch, 'no-userns');
  fs.mkdirSync(noUserns);
  fs.writeFileSync(path.join(noUserns, 'unshare'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const refused = { PATH: `${noUserns}${path.delimiter}${process.env.PATH}` };
  const strict = await handshake(cmd, refused);
  if (!strict.ok) fail(`with user namespaces refused, the command did not start: ${strict.detail}`);
  ok('with user namespaces refused (AppRun adds --no-sandbox), it still starts');

  const withoutSentinel = { ...cmd, args: cmd.args.filter((x) => x !== '--no-sandbox') };
  const bad = await handshake(withoutSentinel, refused);
  if (bad.ok) note('control: without the trailing --no-sandbox it ALSO started — the sentinel may be unnecessary here');
  else ok(`control: without the trailing --no-sandbox it fails there, as the comment says (${bad.detail.slice(0, 80)})`);

  fs.rmSync(scratch, { recursive: true, force: true });
}

async function smokePortable(file: string): Promise<void> {
  const portable = path.resolve(file);
  if (!fs.existsSync(portable)) fail(`no such portable exe: ${portable}`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-connector-smoke-'));
  const dataDir = path.join(scratch, 'data');
  fs.mkdirSync(dataDir);
  console.log(`Portable: ${portable}`);

  // Launch A, held open for a while: "CodeTrellis is running". It ends on its
  // own, so the launcher's clean-up runs as it would when the app quits —
  // killing the launcher would orphan the app and skip it.
  const HOLD = 30_000;
  const a = await probe(portable, [], HOLD, scratch);
  const seen = await a.seen.catch((e) => fail(String(e)));
  note(`launch A unpacked to ${path.dirname(seen.execPath)}`);
  if (path.resolve(seen.env.PORTABLE_EXECUTABLE_FILE ?? '').toLowerCase() !== portable.toLowerCase()) {
    fail(`PORTABLE_EXECUTABLE_FILE is ${seen.env.PORTABLE_EXECUTABLE_FILE}, not the portable exe`);
  }
  ok('the launcher sets PORTABLE_EXECUTABLE_FILE to the portable exe');

  const cmd = resolveFrom(seen, dataDir, (p) => fs.existsSync(p));
  if (!cmd) fail('no connector command resolved');
  if (cmd.command !== seen.execPath) fail(`the command is ${cmd.command}, not the unpacked binary`);
  if (cmd.caveat !== PORTABLE_CAVEAT) fail('the portable command carries no caveat');
  ok('the resolved command is the unpacked binary, with the caveat');

  const open = await handshake(cmd);
  if (!open.ok) fail(`while the app is open, the command did not start the connector: ${open.detail}`);
  ok(`while the app is open, it starts the connector: ${open.detail}`);

  await withTimeout(a.run.exited, HOLD + 60_000, 'launch A exit');
  if (a.run.stdout().includes('probe-stdout-marker')) {
    fail('the portable launcher passed the app\'s stdout through — it could be the command after all; revisit command.ts');
  }
  ok('the portable launcher does not pass the app\'s stdout through, so it cannot be the command');

  if (fs.existsSync(seen.execPath)) fail(`the unpacked folder outlived the app: ${path.dirname(seen.execPath)}`);
  ok('the unpacked folder is removed when the app exits');
  const closed = await handshake(cmd);
  if (closed.ok) fail('with the app closed, the command still started — the caveat overstates it; revisit PORTABLE_CAVEAT');
  ok('with the app closed, the command does not start — as the caveat says');

  // Launch B: the same build unpacks to the same folder, so the config works again.
  const b = await probe(portable, [], HOLD, scratch);
  const seenB = await b.seen.catch((e) => fail(String(e)));
  if (seenB.execPath !== seen.execPath) fail(`launch B unpacked elsewhere (${seenB.execPath}); the caveat understates it`);
  ok('launch B of the same build unpacks to the same folder');
  const again = await handshake(cmd);
  if (!again.ok) fail(`after a restart, the same config did not start: ${again.detail}`);
  ok('after a restart, the same config starts the connector again');

  // A connector left running holds the unpacked exe open. Does the next launch
  // still unpack over it? Recorded, not asserted: it is what a user with an
  // agent connected meets when they restart the portable app.
  const live = start(cmd.command, cmd.args, cmd.env);
  await withTimeout(b.run.exited, HOLD + 60_000, 'launch B exit');
  note(fs.existsSync(seen.execPath)
    ? 'with a connector running, the unpacked binary survives the launcher\'s clean-up'
    : 'with a connector running, the launcher still removed the unpacked binary');
  const c = await probe(portable, [], 0, scratch);
  const relaunched = await withTimeout(c.seen, 120_000, 'launch C').then(() => true, () => false);
  if (!c.run.done()) c.run.child.kill();
  live.child.stdin!.end();
  if (!live.done()) live.child.kill();
  note(relaunched
    ? 'with a connector still running from the unpacked folder, the portable app relaunches'
    : `with a connector still running from the unpacked folder, the portable app did NOT relaunch (${c.run.stderr().trim() || 'no output'})`);

  fs.rmSync(scratch, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const [mode, file] = process.argv.slice(2);
  if (mode === 'appimage' && file) await smokeAppImage(file);
  else if (mode === 'portable' && file) await smokePortable(file);
  else fail('usage: smoke-connector-packaged.ts appimage <file.AppImage> | portable <file.exe>');
  console.log('connector smoke: all checks passed');
}

main().then(() => process.exit(0), (err) => fail(err instanceof Error ? err.message : String(err)));
