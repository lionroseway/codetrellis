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
const SWITCHES = new Set(['json', 'help', 'no-wait', 'quiet', 'share-task-state', 'top', 'page', 'strict', 'no-color', 'verify', 'post', 'pipeline', 'require', 'no-fetch', 'no-open']);

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
    // git's own short form for a commit message: `codetrellis commit -m "…"`.
    if (a === '-m' && i + 1 < argv.length) { flags.m = argv[++i]; continue; }
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
  const resolved = path.resolve(projectRoot);
  const id = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 10);
  const name = path.basename(resolved).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  return path.join(headlessCacheRoot(env, home, platform), `${name}-${id}`);
}

/**
 * The folder every project's headless data sits in: the platform's own user
 * cache (~/Library/Caches on macOS, LOCALAPPDATA on Windows, XDG elsewhere),
 * then `codetrellis`. Tests ask this rather than spelling one platform's.
 */
export function headlessCacheRoot(
  env: NodeJS.ProcessEnv,
  home: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const cache = platform === 'darwin'
    ? path.join(home, 'Library', 'Caches')
    : platform === 'win32'
      ? (env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'))
      : (env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(home, '.cache'));
  return path.join(cache, 'codetrellis');
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
 * How to run this CLI again: for a child it starts (`start`'s serve, the
 * review sink an agent launches) and for the config it prints. From npm or
 * a checkout, Node and the launcher. Inside the desktop app (the CLI it
 * carries, `resources/cli/`), the app's own binary on `bin/app.cjs`, which
 * only acts as Node with ELECTRON_RUN_AS_NODE set: without it, the child
 * would open the app's window instead.
 */
export interface SelfCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function selfCommand(binDir: string, proc: { execPath: string; electron?: string }): SelfCommand {
  if (proc.electron) return { command: proc.execPath, args: [path.join(binDir, 'app.cjs')], env: { ELECTRON_RUN_AS_NODE: '1' } };
  return { command: proc.execPath, args: [path.join(binDir, 'codetrellis.mjs')], env: {} };
}

/**
 * The line an agent's config needs: this CLI's own `mcp` command, for the
 * data dir given. No token: the connector reads it on every connect.
 */
export function connectorLine(self: SelfCommand, dataDir: string): ConnectorLine {
  const args = [...self.args, 'mcp', '--data-dir', dataDir];
  const env = Object.keys(self.env).length ? self.env : undefined;
  const envFlags = Object.entries(self.env).map(([k, v]) => `-e ${quote(`${k}=${v}`)} `).join('');
  return {
    command: self.command,
    args,
    claude: `claude mcp add codetrellis ${envFlags}-- ${[self.command, ...args].map(quote).join(' ')}`,
    json: JSON.stringify({ mcpServers: { codetrellis: { command: self.command, args, ...(env ? { env } : {}) } } }),
  };
}

export const USAGE = `codetrellis — CodeTrellis for agents, without the desktop app

  codetrellis serve [--project <dir>] [--data-dir <dir>] [--port <n>] [--mcp-port <n>] [--share-task-state] [--json]
      Run the backend headless for a project: loopback only, the capability
      token on every transport, no discovery, peers or update check. Prints
      the line an agent's MCP config needs. --share-task-state writes task
      state and test runs to the project's files and reads teammates', as the
      app's Settings switch does.

  codetrellis scan [--project <dir>] [--data-dir <dir>] [--json]
      Scan a project once and print what was found, then exit.

  codetrellis start [--project <dir>] [--data-dir <dir>] [--timeout <s>] [--share-task-state] [--quiet | --json]
      serve in the background, unless it already runs for this folder; for a
      session-start hook or a CI step. Its log is serve.log in the data dir.

  codetrellis stop [--project <dir>] [--data-dir <dir>]

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
  codetrellis check [--base <ref>] [--strict]  does this work conform? exit 3 when a breakpoint holds a
                                               changed file, its tests fail or are older than the code, a
                                               done task fails its checks, a doc describing it is stale,
                                               it adds an import a rule at block forbids, or it loosens a
                                               rule; a rule at warn is said and passes (--strict: it fails)
  codetrellis check --format sarif             the same, as SARIF 2.1.0 for any CI host (or text, json, markdown)
  codetrellis check --no-color                 plain text in a terminal too (NO_COLOR does the same)
  codetrellis check --suite <s> | --rule <id> | --path <p> | --tag <t>
                                               only those rules (comma-separated): one suite's, named
                                               rules, the rules about a path, or those with a tag
  codetrellis check --pipeline [--stage <id>]  the base's .codetrellis/pipeline.yaml, stage by stage; agent
                                               stages too with --agent and the review's flags
  codetrellis rules baseline                   record each rule's breaches now; the check then fails on
                                               any it does not list, and the file may only shrink
  codetrellis report-tests <junit.xml>         tell CodeTrellis how the tests went
  codetrellis review [--agent claude-code] [--model <m>] [--endpoint <url>] [--auth env:<VAR>]
                     [--skills <dir>] [--suite <s> | --rule <id> | --path <p> | --tag <t>] [--base <ref>] [--task <uid>]
                     [--max-turns <n>] [--timeout <s>] [--max-tool-calls <n>] [--fail-on block,error] [--verify]
                     [--format text|markdown|sarif|json] [--sarif-out <f>] [--markdown-out <f>] [--post [--pr <n>]]
                                               your own agent reviews the change, headless, with no shell,
                                               files or web; each finding must cite the diff, and each pass
                                               is kept as a check run. --verify: a second pass tries to refute
                                               each finding. --auth oidc:bedrock|vertex|foundry signs in through
                                               your cloud. --post comments on the pull request. Advisory: exit 3
                                               only with --fail-on. A review of a commit is signed with this
                                               device's key, as a git note on it
  codetrellis review publish [--remote <r>]    push the signed reviews, for CI to read
  codetrellis review verify --base <ref> [--head <ref>] [--require] [--format text|markdown|sarif|json]
                                               the head's signed review, checked against the keys on the base:
                                               verified, stale (of an earlier commit), refused, or none; no
                                               app, no secret, no AI. --require: exit 3 unless verified

The desktop app:

  codetrellis desktop install [--version <v>] [--platform <p>] [--dir <d>] [--no-open] [--json]
                                               download the app for this computer (or --platform:
                                               darwin-arm64, darwin-x64, win32-x64, win32-arm64, linux-x64,
                                               linux-arm64), check it against the release's signed
                                               checksums, save it to --dir (default ~/Downloads) and open it
  codetrellis desktop url [--version <v>] [--platform <p>] [--json]
                                               the installer's download link, without downloading

  codetrellis --version                        this CLI's version

Changing and committing the plan:

  codetrellis plan show [--plan <uid>]
  codetrellis plan add <title…> [--under <task>] [--page] [--body <text>]
  codetrellis plan edit <task> [--title <text>] [--body <text>]
  codetrellis plan move <task> (--under <task> | --top) [--position N]
  codetrellis commit [-m <subject>]            commits only CodeTrellis's own files (.codetrellis/)
  codetrellis status [--base <ref>] [--strict] plans, what is under way, blocked, and waiting on you,
                                               and whether this work conforms (exit 3 when not)

  <task> is a uid, or its first characters ("6cb8cf43", "task 6cb8cf43").
  Exit codes: 0 done, 1 refused, 2 usage, 3 held, not answered yet, or not conforming.
  This work is the branch since its base (--base, else the pull request's
  base in GitHub Actions, else origin's default branch) and what is not
  committed yet.
`;
