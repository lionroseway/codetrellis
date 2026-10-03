/**
 * Watching a whole tree — a checkout, a line of work, a plans folder — with
 * chokidar's events (`add`, `change`, `unlink`, `addDir`, `unlinkDir`, `all`,
 * `ready`, `error`) on every platform, and macOS's own recursive watch there.
 *
 * chokidar 5 has no FSEvents. On macOS it holds a file descriptor per watched
 * file, and it loses events in a burst: when new folders appear in several
 * sibling folders at once, it reports the first two and nothing at all for
 * the rest. Both reached users:
 *  - a pull that brought channel events to eight plans imported two plans'
 *    worth (bug 26 again: the catch-up sweep is triggered by the folder event
 *    that never came);
 *  - a line of work over a React Native checkout held 20,000 descriptors until
 *    git could not start (0.1.18).
 * Node's `fs.watch(root, { recursive: true })` on macOS is FSEvents: one
 * handle for the tree, and it reported every folder and file of the same
 * burst. It says only "something happened at this path", so this keeps what
 * it has seen and turns each report into chokidar's event by looking.
 *
 * Elsewhere this is chokidar, unchanged: Linux and Windows have shown neither
 * fault, and their native recursive watchers are not the same machine.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';

export interface TreeWatchOptions {
  /** True for a path (absolute) not to watch or report. Its subtree is skipped. */
  ignored?: (p: string) => boolean;
  /** Levels of folders below the root to descend, as chokidar's `depth`. */
  depth?: number;
  /** Report a file once its size and time have held still this long. */
  awaitWriteFinish?: { stabilityThreshold: number; pollInterval?: number };
  /** Links are never followed by the native watcher; chokidar is told the same. */
  followSymlinks?: false;
  ignoreInitial?: true;
  persistent?: true;
}

export type TreeEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface TreeWatcher {
  on(event: 'all', cb: (event: TreeEvent, p: string) => void): this;
  on(event: TreeEvent, cb: (p: string) => void): this;
  on(event: 'ready', cb: () => void): this;
  on(event: 'error', cb: (err: unknown) => void): this;
  once(event: 'ready', cb: () => void): this;
  close(): Promise<void>;
  /** Folder → the names under it being watched (chokidar's shape). */
  getWatched(): Record<string, string[]>;
}

/** The native watcher, or chokidar: `CODETRELLIS_TREE_WATCHER=chokidar` forces the latter (tests compare). */
export function usesNativeTreeWatcher(platform: NodeJS.Platform = process.platform): boolean {
  if (process.env.CODETRELLIS_TREE_WATCHER === 'chokidar') return false;
  return platform === 'darwin';
}

export function watchTree(root: string, opts: TreeWatchOptions = {}): TreeWatcher {
  if (!usesNativeTreeWatcher()) {
    return chokidar.watch(root, { ignoreInitial: true, persistent: true, ...opts }) as unknown as TreeWatcher;
  }
  return new NativeTreeWatcher(root, opts);
}

/** What was last seen at a path: a folder, or a file with what tells a change. */
type Seen = { dir: true } | { dir: false; size: number; mtimeMs: number };

/** A burst's reports for one path are taken together after this. */
const COALESCE_MS = 50;

class NativeTreeWatcher extends EventEmitter implements TreeWatcher {
  private readonly seen = new Map<string, Seen>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private fsw: fs.FSWatcher | null = null;
  private closed = false;

  constructor(private readonly root: string, private readonly opts: TreeWatchOptions) {
    super();
    // Listening before the walk, so nothing written during it is lost; a
    // report for a path the walk has not reached yet is just a new path.
    try {
      this.fsw = fs.watch(root, { recursive: true, persistent: true }, (_type, name) => {
        if (this.closed) return;
        // No name: FSEvents dropped detail (a flood). Look at everything.
        if (!name) { void this.rescan(); return; }
        this.report(path.join(root, name.toString()));
      });
      this.fsw.on('error', (err) => this.emit('error', err));
    } catch (err) {
      setImmediate(() => this.emit('error', err));
    }
    void this.walk(root, true).then(() => { if (!this.closed) this.emit('ready'); });
  }

