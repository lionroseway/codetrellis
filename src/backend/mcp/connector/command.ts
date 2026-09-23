/**
 * The command an agent's config should run to reach this app.
 *
 * Three ways the backend can be running, one answer each:
 *
 * - **Packaged app.** The connector ships beside the asar, under
 *   `<resourcesPath>/connector/`, and runs on the app's own binary with
 *   `ELECTRON_RUN_AS_NODE=1` — so no Node install, no window, no dock icon.
 *   Outside the asar on purpose: a script inside it would depend on Electron
 *   resolving asar paths in Node mode, and nothing is gained by depending on
 *   that.
 * - **Electron from source** (`npm run dev:electron`). Same binary trick, with
 *   the script built into `out/connector/` by `npm run build:connector`.
 * - **Web dev** (`npm run dev`, the backend under tsx). The backend IS Node,
 *   so `process.execPath` runs the built script directly.
 *
 * `null` means no connector script exists — a dev checkout that never ran
 * `build:connector`. The copy surfaces then fall back to the direct config,
 * and say why.
 */

import path from 'node:path';

export const CONNECTOR_SCRIPT = 'mcp-connector.cjs';

export interface ConnectorCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ResolveInput {
  execPath: string;
  /** `process.versions.electron` — set when running inside Electron. */
  electronVersion: string | undefined;
  /** `process.resourcesPath` — only meaningful inside Electron. */
  resourcesPath: string | undefined;
  cwd: string;
  dataDir: string;
  exists: (p: string) => boolean;
}

/**
 * Packaged, rather than Electron run from a checkout. The dev binary lives in
 * `node_modules/electron/dist`; an installed app's does not.
 */
export function isPackagedElectron(input: Pick<ResolveInput, 'execPath' | 'electronVersion'>): boolean {
  return !!input.electronVersion && !/[\\/]node_modules[\\/]electron[\\/]/.test(input.execPath);
}

export function resolveConnectorCommand(input: ResolveInput): ConnectorCommand | null {
  // A packaged app only ever runs the script it shipped. The checkout path is
  // for source runs; offering it from an installed app would hand an agent's
  // config whatever file happened to sit under the launch directory.
  const script = isPackagedElectron(input)
    ? (input.resourcesPath ? path.join(input.resourcesPath, 'connector', CONNECTOR_SCRIPT) : null)
    : path.join(input.cwd, 'out', 'connector', CONNECTOR_SCRIPT);
  if (!script || !input.exists(script)) return null;

  return {
    command: input.execPath,
    args: [script, '--data-dir', input.dataDir],
    env: input.electronVersion ? { ELECTRON_RUN_AS_NODE: '1' } : {},
  };
}

/** Quote one argument for a POSIX shell or cmd.exe, only when it needs it. */
export function shellQuote(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (/^[\w@%+=:,./\\-]+$/.test(arg)) return arg;
  if (platform === 'win32') return `"${arg.replace(/"/g, '\\"')}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * `claude mcp add` for the connector, user-scoped so it works in every
 * project. The env var is set with `-e`, so the command runs the same from
 * any shell, and nothing in it is a secret.
 */
export function claudeCodeConnectorCommand(cmd: ConnectorCommand, platform: NodeJS.Platform = process.platform): string {
  const env = Object.entries(cmd.env).map(([k, v]) => `-e ${k}=${v}`);
  return [
    'claude mcp add codetrellis --scope user',
    ...env,
    '--',
    shellQuote(cmd.command, platform),
    ...cmd.args.map((a) => shellQuote(a, platform)),
  ].join(' ');
}

/** The `mcpServers` entry: Claude Desktop, Cursor, and most other clients. */
export function connectorConfig(cmd: ConnectorCommand): Record<string, unknown> {
  return {
    codetrellis: {
      command: cmd.command,
      args: cmd.args,
      ...(Object.keys(cmd.env).length > 0 ? { env: cmd.env } : {}),
    },
  };
}
