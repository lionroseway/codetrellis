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
 * Two packaged formats run from somewhere that is not where they live, and
 * need more than that:
 *
 * - **Linux AppImage.** The runtime mounts the image at `/tmp/.mount_<random>`
 *   on every launch, so `execPath` and `resourcesPath` name a directory that
 *   is gone once the app quits. The config names the AppImage file instead
 *   (`$APPIMAGE`, which the runtime sets), and the script is found from the
 *   binary that is running — see `appImageCommand`.
 * - **Windows portable `.exe`.** Unpacks to `%TEMP%\<build id>` on each launch
 *   and deletes it on exit. The portable file itself cannot be the command:
 *   its launcher starts the app without handing on stdin/stdout. So the
 *   command is the unpacked one, which is the same path for every launch of
 *   one build — and it comes with a caveat saying what that costs.
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
  /**
   * Set when this config does NOT keep working across every restart and
   * update: one sentence, shown wherever the config is copied, saying when
   * it stops and what to use instead.
   */
  caveat?: string;
}

/**
 * The variables the packaged formats' launchers set. Only these are read;
 * the rest of the environment has no say in the command.
 */
export interface LaunchEnv {
  /** AppImage runtime: absolute path of the `.AppImage` file. */
  APPIMAGE?: string;
  /** AppImage runtime: where it mounted the image for this launch. */
  APPDIR?: string;
  /** electron-builder portable launcher: absolute path of the portable `.exe`. */
  PORTABLE_EXECUTABLE_FILE?: string;
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
  /** Defaults to none: a plain install. */
  env?: LaunchEnv;
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
  const packaged = isPackagedElectron(input);
  const script = packaged
    ? (input.resourcesPath ? path.join(input.resourcesPath, 'connector', CONNECTOR_SCRIPT) : null)
    : path.join(input.cwd, 'out', 'connector', CONNECTOR_SCRIPT);
  if (!script || !input.exists(script)) return null;

  if (packaged) {
    const appImage = runningAppImage(input);
    if (appImage) return appImageCommand(appImage, input.dataDir);
  }

  const cmd: ConnectorCommand = {
    command: input.execPath,
    args: [script, '--data-dir', input.dataDir],
    env: input.electronVersion ? { ELECTRON_RUN_AS_NODE: '1' } : {},
  };
  if (packaged && input.env?.PORTABLE_EXECUTABLE_FILE) cmd.caveat = PORTABLE_CAVEAT;
  return cmd;
}

/**
 * Evaluated by the AppImage's own binary in Node mode: load the connector
 * from that binary's resources. `process.resourcesPath` is Electron's, set
 * from where the running executable is — this launch's mount, inside the
 * image the config names. A constant, so nothing about the machine or the
 * request is ever spliced into code.
 */
export const APPIMAGE_BOOTSTRAP = `require(require('path').join(process.resourcesPath, 'connector', '${CONNECTOR_SCRIPT}'))`;

/**
 * Said wherever a portable build's config is copied. It holds for every
 * launch of this build, but the folder it names exists only while the app is
 * open, and the next version unpacks somewhere else.
 */
export const PORTABLE_CAVEAT =
  'This is the portable build: the connector starts only while CodeTrellis is open, '
  + 'and this config must be copied again after updating. The Windows installer gives a config that always works.';

/**
 * The `.AppImage` file this app was launched from, or null when it was not.
 *
 * `APPIMAGE` alone is not enough: it is an ordinary environment variable, and
 * a `.deb` install started from a shell that happens to carry one must not
 * hand agents a command for some other file. So it counts only when this
 * binary really is running from the mount the runtime made (`APPDIR`), and
 * the file is still there.
 */
function runningAppImage(input: ResolveInput): string | null {
  const { APPIMAGE, APPDIR } = input.env ?? {};
  if (!APPIMAGE || !APPDIR || !path.isAbsolute(APPIMAGE) || !path.isAbsolute(APPDIR)) return null;
  // AppRun runs "$APPDIR/<executable>", so the binary sits directly in it.
  if (path.dirname(input.execPath) !== path.resolve(APPDIR)) return null;
  return input.exists(APPIMAGE) ? APPIMAGE : null;
}

/**
 * The AppImage file itself, in Node mode. Each run mounts the image afresh,
 * and electron-builder's AppRun execs the bundled binary with our arguments,
 * so the command outlives every mount.
 *
 * - `-e APPIMAGE_BOOTSTRAP`, not a script path: the script's path is inside
 *   the mount, and changes every run.
 * - `--` ends Node's options. Without it Node reads `--data-dir` as one of
 *   its own and exits with "bad option".
 * - `--no-sandbox` is there for AppRun, not for us. When `unshare -Ur true`
 *   fails (Ubuntu 24.04's default AppArmor policy) AppRun puts
 *   `--no-sandbox` FIRST unless some argument already is one — and first,
 *   Node rejects it the same way. After `--` it is only an entry in
 *   `process.argv` that the connector never reads. Node mode starts no
 *   renderer, so there is no sandbox for it to turn off.
 */
function appImageCommand(appImage: string, dataDir: string): ConnectorCommand {
  return {
    command: appImage,
    args: ['-e', APPIMAGE_BOOTSTRAP, '--', '--data-dir', dataDir, '--no-sandbox'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
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
