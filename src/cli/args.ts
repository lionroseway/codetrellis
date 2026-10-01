/**
 * The `codetrellis` command line, pure parts (Phase 32 D1.1): what was asked,
 * where a headless backend keeps its data, and the line an agent's MCP config
 * needs. Nothing here starts anything.
 */

import path from 'node:path';
import crypto from 'node:crypto';

export interface Parsed {
  command: string | null;
  /** `--flag value` and `--flag` (true). */
  flags: Record<string, string | true>;
  /** Everything else, in order. */
  rest: string[];
}

/** Flags that never take a value, so `--json foo` keeps `foo` as an argument. */
const SWITCHES = new Set(['json', 'help', 'no-wait']);

export function parseArgs(argv: readonly string[]): Parsed {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  let command: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags[name] = a.slice(eq + 1);
      else if (!SWITCHES.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
      else flags[name] = true;
      continue;
    }
    if (a === '-h') { flags.help = true; continue; }
    if (command === null) command = a;
    else rest.push(a);
  }
  return { command, flags, rest };
}

/** A string flag, or undefined when absent or given bare. */
export function flag(p: Parsed, name: string): string | undefined {
  const v = p.flags[name];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Where a headless backend for a project keeps its database, token and
 * endpoint: the user's cache, one folder per project, never the project
 * itself (nothing is written into a checkout but what the plan puts there).
 * `CODETRELLIS_DATA_DIR` wins, as it does for the backend.
 */
export function headlessDataDir(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  home: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const fromEnv = env.CODETRELLIS_DATA_DIR;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  const cache = platform === 'darwin'
    ? path.join(home, 'Library', 'Caches')
    : platform === 'win32'
      ? (env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'))
      : (env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(home, '.cache'));
  const resolved = path.resolve(projectRoot);
  const id = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 10);
  const name = path.basename(resolved).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  return path.join(cache, 'codetrellis', `${name}-${id}`);
}

export interface ConnectorLine {
  command: string;
  args: string[];
  /** For `claude mcp add`. */
  claude: string;
  /** For any client that takes a JSON `mcpServers` block. */
  json: string;
}

const quote = (s: string) => (/^[A-Za-z0-9_./:=@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/**
 * How an agent reaches this backend: the CLI's own `mcp` command, which reads
 * the token and port on every connect, so the config carries no secret and
 * survives a restart.
 */
export function connectorLine(nodePath: string, binPath: string, dataDir: string): ConnectorLine {
  const args = [binPath, 'mcp', '--data-dir', dataDir];
  return {
    command: nodePath,
    args,
    claude: `claude mcp add codetrellis -- ${[nodePath, ...args].map(quote).join(' ')}`,
    json: JSON.stringify({ mcpServers: { codetrellis: { command: nodePath, args } } }),
  };
}

export const USAGE = `codetrellis — CodeTrellis for agents, without the desktop app

  codetrellis serve [--project <dir>] [--data-dir <dir>] [--port <n>] [--mcp-port <n>] [--json]
      Run the backend headless for a project: loopback only, the capability
      token on every transport, no discovery, peers or update check. Prints
      the line an agent's MCP config needs.

  codetrellis scan [--project <dir>] [--data-dir <dir>] [--json]
      Scan a project once and print what was found, then exit.

  codetrellis mcp [--data-dir <dir>]
      The stdio MCP connector an agent's config launches. Finds the headless
      backend for the folder it is started in, else the desktop app's.

Keeping on track, as the agent running the command (--as <name> to say
which; text, or --json):

  codetrellis next [--plan <uid>]              the task to pick up
  codetrellis claim <task>                     take it
  codetrellis update <task> --progress N [--note <text>]
  codetrellis stuck <task> <why…>              blocked, and why
  codetrellis done <task>                      refused while a criterion's check fails
  codetrellis request <question…> [--options a,b] [--item <task>] [--no-wait] [--timeout <s>]
                                               ask the person; waits for their answer
  codetrellis brief <task>                     what the task needs
  codetrellis awareness                        what overlaps your work
  codetrellis check <path>                     before an edit: overlaps, and whether a breakpoint holds it
  codetrellis report-tests <junit.xml>         tell CodeTrellis how the tests went

  <task> is a uid, or its first characters ("6cb8cf43", "task 6cb8cf43").
  Exit codes: 0 done, 1 refused, 2 usage, 3 held or not answered yet.
`;
