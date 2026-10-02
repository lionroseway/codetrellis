/**
 * Phase 32 A8.3 — the breakpoint hook for Gemini CLI, offered from Settings.
 *
 * One `BeforeTool` entry merged into Gemini CLI's user settings
 * (`~/.gemini/settings.json`, or under `$GEMINI_CLI_HOME`): the connector in
 * Gemini hook mode (`connector/hook.ts`, `runGeminiBeforeToolHook`), before
 * `write_file` and `replace`. It holds an edit a person's breakpoint holds,
 * and nothing else. The format was checked against Gemini CLI's own source;
 * see the note in `connector/hook.ts`.
 *
 * The same rules as Claude Code's installer (claude-code-parallel.ts), point
 * for point, because it is the same act:
 *  - Reachable only from the app's own window (Electron IPC), never HTTP or
 *    MCP: an agent must not install a hook into its own client.
 *  - The entry is decided here, from the connector command this app resolved;
 *    the renderer sends only the hash of the file it was shown.
 *  - `preview` shows the change as a diff; `apply` writes only if the file is
 *    still the one shown, keeps a timestamped copy first, writes atomically
 *    and refuses links (confined-fs, rooted at Gemini CLI's folder).
 *  - A settings file that is not valid JSON, or whose `hooks` is not what
 *    Gemini CLI reads, is left alone with a sentence saying why; every other
 *    setting and hook is kept as it was.
 *  - Gemini CLI's folder must already exist: this does not configure an app
 *    that has never run.
 *  - The command is quoted for the shell Gemini CLI runs it in (bash, or
 *    PowerShell on Windows); the connector's environment is the entry's `env`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shellQuote, type ConnectorCommand } from '../mcp/connector/command';
import { HOOK_FLAG, HOOK_GEMINI_BEFORE_TOOL, GEMINI_HOOK_MATCHER } from '../mcp/connector/hook';
import { hashOf, lineDiff, type DiffLine } from './claude-desktop-config';
import { readTextWithin, writeFileWithin } from './confined-fs';

export const GEMINI_SETTINGS_FILE = 'settings.json';
/** Milliseconds: Gemini CLI's hook timeout is in ms. The hook gives up by itself after five seconds. */
export const GEMINI_HOOK_TIMEOUT_MS = 10_000;
export const GEMINI_HOOK_NAME = 'codetrellis-breakpoints';

export interface GeminiWhere {
  home: string;
  env: Record<string, string | undefined>;
  exists: (p: string) => boolean;
}

/** Gemini CLI's user folder on this machine, or null when it has none. */
export function geminiDir(w: GeminiWhere): string | null {
  const dir = path.join(w.env.GEMINI_CLI_HOME?.trim() || w.home, '.gemini');
  return w.exists(dir) ? dir : null;
}

/** A word for PowerShell: single-quoted, a quote inside doubled. */
const psQuote = (arg: string) => `'${arg.replace(/'/g, "''")}'`;

/**
 * The hook's command line. Gemini CLI runs it through `bash -c` on macOS and
 * Linux and through PowerShell on Windows (its `getShellConfiguration`), so it
 * is quoted for that shell; the connector's environment goes in the entry's
 * own `env`, which Gemini CLI sets for the hook, not as a shell prefix.
 */
export function geminiHookCommand(connector: ConnectorCommand, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return ['&', psQuote(connector.command), ...connector.args.map(psQuote), HOOK_FLAG, HOOK_GEMINI_BEFORE_TOOL].join(' ');
  }
  return [shellQuote(connector.command, 'linux'), ...connector.args.map((a) => shellQuote(a, 'linux')), HOOK_FLAG, HOOK_GEMINI_BEFORE_TOOL].join(' ');
}

/** Ours, whichever build wrote it: the connector script in Gemini hook mode. */
const isOurHook = (h: unknown): boolean =>
  !!h && typeof h === 'object' && typeof (h as { command?: unknown }).command === 'string'
  && /mcp-connector\.cjs/.test((h as { command: string }).command)
  && (h as { command: string }).command.includes(`${HOOK_FLAG} ${HOOK_GEMINI_BEFORE_TOOL}`);

export type Status = 'add' | 'update' | 'unchanged';
export type Plan =
  | { ok: true; status: Status; before: string; after: string; diff: DiffLine[] }
  | { ok: false; reason: string };

