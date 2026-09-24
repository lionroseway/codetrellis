/**
 * Phase 31 §6.1 — "Add to Claude Desktop": the connector's entry, merged
 * into Claude Desktop's own config file.
 *
 * This writes another application's file, so it is only ever the person's
 * action, and never a surprise:
 *
 *  - It is reachable only from the app's own window (Electron IPC), never
 *    over HTTP or MCP — an agent must not be able to rewrite another app's
 *    config, even one holding this launch's token.
 *  - The entry is the connector command this app resolved itself
 *    (getMcpSetup); nothing in it comes from the renderer.
 *  - `preview` shows the whole change as a diff. `apply` takes the hash of
 *    the file the person saw, and does nothing if the file has changed
 *    since — they are shown the new diff instead.
 *  - The old file is kept beside it, timestamped, before anything is
 *    written; the write is atomic and refuses a symlink at either end
 *    (confined-fs, rooted at Claude's own config folder).
 *  - A file that is not valid JSON, or whose `mcpServers` is not an
 *    object, is left alone with a sentence saying why.
 *  - Claude Desktop's folder must already exist: this does not install
 *    settings for an app that has never run.
 *
 * Where the file lives is decided here, per platform, and nowhere else.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readTextWithin, writeFileWithin } from './confined-fs';

export const CONFIG_NAME = 'claude_desktop_config.json';

export interface Where {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  exists: (p: string) => boolean;
  /** Directory listing, for the Microsoft Store install's package folder. */
  list: (dir: string) => string[];
}

/**
 * Claude Desktop's config folder on this machine, or null when it has none.
 *
 *  - macOS: ~/Library/Application Support/Claude
 *  - Windows: %APPDATA%\Claude — or, for the Microsoft Store (MSIX) build,
 *    the same folder virtualised under
 *    %LOCALAPPDATA%\Packages\Claude_<publisher>\LocalCache\Roaming\Claude
 *  - Linux (community builds; there is no official one): $XDG_CONFIG_HOME/Claude,
 *    else ~/.config/Claude
 */
export function claudeDesktopConfigDir(w: Where): string | null {
  const candidates: string[] = [];
  if (w.platform === 'darwin') {
    candidates.push(path.join(w.home, 'Library', 'Application Support', 'Claude'));
  } else if (w.platform === 'win32') {
    const appData = w.env.APPDATA ?? path.join(w.home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Claude'));
    const local = w.env.LOCALAPPDATA ?? path.join(w.home, 'AppData', 'Local');
    const packages = path.join(local, 'Packages');
    if (w.exists(packages)) {
      for (const name of w.list(packages).filter((n) => /^Claude_/i.test(n)).sort()) {
        candidates.push(path.join(packages, name, 'LocalCache', 'Roaming', 'Claude'));
      }
    }
  } else {
    candidates.push(path.join(w.env.XDG_CONFIG_HOME || path.join(w.home, '.config'), 'Claude'));
  }
  return candidates.find((d) => w.exists(d)) ?? null;
}

export type DiffLine = { op: ' ' | '+' | '-'; text: string };

/** A line diff (longest common subsequence) — the files are small. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: ' ', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: '-', text: a[i++] });
    else out.push({ op: '+', text: b[j++] });
  }
  while (i < n) out.push({ op: '-', text: a[i++] });
  while (j < m) out.push({ op: '+', text: b[j++] });
  return out;
}

export type MergePlan =
  | { ok: true; status: 'add' | 'update' | 'unchanged'; before: string; after: string; diff: DiffLine[] }
  | { ok: false; reason: string };

/** The file with the `codetrellis` entry set, changing nothing else in it. */
export function planMerge(current: string | null, entry: Record<string, unknown>): MergePlan {
  let doc: Record<string, unknown> = {};
  if (current !== null && current.trim() !== '') {
    let parsed: unknown;
    try { parsed = JSON.parse(current); } catch {
      return { ok: false, reason: "Claude Desktop's config file is not valid JSON, so it was left alone. Fix or remove it, then try again." };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: "Claude Desktop's config file is not a JSON object, so it was left alone." };
    }
    doc = parsed as Record<string, unknown>;
  }
  const servers = doc.mcpServers ?? {};
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return { ok: false, reason: "Claude Desktop's config has an \"mcpServers\" that is not an object, so it was left alone." };
  }
  const existing = (servers as Record<string, unknown>).codetrellis;
  const status = existing === undefined ? 'add' : JSON.stringify(existing) === JSON.stringify(entry) ? 'unchanged' : 'update';
  const merged = { ...doc, mcpServers: { ...(servers as Record<string, unknown>), codetrellis: entry } };
  const before = current ?? '';
  const after = status === 'unchanged' ? before : `${JSON.stringify(merged, null, 2)}\n`;
  return { ok: true, status, before, after, diff: status === 'unchanged' ? [] : lineDiff(before, after) };
}

