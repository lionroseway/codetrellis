/**
 * Folders a sync client keeps, and files it has not brought down yet
 * (Phase 32 C3.4b; the owner's choice: OneDrive and SharePoint first).
 *
 * **Where the clients put them.** OneDrive and SharePoint document libraries
 * are synced by one client, which mounts them:
 *
 *  - macOS (File Provider): `~/Library/CloudStorage/OneDrive-Personal`,
 *    `OneDrive-<Org>` and `OneDrive-SharedLibraries-<Org>` (SharePoint);
 *    older clients used `~/OneDrive` and `~/OneDrive - <Org>`.
 *  - Windows: `%OneDrive%`, `%OneDriveCommercial%`, `%OneDriveConsumer%`, and
 *    every mount point the client registers under
 *    `HKCU\Software\SyncEngines\Providers\OneDrive`, SharePoint libraries
 *    included.
 *  - Linux has no first-party client; `~/OneDrive` is offered when it exists.
 *
 * **Placeholders.** A file still only in the cloud looks like a file but
 * opening it downloads it. It is never opened here: on POSIX it is a
 * non-empty file with no blocks on disk (macOS's dataless files); on
 * Windows it carries the offline attribute, which `attrib` shows as `O`.
 * Only `stat` (and on Windows `attrib`) is used to tell, neither of which
 * reads the file's content.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type CloudProvider = 'onedrive' | 'sharepoint';

/** A file still only in the cloud: never opened, so reading never downloads it. */
export class NotOnDeviceError extends Error {
  constructor(what: string) {
    super(`${what} is not on this device: it is still only in the cloud`);
  }
}

export interface CloudRoot {
  provider: CloudProvider;
  /** The folder the client syncs into. */
  path: string;
  /** Which account or organisation, as the folder's name says ("Acme", "Personal"). */
  account: string | null;
}

const isDir = (p: string): boolean => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};

/** macOS's File Provider folders, and the older client's home folders. */
export function macRoots(home: string, list: (dir: string) => string[] = safeList): CloudRoot[] {
  const out: CloudRoot[] = [];
  const cloud = path.join(home, 'Library', 'CloudStorage');
  for (const name of list(cloud)) {
    const shared = /^OneDrive-SharedLibraries-(.+)$/.exec(name);
    if (shared) { out.push({ provider: 'sharepoint', path: path.join(cloud, name), account: shared[1] }); continue; }
    const one = /^OneDrive-(.+)$/.exec(name);
    if (one) out.push({ provider: 'onedrive', path: path.join(cloud, name), account: one[1] });
  }
  for (const name of list(home)) {
    const legacy = /^OneDrive(?: - (.+))?$/.exec(name);
    if (legacy) out.push({ provider: 'onedrive', path: path.join(home, name), account: legacy[1] ?? null });
  }
  return out;
}

/** Windows' environment and the client's registered mount points (`reg query` output). */
export function windowsRoots(env: NodeJS.ProcessEnv, regOutput: string): CloudRoot[] {
  const out: CloudRoot[] = [];
  const accountOf = (p: string) => /OneDrive - (.+)$/.exec(path.win32.basename(p))?.[1] ?? null;
  for (const key of ['OneDriveCommercial', 'OneDriveConsumer', 'OneDrive']) {
    const p = env[key];
    if (p) out.push({ provider: 'onedrive', path: p, account: key === 'OneDriveConsumer' ? 'Personal' : accountOf(p) });
  }
  // HKEY_CURRENT_USER\...\OneDrive\<id>  then  "    MountPoint    REG_SZ    C:\Users\sam\Acme\Sales - Documents"
  for (const m of regOutput.matchAll(/^\s*MountPoint\s+REG_\w+\s+(.+?)\s*$/gm)) {
    const p = m[1];
    const isOneDrive = /[\\/]OneDrive(?: - [^\\/]+)?$/i.test(p);
    out.push({ provider: isOneDrive ? 'onedrive' : 'sharepoint', path: p, account: isOneDrive ? accountOf(p) : path.win32.basename(path.win32.dirname(p)) || null });
  }
  return out;
}

function safeList(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
}

