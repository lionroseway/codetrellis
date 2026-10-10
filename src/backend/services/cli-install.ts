/**
 * The `codetrellis` command from the desktop app, as Ollama's or VS Code's
 * `code` comes with theirs: the app carries the CLI (`<resources>/cli/`,
 * the same build as the npm package) and puts a `codetrellis` on the PATH
 * that runs it on the app's own binary in Node mode, so no Node install is
 * needed and it always matches the app's version.
 *
 * Where it goes, one answer per way the app is installed:
 *
 * - **macOS:** a link at `/usr/local/bin/codetrellis` to the launcher inside
 *   the app bundle, which survives updates in place. Making it asks for an
 *   administrator's password unless that folder is already writable.
 * - **Linux .deb / .rpm:** the same link in `~/.local/bin`. No password.
 * - **Linux AppImage:** the image mounts somewhere new on every launch, so a
 *   link would break. A small launcher in `~/.local/bin` names the AppImage
 *   file itself; the app rewrites it on launch if that file has moved.
 * - **Windows installer:** the launcher's folder is added to the user's PATH.
 * - **Windows portable and a checkout:** refused, and why. The portable build
 *   unpacks to a temporary folder; a checkout has `npm link`.
 *
 * A person's action, from the app window only (an IPC handler, never HTTP or
 * MCP), shown before it is done. Nothing is replaced that is not ours unless
 * they say so: a `codetrellis` from npm at the same place is named, not
 * overwritten silently.
 */

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isPackagedElectron } from '../mcp/connector/command';

/** Inside every launcher this service writes, so it can tell its own from anyone else's. */
export const LAUNCHER_MARK = 'Written by the CodeTrellis app';

export interface CliMachine {
  platform: NodeJS.Platform;
  home: string;
  execPath: string;
  resourcesPath: string | undefined;
  electronVersion: string | undefined;
  env: { APPIMAGE?: string; APPDIR?: string; PORTABLE_EXECUTABLE_FILE?: string; PATH?: string };
  /** Where the macOS link goes; `/usr/local/bin` unless a test says otherwise. */
  macBin?: string;
  /** The user's own PATH as Windows keeps it (HKCU\Environment), or null. */
  windowsUserPath?: () => string | null;
}

export type CliState = 'installed' | 'missing' | 'stale' | 'other';

export type CliPlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      how: 'link' | 'launcher' | 'path';
      /** The `codetrellis` the shell will find (a folder, for `path`). */
      target: string;
      /** What it runs: the app's own launcher. */
      source: string;
      admin: boolean;
      state: CliState;
      /** When `other`: what is there now. */
      existing?: string;
      /** Whether the target's folder is on the PATH the app was started with. */
      onPath: boolean;
      /** One sentence: what Install will do. */
      says: string;
    };

const join = (m: CliMachine, ...p: string[]) => (m.platform === 'win32' ? path.win32.join(...p) : path.posix.join(...p));

function onPathOf(m: CliMachine, dir: string): boolean {
  const list = (m.env.PATH ?? '').split(m.platform === 'win32' ? ';' : ':').map((d) => d.replace(/[\\/]+$/, ''));
  return list.some((d) => (m.platform === 'win32' ? d.toLowerCase() === dir.toLowerCase() : d === dir));
}

/** The launcher an AppImage install writes: the image file, in Node mode, loading the CLI from its own mount. */
export function appImageLauncher(appImage: string): string {
  const q = `'${appImage.replace(/'/g, `'\\''`)}'`;
  return [
    '#!/bin/sh',
    `# codetrellis: ${LAUNCHER_MARK} for the AppImage below; it rewrites this`,
    '# file if the AppImage moves. Runs the CLI the app carries, in Node mode.',
    `ELECTRON_RUN_AS_NODE=1 exec ${q} -e "require(require('path').join(process.resourcesPath, 'cli', 'bin', 'app.cjs'))" -- "$@"`,
    '',
  ].join('\n');
}