export const hashOf = (text: string | null) => createHash('sha256').update(text ?? '\0absent').digest('hex');

export type Preview =
  | { ok: true; path: string; status: 'add' | 'update' | 'unchanged'; diff: DiffLine[]; beforeHash: string; exists: boolean }
  | { ok: false; reason: string };

function readCurrent(dir: string): { text: string | null } | { error: string } {
  if (!fs.existsSync(path.join(dir, CONFIG_NAME))) return { text: null };
  try {
    return { text: readTextWithin(dir, CONFIG_NAME, 'Claude Desktop config') };
  } catch {
    return { error: "Claude Desktop's config file could not be read (it may be a link, which is not followed), so it was left alone." };
  }
}

export function previewClaudeDesktop(where: Where, entry: Record<string, unknown> | null): Preview {
  if (!entry) return { ok: false, reason: 'The connector is not built in this checkout, so there is nothing to add yet (npm run build:connector).' };
  const dir = claudeDesktopConfigDir(where);
  if (!dir) return { ok: false, reason: "Claude Desktop's settings folder was not found on this computer. Install Claude Desktop and open it once, then try again." };
  const current = readCurrent(dir);
  if ('error' in current) return { ok: false, reason: current.error };
  const plan = planMerge(current.text, entry);
  if (!plan.ok) return plan;
  return { ok: true, path: path.join(dir, CONFIG_NAME), status: plan.status, diff: plan.diff, beforeHash: hashOf(current.text), exists: current.text !== null };
}

export type Applied =
  | { ok: true; path: string; backupPath: string | null; status: 'add' | 'update' | 'unchanged' }
  | { ok: false; reason: string; changed?: boolean };

/** Write the merge — only if the file is still exactly what the person was shown. */
export function applyClaudeDesktop(where: Where, entry: Record<string, unknown> | null, shownHash: string, now = new Date()): Applied {
  if (!entry) return { ok: false, reason: 'The connector is not built in this checkout.' };
  const dir = claudeDesktopConfigDir(where);
  if (!dir) return { ok: false, reason: "Claude Desktop's settings folder was not found on this computer." };
  const current = readCurrent(dir);
  if ('error' in current) return { ok: false, reason: current.error };
  if (hashOf(current.text) !== shownHash) {
    return { ok: false, changed: true, reason: "Claude Desktop's config changed after you looked at it. Here is the change again, against the file as it is now." };
  }
  const plan = planMerge(current.text, entry);
  if (!plan.ok) return plan;
  const target = path.join(dir, CONFIG_NAME);
  if (plan.status === 'unchanged') return { ok: true, path: target, backupPath: null, status: 'unchanged' };
  try {
    let backupPath: string | null = null;
    if (current.text !== null) {
      const stamp = now.toISOString().replace(/[:.]/g, '-');
      backupPath = writeFileWithin(dir, `claude_desktop_config.before-codetrellis-${stamp}.json`, current.text, 'Claude Desktop config backup');
    }
    writeFileWithin(dir, CONFIG_NAME, plan.after, 'Claude Desktop config');
    return { ok: true, path: target, backupPath, status: plan.status };
  } catch {
    return { ok: false, reason: "Claude Desktop's config could not be written (a link at its place is not written through). Nothing was changed." };
  }
}

/** This machine, for the Electron main process. */
export function thisMachine(): Where {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    exists: (p) => fs.existsSync(p),
    list: (d) => { try { return fs.readdirSync(d); } catch { return []; } },
  };
}
