/**
 * Phase 32 A3.4 (awareness spec §6.3) — the `codetrellis-parallel` skill and
 * the optional `PreToolUse` hook, offered to Claude Code from Settings.
 *
 * Two things, each the person's own choice, written to Claude Code's user
 * folder (`~/.claude`, or `$CLAUDE_CONFIG_DIR`):
 *
 *  - **The skill**, `skills/codetrellis-parallel/SKILL.md`: the `parallel`
 *    guide (A3.3) as a skill, so it loads when a developer starts parallel
 *    work. Generated from the guide, never a second copy of it.
 *  - **The hook**, one `PreToolUse` entry merged into `settings.json`: the
 *    connector in hook mode (`connector/hook.ts`), before every edit.
 *
 * It follows Add to Claude Desktop (claude-desktop-config.ts) point for
 * point, because it is the same act: writing another application's files.
 *
 *  - Reachable only from the app's own window (Electron IPC), never HTTP or
 *    MCP: an agent must not be able to install a hook into its own client,
 *    even one holding this launch's token.
 *  - Everything written is decided here: the skill from the guide, the hook
 *    from the connector command this app resolved. Nothing from the renderer
 *    but which of the two to write and the hashes of the files it was shown.
 *  - `preview` shows each change as a diff. `apply` writes only what was
 *    chosen, and only if that file is still the one shown; otherwise nothing
 *    is written and the new diff is shown.
 *  - A file that is replaced is kept beside it first, timestamped; writes are
 *    atomic and refuse links (confined-fs, rooted at Claude Code's folder).
 *  - `settings.json` that is not valid JSON, or whose `hooks` is not what
 *    Claude Code writes, is left alone with a sentence saying why. Every
 *    other setting and every other hook is kept as it was.
 *  - Claude Code's folder must already exist: this does not configure an app
 *    that has never run.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSkillGuide } from '../mcp/skill-guide';
import { shellQuote, type ConnectorCommand } from '../mcp/connector/command';
import { HOOK_FLAG, HOOK_MATCHER, HOOK_PRE_TOOL_USE } from '../mcp/connector/hook';
import { hashOf, lineDiff, type DiffLine } from './claude-desktop-config';
import { readTextWithin, writeFileWithin } from './confined-fs';

export const SKILL_NAME = 'codetrellis-parallel';
export const SKILL_FILE = `skills/${SKILL_NAME}/SKILL.md`;
export const SETTINGS_FILE = 'settings.json';
/** Seconds. The hook gives up by itself after five. */
export const HOOK_TIMEOUT = 10;

export interface ClaudeCodeWhere {
  home: string;
  env: Record<string, string | undefined>;
  exists: (p: string) => boolean;
}

/** Claude Code's user folder on this machine, or null when it has none. */
export function claudeCodeDir(w: ClaudeCodeWhere): string | null {
  const dir = w.env.CLAUDE_CONFIG_DIR?.trim() || path.join(w.home, '.claude');
  return w.exists(dir) ? dir : null;
}