function readLink(p: string): string | null {
  try { return fs.readlinkSync(p); } catch { return null; }
}
function readText(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function present(p: string): boolean {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

/** Is `p` one of ours: a link to some copy of the app's launcher, or a launcher we wrote? */
function oursAt(p: string): boolean {
  const link = readLink(p);
  if (link) return /[\\/]cli[\\/]bin[\\/]codetrellis$/.test(link);
  return (readText(p) ?? '').includes(LAUNCHER_MARK);
}

export function planCliInstall(m: CliMachine): CliPlan {
  if (!isPackagedElectron({ execPath: m.execPath, electronVersion: m.electronVersion }) || !m.resourcesPath) {
    return { ok: false, reason: 'Only the installed app can add the codetrellis command. From a checkout, run npm link; anywhere, npm install -g codetrellis.' };
  }
  if (m.platform === 'win32' && m.env.PORTABLE_EXECUTABLE_FILE) {
    return { ok: false, reason: 'The portable build unpacks to a temporary folder each time it starts, so a command on the PATH would stop working. Use the installer, or npm install -g codetrellis.' };
  }
  const binDir = join(m, m.resourcesPath, 'cli', 'bin');

  if (m.platform === 'win32') {
    const userPath = m.windowsUserPath?.() ?? '';
    const has = userPath.split(';').some((d) => d.replace(/[\\/]+$/, '').toLowerCase() === binDir.toLowerCase());
    return {
      ok: true, how: 'path', target: binDir, source: join(m, binDir, 'codetrellis.cmd'), admin: false,
      state: has ? 'installed' : 'missing', onPath: onPathOf(m, binDir),
      says: `Adds ${binDir} to your PATH. Open a new terminal afterwards.`,
    };
  }

  const localBin = path.posix.join(m.home, '.local', 'bin');
  const appImage = m.platform === 'linux' && m.env.APPIMAGE && m.env.APPDIR && path.isAbsolute(m.env.APPIMAGE) && m.resourcesPath.startsWith(m.env.APPDIR)
    ? m.env.APPIMAGE : null;
  const source = appImage ?? path.posix.join(binDir, 'codetrellis');
  const how: 'link' | 'launcher' = appImage ? 'launcher' : 'link';
  const target = m.platform === 'darwin' ? path.posix.join(m.macBin ?? '/usr/local/bin', 'codetrellis') : path.posix.join(localBin, 'codetrellis');
  const dir = path.posix.dirname(target);
  const admin = m.platform === 'darwin' && !writable(dir);

  let state: CliState = 'missing';
  let existing: string | undefined;
  if (present(target)) {
    const link = readLink(target);
    if (how === 'link' && link === source) state = 'installed';
    else if (how === 'launcher' && readText(target) === appImageLauncher(appImage!)) state = 'installed';
    else if (oursAt(target)) state = 'stale';
    else { state = 'other'; existing = link ? `a link to ${link}` : 'a file CodeTrellis did not write'; }
  }
  const says = how === 'launcher'
    ? `Writes ${target}, which runs this AppImage as the codetrellis command.`
    : `Links ${target} to the codetrellis command inside the app${admin ? '. macOS asks for your password to write there' : ''}.`;
  return { ok: true, how, target, source, admin, state, existing, onPath: onPathOf(m, dir), says };
}

function writable(dir: string): boolean {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

/** An AppleScript string literal. */
const appleString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Runs a program to completion; rejects on a non-zero exit. Injected by tests. */
export type Run = (command: string, args: string[], env?: Record<string, string>) => Promise<void>;

const runProgram: Run = (command, args, env) => new Promise((resolve, reject) => {
  // Asynchronous: macOS's password prompt can stay up a while, and the app's
  // window must not freeze behind it.
  execFile(command, args, { env: env ? { ...process.env, ...env } : process.env }, (err) => (err ? reject(err) : resolve()));
});

export type CliApplied = { ok: true; target: string; onPath: boolean } | { ok: false; reason: string };

/**
 * Do what the plan says. `replace` must be true to take the place of a
 * `codetrellis` that is not ours (state `other`): the person was shown what
 * is there.
 */
export async function applyCliInstall(m: CliMachine, opts: { replace?: boolean } = {}, run: Run = runProgram): Promise<CliApplied> {
  const plan = planCliInstall(m);
  if (!plan.ok) return plan;
  if (plan.state === 'installed') return { ok: true, target: plan.target, onPath: plan.onPath };
  if (plan.state === 'other' && !opts.replace) {
    return { ok: false, reason: `${plan.target} is already ${plan.existing}. Choose Replace to put the app's command there instead.` };
  }
  try {
    if (plan.how === 'path') {
      // The folder reaches PowerShell through the environment, never spliced
      // into the command, and only ever this app's own resources folder.
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not $p) { $p='' }; "
        + "$parts=@($p -split ';' | Where-Object { $_ -and ($_.TrimEnd('\\') -ne $env:CT_DIR.TrimEnd('\\')) }); "
        + "[Environment]::SetEnvironmentVariable('Path', (($parts + $env:CT_DIR) -join ';'), 'User')"],
      { CT_DIR: plan.target });
    } else if (plan.how === 'launcher') {
      fs.mkdirSync(path.posix.dirname(plan.target), { recursive: true });
      if (present(plan.target)) fs.rmSync(plan.target, { force: true });
      fs.writeFileSync(plan.target, appImageLauncher(plan.source), { mode: 0o755 });
    } else if (plan.admin) {
      const dir = path.posix.dirname(plan.target);
      const script = `do shell script "mkdir -p " & quoted form of ${appleString(dir)} & " && ln -sf " & quoted form of ${appleString(plan.source)} & " " & quoted form of ${appleString(plan.target)} with administrator privileges`;
      await run('osascript', ['-e', script]);
    } else {
      fs.mkdirSync(path.posix.dirname(plan.target), { recursive: true });
      if (present(plan.target)) fs.rmSync(plan.target, { force: true });
      fs.symlinkSync(plan.source, plan.target);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: /User canceled|-128/.test(msg) ? 'Cancelled: macOS did not get the password.' : `Could not add the command: ${msg}` };
  }
  const after = planCliInstall(m);
  // Windows: the registry is read back; elsewhere, the link or file itself.
  if (!after.ok || after.state !== 'installed') return { ok: false, reason: `The command was not added at ${plan.target}.` };
  return { ok: true, target: after.target, onPath: after.onPath };
}

