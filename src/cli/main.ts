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

const out = (s: string) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
const fail = (s: string, code = 2): never => {
  process.stderr.write(`codetrellis: ${s}\n`);
  process.exit(code);
};

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
    default:
      if (VERBS.has(p.command) || PLAN_VERBS.has(p.command)) return verb(p.command, p);
      fail(`unknown command "${p.command}". Run codetrellis --help.`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err), 1));
