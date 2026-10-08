/**
 * `codetrellis` — CodeTrellis for agents, without the desktop app (Phase 32
 * D1.1; docs/FOLLOW-ON-CLOUD-ENVIRONMENTS.md §4).
 *
 *  - `serve` runs the backend headless for a project: loopback only, the
 *    capability token on every transport as always, and nothing of its own
 *    on the network (no update check, no mDNS, no peer mesh). Its data lives
 *    in the user's cache, one folder per project, never in the checkout.
 *  - `scan` scans a project once and prints what it found.
 *  - `mcp` is the stdio connector an agent's config launches.
 *
 * stdout carries only what the command answers (and, for `mcp`, the protocol
 * alone), so `--json` can be piped; the backend's own log goes to stderr.
 * Run through `bin/codetrellis.mjs`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectorLine, flag, headlessDataDir, parseArgs, USAGE, type Parsed } from './args';
import { VERBS } from './verbs';
import { PLAN_VERBS } from './plan-verbs';
import { version as CLI_VERSION } from '../../package.json';

const out = (s: string) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
const fail = (s: string, code = 2): never => {
  process.stderr.write(`codetrellis: ${s}\n`);
  process.exit(code);
};

/**
 * `--share-task-state` (D1.5a): write this backend's task state and test runs
 * to the project's files, and read teammates', as the app's Settings switch
 * does. In the app only the window may turn it on; a headless backend has no
 * window, and the person who wrote the command (in a hook or a pipeline) is
 * the one choosing. Never for the desktop app's own data dir: that switch
 * stays the window's.
 */
async function shareTaskState(project: string): Promise<void> {
  const { setSharedTaskState, startRecordWatcher } = await import('../backend/services/task-records/shared-state');
  setSharedTaskState(project, true, 'the command line (--share-task-state)');
  await startRecordWatcher(project);
}

/** The backend logs to the console; none of it may reach stdout. */
function backendLogToStderr(): void {
  const toErr = (...args: unknown[]) => console.error(...args);
  console.log = toErr;
  console.info = toErr;
  console.debug = toErr;
}

function projectOf(p: Parsed): string {
  const dir = path.resolve(flag(p, 'project') ?? process.cwd());
  let st: fs.Stats;
  try { st = fs.statSync(dir); } catch { return fail(`no such folder: ${dir}`); }
  if (!st.isDirectory()) fail(`not a folder: ${dir}`);
  return fs.realpathSync(dir);
}

function portOf(p: Parsed, name: string): string | undefined {
  const v = flag(p, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) fail(`--${name} must be a port number`);
  return String(n);
}