/**
 * On launch: keep a command the person already added pointing at this app,
 * where that needs no password. An AppImage that moved, or a .deb install
 * whose link names an old folder. Never adds one that is not there, and never
 * touches one that is not ours.
 */
export async function refreshCliInstall(m: CliMachine): Promise<boolean> {
  const plan = planCliInstall(m);
  if (!plan.ok || plan.state !== 'stale' || plan.admin || plan.how === 'path') return false;
  return (await applyCliInstall(m)).ok;
}

/** Remove the command, if it is ours. */
export async function removeCliInstall(m: CliMachine, run: Run = runProgram): Promise<CliApplied> {
  const plan = planCliInstall(m);
  if (!plan.ok) return plan;
  if (plan.state === 'missing') return { ok: true, target: plan.target, onPath: plan.onPath };
  if (plan.state === 'other') return { ok: false, reason: `${plan.target} is not CodeTrellis's; it was left as it is.` };
  try {
    if (plan.how === 'path') {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not $p) { $p='' }; "
        + "[Environment]::SetEnvironmentVariable('Path', ((@($p -split ';' | Where-Object { $_ -and ($_.TrimEnd('\\') -ne $env:CT_DIR.TrimEnd('\\')) })) -join ';'), 'User')"],
      { CT_DIR: plan.target });
    } else if (plan.admin) {
      await run('osascript', ['-e', `do shell script "rm -f " & quoted form of ${appleString(plan.target)} with administrator privileges`]);
    } else {
      fs.rmSync(plan.target, { force: true });
    }
  } catch (err) {
    return { ok: false, reason: `Could not remove the command: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, target: plan.target, onPath: plan.onPath };
}

/** This machine, as the app sees it. */
export function thisCliMachine(): CliMachine {
  return {
    platform: process.platform,
    home: process.env.HOME || process.env.USERPROFILE || '',
    execPath: process.execPath,
    resourcesPath: (process as { resourcesPath?: string }).resourcesPath,
    electronVersion: process.versions.electron,
    env: {
      APPIMAGE: process.env.APPIMAGE, APPDIR: process.env.APPDIR,
      PORTABLE_EXECUTABLE_FILE: process.env.PORTABLE_EXECUTABLE_FILE, PATH: process.env.PATH,
    },
    windowsUserPath: () => {
      try {
        const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(out)?.[1]?.trim() ?? null;
      } catch { return null; }
    },
  };
}