/** The skill file: the `parallel` guide, with what Claude Code needs to load it. */
export function skillText(): string {
  const guide = buildSkillGuide('parallel').replace(/^# .*\n+/, '');
  return [
    '---',
    `name: ${SKILL_NAME}`,
    'description: Working alongside other AI agents in the same repository (other git worktrees, clones or branches), with CodeTrellis running. Use when starting work in a repository where other agents may be working, when planning changes to shared or exported code, or when CodeTrellis reports an overlap with other work.',
    '---',
    '',
    '# Working in parallel, with CodeTrellis',
    '',
    'The tools below are the CodeTrellis MCP server\'s. In Claude Code they are named',
    '`mcp__codetrellis__<tool>` (for example `mcp__codetrellis__get_awareness`). If they',
    'are not available, CodeTrellis is not connected: say so rather than guessing.',
    '',
    'This skill is written by the CodeTrellis app (Settings → Connect an agent). The same',
    'guide is served by the app as `codetrellis://skill/parallel`.',
    '',
    guide.trimEnd(),
    '',
  ].join('\n');
}

/**
 * The hook's command line. Claude Code runs hook commands with a POSIX shell
 * (Git Bash on Windows), so this is POSIX-quoted everywhere, with the
 * connector's environment as a prefix.
 */
export function hookCommand(connector: ConnectorCommand): string {
  const env = Object.entries(connector.env).map(([k, v]) => `${k}=${shellQuote(v, 'linux')}`);
  return [...env, shellQuote(connector.command, 'linux'), ...connector.args.map((a) => shellQuote(a, 'linux')), HOOK_FLAG, HOOK_PRE_TOOL_USE].join(' ');
}

/** Ours, whichever build wrote it: the connector script in hook mode. */
const isOurHook = (h: unknown): boolean =>
  !!h && typeof h === 'object' && typeof (h as { command?: unknown }).command === 'string'
  && /mcp-connector\.cjs/.test((h as { command: string }).command)
  && (h as { command: string }).command.includes(`${HOOK_FLAG} ${HOOK_PRE_TOOL_USE}`);

export type Status = 'add' | 'update' | 'unchanged';
export type Plan =
  | { ok: true; status: Status; before: string; after: string; diff: DiffLine[] }
  | { ok: false; reason: string };

const planned = (before: string, after: string, existed: boolean): Plan => {
  const status: Status = before === after ? 'unchanged' : existed ? 'update' : 'add';
  return { ok: true, status, before, after, diff: status === 'unchanged' ? [] : lineDiff(before, after) };
};

export function planSkill(current: string | null): Plan {
  return planned(current ?? '', skillText(), current !== null);
}

/** `settings.json` with our hook in `hooks.PreToolUse`, replacing an older one of ours and nothing else. */
export function planHook(current: string | null, command: string): Plan {
  let doc: Record<string, unknown> = {};
  if (current !== null && current.trim() !== '') {
    let parsed: unknown;
    try { parsed = JSON.parse(current); } catch {
      return { ok: false, reason: "Claude Code's settings.json is not valid JSON, so it was left alone. Fix it, then try again." };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: "Claude Code's settings.json is not a JSON object, so it was left alone." };
    }
    doc = parsed as Record<string, unknown>;
  }
  const hooks = doc.hooks ?? {};
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return { ok: false, reason: 'Claude Code\'s settings have a "hooks" that is not an object, so they were left alone.' };
  }
  const pre = (hooks as Record<string, unknown>).PreToolUse ?? [];
  if (!Array.isArray(pre)) {
    return { ok: false, reason: 'Claude Code\'s settings have a "PreToolUse" that is not a list, so they were left alone.' };
  }
  const ours = { type: 'command', command, timeout: HOOK_TIMEOUT };
  // An older entry of ours (another install, an earlier version) is replaced in place.
  let placed = false;
  const kept = pre.flatMap((group: unknown) => {
    const g = group as { matcher?: unknown; hooks?: unknown };
    if (!g || typeof g !== 'object' || !Array.isArray(g.hooks) || !g.hooks.some(isOurHook)) return [group];
    const others = g.hooks.filter((h) => !isOurHook(h));
    const mine = placed ? [] : [{ matcher: HOOK_MATCHER, hooks: [ours] }];
    placed = true;
    return [...mine, ...(others.length ? [{ ...g, hooks: others }] : [])];
  });
  const next = placed ? kept : [...kept, { matcher: HOOK_MATCHER, hooks: [ours] }];
  const merged = { ...doc, hooks: { ...(hooks as Record<string, unknown>), PreToolUse: next } };
  const before = current ?? '';
  const unchanged = current !== null && JSON.stringify(JSON.parse(current || '{}')) === JSON.stringify(merged);
  return planned(before, unchanged ? before : `${JSON.stringify(merged, null, 2)}\n`, current !== null);
}

export interface ItemPreview {
  path: string; status: Status; diff: DiffLine[]; beforeHash: string; exists: boolean;
  /** When the hook, like the connector config, stops working after an update (the portable build). */
  caveat?: string;
}
export type Preview =
  | { ok: true; dir: string; skill: ItemPreview; hook: ItemPreview | { unavailable: string } }
  | { ok: false; reason: string };

function readCurrent(dir: string, rel: string, label: string): { text: string | null } | { error: string } {
  if (!fs.existsSync(path.join(dir, rel))) return { text: null };
  try {
    return { text: readTextWithin(dir, rel, label) };
  } catch {
    return { error: `Claude Code's ${label} could not be read (it may be a link, which is not followed), so it was left alone.` };
  }
}

const NO_DIR = "Claude Code's settings folder (~/.claude) was not found on this computer. Install Claude Code and run it once, then try again.";
const NO_CONNECTOR = 'The connector is not built in this checkout, so there is no hook to add yet (npm run build:connector).';