/**
 * The sync clients' folders on this machine, first by provider then path,
 * each once. `CODETRELLIS_CLOUD_ROOTS` (JSON) replaces them, for tests.
 */
export function cloudRoots(): CloudRoot[] {
  const forced = process.env.CODETRELLIS_CLOUD_ROOTS;
  let roots: CloudRoot[];
  if (forced !== undefined) {
    try { roots = (JSON.parse(forced) as CloudRoot[]).filter((r) => r && (r.provider === 'onedrive' || r.provider === 'sharepoint') && typeof r.path === 'string'); } catch { roots = []; }
  } else if (process.platform === 'darwin') {
    roots = macRoots(os.homedir());
  } else if (process.platform === 'win32') {
    let reg = '';
    try {
      reg = execFileSync('reg', ['query', 'HKCU\\Software\\SyncEngines\\Providers\\OneDrive', '/s', '/v', 'MountPoint'], {
        encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true,
      });
    } catch { /* no client */ }
    roots = windowsRoots(process.env, reg);
  } else {
    const p = path.join(os.homedir(), 'OneDrive');
    roots = isDir(p) ? [{ provider: 'onedrive', path: p, account: null }] : [];
  }
  const seen = new Set<string>();
  return roots
    .filter((r) => isDir(r.path))
    .filter((r) => { const k = path.resolve(r.path).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.provider === b.provider ? a.path.localeCompare(b.path) : a.provider === 'onedrive' ? -1 : 1));
}

/** Where a place sits under the provider's roots on this machine, if it is there. */
export function findPlace(provider: CloudProvider, place: string, roots: CloudRoot[] = cloudRoots()): string | null {
  const parts = place.split('/').filter(Boolean);
  for (const r of roots) {
    if (r.provider !== provider) continue;
    const candidate = path.join(r.path, ...parts);
    if (isDir(candidate)) return candidate;
  }
  return null;
}

// ── Placeholders ─────────────────────────────────────────────────────────

/** POSIX: a non-empty file that has no blocks on disk is only in the cloud. */
export function isPosixPlaceholder(st: Pick<fs.Stats, 'size' | 'blocks' | 'isFile'>): boolean {
  return st.isFile() && st.size > 0 && st.blocks === 0;
}

/** Windows: `attrib`'s attribute column for one file, offline (`O`) meaning not on this device. */
export function attribSaysOffline(attribLine: string): boolean {
  // "A    O    U       C:\\Users\\sam\\…": everything before the path is attributes.
  const m = /^(.*?)\s+(?:[A-Za-z]:\\|\\\\)/.exec(attribLine);
  return /\bO\b/.test(m?.[1] ?? '');
}

let rootsCache: { at: number; roots: CloudRoot[] } | null = null;
/** The roots, looked up at most every 30 s: placeholders are checked file by file. */
function cachedRoots(): CloudRoot[] {
  if (!rootsCache || Date.now() - rootsCache.at > 30_000) rootsCache = { at: Date.now(), roots: cloudRoots() };
  return rootsCache.roots;
}

/** For tests that change the roots. */
export function forgetCloudRoots(): void {
  rootsCache = null;
}

/** Whether `file` sits under one of the sync clients' folders. */
export function underCloudRoot(file: string, roots: CloudRoot[] = cachedRoots()): boolean {
  const f = path.resolve(file);
  return roots.some((r) => {
    const rel = path.relative(path.resolve(r.path), f);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

/**
 * True when `file` is a placeholder for a file still in the cloud. Never
 * opens the file. A file that cannot be inspected is not called one.
 *
 * On POSIX a file with no blocks is a placeholder only under a sync
 * client's folder: elsewhere it is an ordinary sparse file (a disk image, a
 * test's large file), which must still be read.
 */
export function isPlaceholder(file: string): boolean {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return false; }
  if (process.platform !== 'win32') return isPosixPlaceholder(st) && underCloudRoot(file);
  if (!st.isFile()) return false;
  try {
    const out = execFileSync('attrib', [file], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true });
    return attribSaysOffline(out.split(/\r?\n/)[0] ?? '');
  } catch { return false; }
}