/** `settings.json` with our hook in `hooks.BeforeTool`, replacing an older one of ours and nothing else. */
export function planGeminiHook(current: string | null, command: string, env: Record<string, string> = {}): Plan {
  let doc: Record<string, unknown> = {};
  if (current !== null && current.trim() !== '') {
    let parsed: unknown;
    try { parsed = JSON.parse(current); } catch {
      return { ok: false, reason: "Gemini CLI's settings.json is not valid JSON, so it was left alone. Fix it, then try again." };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: "Gemini CLI's settings.json is not a JSON object, so it was left alone." };
    }
    doc = parsed as Record<string, unknown>;
  }
  const hooks = doc.hooks ?? {};
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return { ok: false, reason: 'Gemini CLI\'s settings have a "hooks" that is not an object, so they were left alone.' };
  }
  const before = (hooks as Record<string, unknown>).BeforeTool ?? [];
  if (!Array.isArray(before)) {
    return { ok: false, reason: 'Gemini CLI\'s settings have a "BeforeTool" that is not a list, so they were left alone.' };
  }
  const ours = { type: 'command', name: GEMINI_HOOK_NAME, command, ...(Object.keys(env).length ? { env } : {}), timeout: GEMINI_HOOK_TIMEOUT_MS };
  let placed = false;
  const kept = before.flatMap((group: unknown) => {
    const g = group as { hooks?: unknown };
    if (!g || typeof g !== 'object' || !Array.isArray(g.hooks) || !g.hooks.some(isOurHook)) return [group];
    const others = g.hooks.filter((h) => !isOurHook(h));
    const mine = placed ? [] : [{ matcher: GEMINI_HOOK_MATCHER, hooks: [ours] }];
    placed = true;
    return [...mine, ...(others.length ? [{ ...g, hooks: others }] : [])];
  });
  const next = placed ? kept : [...kept, { matcher: GEMINI_HOOK_MATCHER, hooks: [ours] }];
  const merged = { ...doc, hooks: { ...(hooks as Record<string, unknown>), BeforeTool: next } };
  const text = current ?? '';
  const unchanged = current !== null && JSON.stringify(JSON.parse(current || '{}')) === JSON.stringify(merged);
  const after = unchanged ? text : `${JSON.stringify(merged, null, 2)}\n`;
  const status: Status = text === after ? 'unchanged' : current !== null ? 'update' : 'add';
  return { ok: true, status, before: text, after, diff: status === 'unchanged' ? [] : lineDiff(text, after) };
}

export type Preview =
  | { ok: true; dir: string; path: string; status: Status; diff: DiffLine[]; beforeHash: string; exists: boolean; caveat?: string }
  | { ok: false; reason: string };

const NO_DIR = "Gemini CLI's settings folder (~/.gemini) was not found on this computer. Install Gemini CLI and run it once, then try again.";
const NO_CONNECTOR = 'The connector is not built in this checkout, so there is no hook to add yet (npm run build:connector).';

function readCurrent(dir: string): { text: string | null } | { error: string } {
  if (!fs.existsSync(path.join(dir, GEMINI_SETTINGS_FILE))) return { text: null };
  try {
    return { text: readTextWithin(dir, GEMINI_SETTINGS_FILE, 'Gemini CLI settings') };
  } catch {
    return { error: "Gemini CLI's settings.json could not be read (it may be a link, which is not followed), so it was left alone." };
  }
}

export function previewGeminiHook(where: GeminiWhere, connector: ConnectorCommand | null): Preview {
  const dir = geminiDir(where);
  if (!dir) return { ok: false, reason: NO_DIR };
  if (!connector) return { ok: false, reason: NO_CONNECTOR };
  const current = readCurrent(dir);
  if ('error' in current) return { ok: false, reason: current.error };
  const plan = planGeminiHook(current.text, geminiHookCommand(connector), connector.env);
  if (!plan.ok) return plan;
  return {
    ok: true, dir, path: path.join(dir, GEMINI_SETTINGS_FILE), status: plan.status, diff: plan.diff,
    beforeHash: hashOf(current.text), exists: current.text !== null,
    ...(connector.caveat ? { caveat: connector.caveat } : {}),
  };
}

export type Applied =
  | { ok: true; path: string; backupPath: string | null; status: Status }
  | { ok: false; reason: string; changed?: boolean };

const stampOf = (now: Date) => now.toISOString().replace(/[:.]/g, '-');

/** Write the hook, only if the settings file is still the one shown. */
export function applyGeminiHook(where: GeminiWhere, connector: ConnectorCommand | null, shownHash: string, now = new Date()): Applied {
  const dir = geminiDir(where);
  if (!dir) return { ok: false, reason: NO_DIR };
  if (!connector) return { ok: false, reason: NO_CONNECTOR };
  const current = readCurrent(dir);
  if ('error' in current) return { ok: false, reason: current.error };
  if (hashOf(current.text) !== shownHash) {
    return { ok: false, changed: true, reason: "Gemini CLI's settings.json changed after you looked at it. Here is the change again, against the file as it is now." };
  }
  const plan = planGeminiHook(current.text, geminiHookCommand(connector), connector.env);
  if (!plan.ok) return plan;
  const target = path.join(dir, GEMINI_SETTINGS_FILE);
  if (plan.status === 'unchanged') return { ok: true, path: target, backupPath: null, status: 'unchanged' };
  try {
    let backupPath: string | null = null;
    if (current.text !== null) {
      backupPath = writeFileWithin(dir, `settings.before-codetrellis-${stampOf(now)}.json`, current.text, 'Gemini CLI settings backup');
    }
    writeFileWithin(dir, GEMINI_SETTINGS_FILE, plan.after, 'Gemini CLI settings');
    return { ok: true, path: target, backupPath, status: plan.status };
  } catch {
    return { ok: false, reason: "Gemini CLI's settings.json could not be written (a link at its place is not written through)." };
  }
}

/** This machine, for the Electron main process. */
export function thisMachine(): GeminiWhere {
  return { home: os.homedir(), env: process.env, exists: (p) => fs.existsSync(p) };
}