function previewItem(dir: string, rel: string, label: string, plan: (text: string | null) => Plan): ItemPreview | { error: string } {
  const current = readCurrent(dir, rel, label);
  if ('error' in current) return current;
  const p = plan(current.text);
  if (!p.ok) return { error: p.reason };
  return { path: path.join(dir, rel), status: p.status, diff: p.diff, beforeHash: hashOf(current.text), exists: current.text !== null };
}

export function previewClaudeCode(where: ClaudeCodeWhere, connector: ConnectorCommand | null): Preview {
  const dir = claudeCodeDir(where);
  if (!dir) return { ok: false, reason: NO_DIR };
  const skill = previewItem(dir, SKILL_FILE, 'skill file', planSkill);
  if ('error' in skill) return { ok: false, reason: skill.error };
  let hook: ItemPreview | { unavailable: string };
  if (!connector) hook = { unavailable: NO_CONNECTOR };
  else {
    const h = previewItem(dir, SETTINGS_FILE, 'settings.json', (t) => planHook(t, hookCommand(connector)));
    hook = 'error' in h ? { unavailable: h.error } : { ...h, ...(connector.caveat ? { caveat: connector.caveat } : {}) };
  }
  return { ok: true, dir, skill, hook };
}

/** What the person chose, each with the hash of the file they were shown. */
export interface Choice { skill?: string; hook?: string }

export interface Written { path: string; backupPath: string | null; status: Status }
export type Applied =
  | { ok: true; skill?: Written; hook?: Written }
  | { ok: false; reason: string; changed?: boolean };

const stampOf = (now: Date) => now.toISOString().replace(/[:.]/g, '-');

/** Write what was chosen: all of it, or none of it if any chosen file changed after it was shown. */
export function applyClaudeCode(where: ClaudeCodeWhere, connector: ConnectorCommand | null, choice: Choice, now = new Date()): Applied {
  const dir = claudeCodeDir(where);
  if (!dir) return { ok: false, reason: NO_DIR };
  if (!choice.skill && !choice.hook) return { ok: false, reason: 'Choose the skill, the hook, or both.' };
  if (choice.hook && !connector) return { ok: false, reason: NO_CONNECTOR };

  const items: Array<{ key: 'skill' | 'hook'; rel: string; label: string; shown: string; plan: (t: string | null) => Plan }> = [];
  if (choice.skill) items.push({ key: 'skill', rel: SKILL_FILE, label: 'skill file', shown: choice.skill, plan: planSkill });
  if (choice.hook) items.push({ key: 'hook', rel: SETTINGS_FILE, label: 'settings.json', shown: choice.hook, plan: (t) => planHook(t, hookCommand(connector!)) });

  // Check everything before writing anything.
  const ready: Array<{ key: 'skill' | 'hook'; rel: string; label: string; current: string | null; plan: Extract<Plan, { ok: true }> }> = [];
  for (const it of items) {
    const current = readCurrent(dir, it.rel, it.label);
    if ('error' in current) return { ok: false, reason: current.error };
    if (hashOf(current.text) !== it.shown) {
      return { ok: false, changed: true, reason: `Claude Code's ${it.label} changed after you looked at it. Here is the change again, against the file as it is now.` };
    }
    const plan = it.plan(current.text);
    if (!plan.ok) return plan;
    ready.push({ key: it.key, rel: it.rel, label: it.label, current: current.text, plan });
  }

  const out: { skill?: Written; hook?: Written } = {};
  try {
    for (const r of ready) {
      const target = path.join(dir, r.rel);
      if (r.plan.status === 'unchanged') { out[r.key] = { path: target, backupPath: null, status: 'unchanged' }; continue; }
      let backupPath: string | null = null;
      if (r.current !== null) {
        const ext = path.extname(r.rel);
        const backupRel = `${r.rel.slice(0, -ext.length)}.before-codetrellis-${stampOf(now)}${ext}`;
        backupPath = writeFileWithin(dir, backupRel, r.current, `Claude Code ${r.label} backup`);
      }
      writeFileWithin(dir, r.rel, r.plan.after, `Claude Code ${r.label}`);
      out[r.key] = { path: target, backupPath, status: r.plan.status };
    }
  } catch {
    return { ok: false, reason: "Claude Code's files could not be written (a link at their place is not written through). Anything already written is listed by a fresh preview." };
  }
  return { ok: true, ...out };
}

/** This machine, for the Electron main process. */
export function thisMachine(): ClaudeCodeWhere {
  return { home: os.homedir(), env: process.env, exists: (p) => fs.existsSync(p) };
}