/** Boot the backend in this process, headless, on loopback; open the project. */
async function boot(p: Parsed, project: string, dataDir: string) {
  if (p.flags['share-task-state']) {
    const { defaultDataDir } = await import('../backend/mcp/connector/files');
    // The app's own folder, whatever CODETRELLIS_DATA_DIR says (a job may set that to its cache).
    if (path.resolve(dataDir) === path.resolve(defaultDataDir({}))) {
      fail('--share-task-state is for a headless backend; in the app, turn it on in Settings → Shared task state.', 2);
    }
  }
  process.env.CODETRELLIS_DATA_DIR = dataDir;
  process.env.CODETRELLIS_HEADLESS = '1';
  const port = portOf(p, 'port');
  const mcpPort = portOf(p, 'mcp-port');
  if (port !== undefined) process.env.CODETRELLIS_BACKEND_PORT = port;
  if (mcpPort !== undefined) process.env.CODETRELLIS_MCP_PORT = mcpPort;
  fs.mkdirSync(dataDir, { recursive: true });
  backendLogToStderr();

  const { startServer, getBoundBackendPort } = await import('../backend/server');
  const { installProcessHandlers } = await import('../backend/lifecycle');
  const { getCapabilityToken } = await import('../backend/services/capability-token');
  installProcessHandlers();
  await startServer(undefined, '127.0.0.1');
  const base = `http://127.0.0.1:${getBoundBackendPort()}`;
  // Opened the way the app opens a folder the person picked: the person
  // named it on the command line.
  const res = await fetch(`${base}/api/project/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-codetrellis-token': getCapabilityToken() },
    body: JSON.stringify({ projectPath: project }),
  });
  const scan = await res.json().catch(() => ({})) as { fileCount?: number; astStats?: { fileCount?: number; symbolCount?: number; importCount?: number; resolvedImports?: number }; error?: string };
  if (!res.ok) fail(`could not open ${project}: ${scan.error ?? res.status}`, 1);
  if (p.flags['share-task-state']) await shareTaskState(project);
  // The MCP server's URL, as the connector will read it (never the token).
  const { readConnectTarget } = await import('../backend/mcp/connector/files');
  const target = readConnectTarget(dataDir);
  return { base, scan, mcp: target.ok ? target.url : null };
}

function counts(scan: Awaited<ReturnType<typeof boot>>['scan']) {
  const a = scan.astStats ?? {};
  return {
    files: scan.fileCount ?? 0,
    parsed: a.fileCount ?? 0,
    symbols: a.symbolCount ?? 0,
    imports: a.importCount ?? 0,
    resolvedImports: a.resolvedImports ?? 0,
  };
}

async function serve(p: Parsed): Promise<void> {
  const project = projectOf(p);
  const dataDir = path.resolve(flag(p, 'data-dir') ?? headlessDataDir(project, process.env, os.homedir()));
  const { base, scan, mcp } = await boot(p, project, dataDir);
  const line = connectorLine(process.execPath, binPath(), dataDir);
  const c = counts(scan);
  markReady(dataDir, project);
  if (p.flags.json) {
    out(JSON.stringify({ project, dataDir, api: base, mcp, connector: { command: line.command, args: line.args }, counts: c }));
    return;
  }
  out([
    `CodeTrellis is serving ${project}`,
    `  headless, on loopback only; every request needs the token in ${path.join(dataDir, 'capability-token')}`,
    `  ${c.files} files, ${c.symbols} symbols, ${c.resolvedImports} of ${c.imports} imports resolved`,
    `  data: ${dataDir}`,
    '',
    'Connect an agent (the token is read on every connect, so this survives a restart):',
    `  ${line.claude}`,
    `  ${line.json}`,
    '',
    'Stop with Ctrl-C.',
  ].join('\n'));
}

async function scanOnce(p: Parsed): Promise<void> {
  const project = projectOf(p);
  const dataDir = path.resolve(flag(p, 'data-dir') ?? headlessDataDir(project, process.env, os.homedir()));
  const { scan } = await boot(p, project, dataDir);
  const c = counts(scan);
  if (p.flags.json) out(JSON.stringify({ project, ...c }));
  else out(`${project}: ${c.files} files (${c.parsed} parsed), ${c.symbols} symbols, ${c.resolvedImports} of ${c.imports} imports resolved`);
  const { gracefulShutdown } = await import('../backend/lifecycle');
  await gracefulShutdown('scan finished');
}

async function mcp(p: Parsed): Promise<void> {
  // The connector reads `--data-dir` from argv. Not given, the headless
  // backend for this folder when one is running, else the desktop app's.
  if (!flag(p, 'data-dir')) {
    const here = headlessDataDir(process.cwd(), process.env, os.homedir());
    if (fs.existsSync(path.join(here, 'mcp-endpoint.json'))) process.argv.push('--data-dir', here);
  }
  await import('../backend/mcp/connector/main');
}

const READY_FILE = 'serve-ready.json';

/**
 * Say the backend has opened its project and finished scanning. The MCP
 * endpoint is published at boot, before the scan, so `start` waits for this
 * rather than for the endpoint: a gate run on half a graph would pass on
 * files it had not read yet. Removed when this process exits.
 */
function markReady(dataDir: string, project: string): void {
  const file = path.join(dataDir, READY_FILE);
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, project }), { mode: 0o600 });
  process.on('exit', () => {
    try {
      if ((JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number }).pid === process.pid) fs.unlinkSync(file);
    } catch { /* already gone */ }
  });
}

/** The headless backend's process for a data dir, when one is up, scanned and answering. */
async function runningIn(dataDir: string): Promise<{ pid: number; url: string } | null> {
  const { readConnectTarget, readEndpoint } = await import('../backend/mcp/connector/files');
  const endpoint = readEndpoint(dataDir);
  const target = readConnectTarget(dataDir);
  if (!endpoint || !target.ok) return null;
  try { process.kill(endpoint.pid, 0); } catch { return null; } // left behind by a process that died
  try {
    if ((JSON.parse(fs.readFileSync(path.join(dataDir, READY_FILE), 'utf8')) as { pid?: number }).pid !== endpoint.pid) return null;
  } catch { return null; } // still scanning, or not a headless backend
  return { pid: endpoint.pid, url: target.url };
}

/**
 * `start`: `serve` in the background unless one already answers for this
 * folder (D1.4). A session-start hook runs it every time, so being up
 * already is success. Its log is `serve.log` in the data dir.
 */
async function start(p: Parsed): Promise<void> {
  const project = projectOf(p);
  const dataDir = path.resolve(flag(p, 'data-dir') ?? headlessDataDir(project, process.env, os.homedir()));
  const line = connectorLine(process.execPath, binPath(), dataDir);
  const say = (state: 'running' | 'started', pid: number) => {
    if (p.flags.quiet) return;
    if (p.flags.json) out(JSON.stringify({ state, pid, project, dataDir, connector: { command: line.command, args: line.args } }));
    else out(`CodeTrellis ${state === 'running' ? 'is already running' : 'started'} for ${project} (pid ${pid}).\nConnect an agent with:\n  ${line.claude}`);
  };
  const up = await runningIn(dataDir);
  if (up) return say('running', up.pid);

  fs.mkdirSync(dataDir, { recursive: true });
  const log = fs.openSync(path.join(dataDir, 'serve.log'), 'a');
  const args = [binPath(), 'serve', '--project', project, '--data-dir', dataDir];
  for (const k of ['port', 'mcp-port']) { const v = portOf(p, k); if (v !== undefined) args.push(`--${k}`, v); }
  if (p.flags['share-task-state']) args.push('--share-task-state');
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log], cwd: project, env: process.env });
  child.unref();
  fs.closeSync(log);
  let exited: number | null = null;
  child.on('exit', (code) => { exited = code ?? 1; });

  const limit = Number(flag(p, 'timeout') ?? 120) * 1000;
  const until = Date.now() + (Number.isFinite(limit) && limit > 0 ? limit : 120_000);
  while (Date.now() < until) {
    // The launcher runs the CLI as its own child, so the backend's pid is not
    // child.pid: any live endpoint now is the one just started.
    const now = await runningIn(dataDir);
    if (now) return say('started', now.pid);
    if (exited !== null) fail(`codetrellis serve stopped (exit ${exited}); see ${path.join(dataDir, 'serve.log')}`, 1);
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`codetrellis serve did not come up in time; see ${path.join(dataDir, 'serve.log')}`, 1);
}

/** `stop`: end the headless backend `start` (or `serve`) began for this folder. */
async function stop(p: Parsed): Promise<void> {
  const project = projectOf(p);
  const dataDir = path.resolve(flag(p, 'data-dir') ?? headlessDataDir(project, process.env, os.homedir()));
  const up = await runningIn(dataDir);
  if (!up) { out(`CodeTrellis is not running for ${project}.`); return; }
  process.kill(up.pid, 'SIGTERM');
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    try { process.kill(up.pid, 0); } catch { out(`Stopped CodeTrellis for ${project}.`); return; }
    await new Promise((r) => setTimeout(r, 200));
  }
  fail(`CodeTrellis (pid ${up.pid}) did not stop within 15 s`, 1);
}

/** A keep-on-track verb, run as the agent that called it (D1.2). */
async function verb(name: string, p: Parsed): Promise<void> {
  const { agentName, connectAgent, dataDirFor, NotRunningError } = await import('./agent');
  const { runVerb, UsageError } = await import('./verbs');
  const cwd = process.cwd();
  let agent;
  try {
    agent = await connectAgent({ dataDir: dataDirFor(flag(p, 'data-dir'), cwd, process.env), name: agentName(flag(p, 'as'), process.env), cwd });
  } catch (err) {
    if (err instanceof NotRunningError) fail(err.message, 1);
    throw err;
  }
  try {
    const { runPlanVerb } = await import('./plan-verbs');
    const { out: text, code } = PLAN_VERBS.has(name) ? await runPlanVerb(name, agent, p, cwd) : await runVerb(name, agent, p, cwd);
    if (text) out(text);
    process.exitCode = code;
  } catch (err) {
    if (err instanceof UsageError) { process.stderr.write(`codetrellis: ${err.message}\n`); process.exitCode = 2; }
    else throw err;
  } finally {
    await agent.close();
  }
}

/**
 * Phase 33 C4 — `codetrellis review`: agent checks on the person's own agent
 * CLI, run headless, each pass recorded as a check run (src/cli/review.ts).
 */
async function reviewCmd(p: Parsed): Promise<void> {
  // C9: the signed review on the pull request, which needs git and nothing else.
  if (p.rest[0] === 'verify' || p.rest[0] === 'publish') {
    const { verifyCmd, publishCmd, VerifyUsageError } = await import('./review-verify');
    try {
      const r = p.rest[0] === 'verify' ? verifyCmd(p, process.cwd(), process.env, CLI_VERSION) : publishCmd(p, process.cwd());
      out(r.out);
      process.exitCode = r.code;
    } catch (err) {
      if (err instanceof VerifyUsageError) fail(err.message);
      throw err;
    }
    return;
  }
  const { agentName, connectAgent, dataDirFor, NotRunningError } = await import('./agent');
  const { review, reviewOptions, ReviewUsageError } = await import('./review');
  const cwd = process.cwd();
  let opts;
  try { opts = reviewOptions(p, cwd, process.env); } catch (err) {
    if (err instanceof ReviewUsageError) fail(err.message);
    throw err;
  }
  let agent;
  try {
    agent = await connectAgent({ dataDir: dataDirFor(flag(p, 'data-dir'), cwd, process.env), name: agentName(flag(p, 'as'), process.env), cwd });
  } catch (err) {
    if (err instanceof NotRunningError) fail(err.message, 1);
    throw err;
  }
  try {
    const sinkFor = (dir: string) => ({ command: process.execPath, args: [binPath(), 'review-sink', '--pass', dir] });
    const post = opts.post ? await reviewPoster(opts.post, cwd) : undefined;
    const { out: text, code, note } = await review(agent, opts, cwd, process.env, sinkFor, { post, version: CLI_VERSION });
    out(text);
    // Where the review was posted, or why not: never on stdout, which may be SARIF.
    if (note) process.stderr.write(`codetrellis review: ${note}\n`);
    process.exitCode = code;
  } finally {
    await agent.close();
  }
}

/**
 * C5 — `--post`: the pull request from the CI's variables (or `--pr`), the
 * host from `origin`, the token from `--post-token env:VAR` or the host's
 * usual variable. Never handed to the agent: its environment is scrubbed.
 */
async function reviewPoster(post: { tokenVar: string | null; pr: number | null }, cwd: string): Promise<(markdown: string) => Promise<{ ok: boolean; says: string }>> {
  const { detectProjectHost } = await import('../backend/services/review-host/detect');
  const { DEFAULT_TOKEN, postComment, pullNumber } = await import('./review-post');
  const host = detectProjectHost(cwd);
  const pr = post.pr ?? pullNumber(process.env);
  return async (markdown) => {
    if (!host?.kind) return { ok: false, says: 'origin is not on GitHub, GitLab or Bitbucket; the review was not posted' };
    if (!pr) return { ok: false, says: 'no pull request to post to (not a pull request job; --pr names one)' };
    const tokenVar = post.tokenVar ?? DEFAULT_TOKEN[host.kind];
    const token = process.env[tokenVar];
    if (!token) return { ok: false, says: `${tokenVar} is not set; the review was not posted` };
    return postComment(host, pr, token, markdown);
  };
}

/** The review sink a reviewing agent's CLI starts over stdio (C4); stdout is the protocol alone. */
async function reviewSink(p: Parsed): Promise<void> {
  const dir = flag(p, 'pass');
  if (!dir) fail('review-sink needs --pass <dir>');
  backendLogToStderr();
  const { runReviewSink } = await import('./review-sink');
  await runReviewSink(dir!);
}

/** This CLI's launcher, as an agent's config names it. */
function binPath(): string {
  return path.resolve(__dirname, '..', '..', 'bin', 'codetrellis.mjs');
}

async function main(): Promise<void> {
  const p = parseArgs(process.argv.slice(2));
  if (p.flags.help || !p.command || p.command === 'help') {
    out(USAGE);
    return;
  }
  switch (p.command) {
    case 'serve': return serve(p);
    case 'scan': return scanOnce(p);
    case 'mcp': return mcp(p);
    case 'start': return start(p);
    case 'stop': return stop(p);
    case 'review': return reviewCmd(p);
    case 'review-sink': return reviewSink(p);
    default:
      if (VERBS.has(p.command) || PLAN_VERBS.has(p.command)) return verb(p.command, p);
      fail(`unknown command "${p.command}". Run codetrellis --help.`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err), 1));