  private skip(p: string): boolean {
    if (p !== this.root && this.opts.ignored?.(p)) return true;
    if (this.opts.depth === undefined) return false;
    const rel = path.relative(this.root, p);
    if (!rel || rel.startsWith('..')) return !!rel;
    return rel.split(path.sep).length - 1 > this.opts.depth;
  }

  /** Record what is under `dir`; `quiet` for the first walk (ignoreInitial), else report what is new. */
  private async walk(dir: string, quiet: boolean): Promise<void> {
    if (this.closed) return;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (this.skip(p)) continue;
      if (e.isDirectory()) {
        const isNew = !this.seen.has(p);
        this.seen.set(p, { dir: true });
        if (isNew && !quiet) this.fire('addDir', p);
        await this.walk(p, quiet);
      } else {
        // A link is a file here, never followed.
        if (this.seen.has(p)) continue;
        const st = this.stat(p);
        if (!st) continue;
        this.seen.set(p, { dir: false, size: st.size, mtimeMs: st.mtimeMs });
        if (!quiet) this.fire('add', p);
      }
    }
  }

  private stat(p: string): fs.Stats | null {
    try { return fs.lstatSync(p); } catch { return null; }
  }

  private report(p: string): void {
    if (p === this.root || this.skip(p)) return;
    const wait = this.opts.awaitWriteFinish?.stabilityThreshold ?? COALESCE_MS;
    const prev = this.timers.get(p);
    if (prev) clearTimeout(prev);
    this.timers.set(p, setTimeout(() => { this.timers.delete(p); void this.settle(p); }, wait));
  }

  /** Look at `p` and say what changed there. */
  private async settle(p: string): Promise<void> {
    if (this.closed) return;
    const st = this.stat(p);
    const was = this.seen.get(p);
    if (!st) {
      if (!was) return;
      if (was.dir) this.forgetDir(p);
      else { this.seen.delete(p); this.fire('unlink', p); }
      return;
    }
    if (st.isDirectory()) {
      if (was && !was.dir) { this.seen.delete(p); this.fire('unlink', p); }
      if (!was || !was.dir) { this.seen.set(p, { dir: true }); this.fire('addDir', p); }
      // Whatever arrived with it: FSEvents may name the folder and not each
      // file a pull wrote into it in the same instant.
      await this.walk(p, false);
      return;
    }
    if (was?.dir) this.forgetDir(p);
    const now = { dir: false as const, size: st.size, mtimeMs: st.mtimeMs };
    this.seen.set(p, now);
    if (!was || was.dir) this.fire('add', p);
    else if (was.size !== now.size || was.mtimeMs !== now.mtimeMs) this.fire('change', p);
  }

  private forgetDir(dir: string): void {
    const prefix = dir + path.sep;
    for (const [p, s] of [...this.seen]) {
      if (!p.startsWith(prefix)) continue;
      this.seen.delete(p);
      this.fire(s.dir ? 'unlinkDir' : 'unlink', p);
    }
    this.seen.delete(dir);
    this.fire('unlinkDir', dir);
  }

  /** A flood dropped the names: compare everything recorded with what is there. */
  private async rescan(): Promise<void> {
    for (const p of [...this.seen.keys()]) {
      if (!fs.existsSync(p)) await this.settle(p);
    }
    await this.walk(this.root, false);
  }

  private fire(event: TreeEvent, p: string): void {
    if (this.closed) return;
    this.emit(event, p);
    this.emit('all', event, p);
  }

  getWatched(): Record<string, string[]> {
    const out: Record<string, string[]> = { [this.root]: [] };
    for (const [p, s] of this.seen) {
      if (s.dir) out[p] ??= [];
      const parent = path.dirname(p);
      (out[parent] ??= []).push(path.basename(p));
    }
    for (const k of Object.keys(out)) out[k].sort();
    return out;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.fsw?.close();
    this.fsw = null;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.removeAllListeners();
  }
}
