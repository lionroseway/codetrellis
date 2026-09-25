/**
 * Phase 31 §7.6 — the conversion engine, mounted only when needed.
 *
 * Nothing runs at launch. The first conversion starts the engine's own
 * process; it serves conversions one at a time, is killed when one runs past
 * its time, and is stopped after a few idle minutes (it holds over a
 * gigabyte while warm). A conversion that cannot happen — no engine, an
 * engine that does not match its hashes, a runtime that cannot confine it —
 * rejects with `EngineUnavailable`, and the viewer falls back.
 *
 * The process runs on this binary in Node mode under the permission model:
 * it may read only the engine and its own script, may not write, start
 * processes or load addons, and — where the runtime can deny it (Node 25+)
 * — may not reach the network. Where the runtime cannot, the engine runs
 * only if it was proven network-free when it was built (network-proof.ts),
 * as its pin records. It is given bytes, never a path, and an environment
 * with nothing of ours in it.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { verifyEngine, type EngineCheck, type EnginePin } from './engine-manifest';
import { canonicalRoot } from '../confined-fs';

export class EngineUnavailable extends Error {}
export class ConversionFailed extends Error {}
/** The engine hung and was killed; a fresh one may well succeed. */
export class ConversionTimedOut extends ConversionFailed {}

export interface EngineHostOptions {
  engineDir: string;
  /** The built child entry (`engine-child.cjs`). */
  childScript: string;
  /**
   * The hashes the engine must match, pinned in this build. Without them the
   * engine's own manifest is trusted — acceptable only for a source run.
   */
  pinned?: EnginePin | null;
  idleMs?: number;
  timeoutMs?: number;
  startTimeoutMs?: number;
  maxOutputBytes?: number;
  /**
   * How long the warm-up conversion may take before the engine is judged
   * stuck and replaced (WARM_UP). 0 skips the warm-up.
   */
  warmUpMs?: number;
  /** Extra directories the child may read (tests). */
  allowRead?: string[];
  /**
   * The rule in §7.6: an engine the runtime cannot keep off the network runs
   * only if it is proven network-free. Only tests turn this off.
   */
  requireNetworkDenial?: boolean;
}

/** What this runtime can take away from a child process. */
export function runtimeIsolation(): { fs: boolean; net: boolean } {
  const flags = process.allowedNodeEnvironmentFlags;
  return { fs: flags.has('--permission'), net: flags.has('--allow-net') };
}

interface Pending {
  resolve: (pdf: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * The warm-up document: two lines of RTF. The first conversion after the
 * engine started used to hang, whatever the document: LibreOffice's own
 * main() was starting on a worker and racing the adapter's start-up, and
 * the adapter now stops it running (`noInitialRun`). The warm-up stays as
 * the check that a new engine converts at all before it takes real work —
 * about half a second — and an engine that hangs on it is still replaced,
 * once, so a start-up problem we have not met yet costs 20s, not a person's
 * first document.
 */
const WARM_UP = new TextEncoder().encode('{\\rtf1\\ansi CodeTrellis warm-up.\\par}');

export class EngineHost {
  private child: ChildProcess | null = null;
  private starting: Promise<ChildProcess> | null = null;
  private version: string | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;
  private stderrTail = '';

  constructor(private readonly opts: EngineHostOptions) {}

  get running(): boolean { return this.child !== null; }
  /** The running engine's version, once it has started. */
  get engineVersion(): string | null { return this.version; }

  /** The engine's check, without starting it — its version keys the cache. */
  async check(): Promise<EngineCheck> {
    return verifyEngine(this.opts.engineDir, this.opts.pinned ?? undefined);
  }

  convert(bytes: Uint8Array, ext: string): Promise<Uint8Array> {
    const run = this.queue.then(() => this.convertNow(bytes, ext));
    this.queue = run.catch(() => undefined);
    return run;
  }

  stop(): void {
    this.clearIdle();
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) child.kill('SIGKILL');
  }

  private async convertNow(bytes: Uint8Array, ext: string): Promise<Uint8Array> {
    this.clearIdle();
    const child = await this.start();
    const id = ++this.seq;
    const timeoutMs = this.opts.timeoutMs ?? 30_000;
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          console.warn(`[rendition] a .${ext} conversion ran past ${timeoutMs}ms; stopping the engine`);
          this.pending.delete(id);
          reject(new ConversionTimedOut(`The conversion took longer than ${Math.round(timeoutMs / 1000)}s, so it was stopped`));
          this.stop();
        }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        child.send({ type: 'convert', id, bytes, ext });
      });
    } finally {
      this.armIdle();
    }
  }

  private start(): Promise<ChildProcess> {
    if (this.child) return Promise.resolve(this.child);
    if (!this.starting) this.starting = this.spawn().finally(() => { this.starting = null; });
    return this.starting;
  }

  /** Start an engine and warm it; one that hangs on the warm-up is replaced, once. */
  private async spawn(): Promise<ChildProcess> {
    for (let attempt = 1; ; attempt++) {
      const child = await this.spawnOnce();
      if (await this.warmUp(child)) {
        child.on('message', (msg) => this.onMessage(msg as { type: string; id: number; pdf?: Uint8Array; message?: string }));
        child.on('exit', () => this.onExit(child));
        this.child = child;
        return child;
      }
      if (child.exitCode === null) child.kill('SIGKILL');
      if (attempt >= 2) throw new EngineUnavailable('the conversion engine did not settle after starting');
      console.warn('[rendition] the engine hung on its warm-up; starting a fresh one');
    }
  }

  /** True when the engine answered the warm-up — with a PDF or an error — in time. */
  private warmUp(child: ChildProcess): Promise<boolean> {
    const ms = this.opts.warmUpMs ?? 20_000;
    if (ms <= 0) return Promise.resolve(true);
    const startedAt = Date.now();
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('exit', onExit);
        if (ok) console.log(`[rendition] engine warmed in ${Date.now() - startedAt}ms`);
        resolve(ok);
      };
      const onMessage = (msg: { id?: number }) => { if (msg?.id === 0) done(true); };
      const onExit = () => done(false);
      const timer = setTimeout(() => done(false), ms);
      child.on('message', onMessage);
      child.once('exit', onExit);
      child.send({ type: 'convert', id: 0, bytes: WARM_UP, ext: 'rtf' });
    });
  }

  private async spawnOnce(): Promise<ChildProcess> {
    const isolation = runtimeIsolation();
    if (!isolation.fs) throw new EngineUnavailable('this runtime cannot confine the conversion engine');
    const checked = await this.check();
    if (!checked.ok) throw new EngineUnavailable(checked.reason);
    // §7.6: the network is denied by the runtime where it can (Node 25+).
    // Where it cannot — Electron 44's Node 24 — the engine runs only if it
    // was proven network-free when it was built, and that proof is pinned.
    if (!isolation.net && checked.manifest.networkFree !== true && this.opts.requireNetworkDenial !== false) {
      throw new EngineUnavailable('this runtime cannot keep the conversion engine off the network, and this engine is not proven network-free');
    }

    const startedAt = Date.now();
    // Every path the child is started with, or granted, by its canonical name.
    // Node checks the loader's walk of the entry path against the grants
    // before following links, so a path through a symlink (macOS's /var →
    // /private/var) dies reading "/var" however it is granted. The same
    // files, named once — not a wider grant.
    let engineDir: string;
    let childScript: string;
    let read: string[];
    try {
      engineDir = canonicalRoot(this.opts.engineDir);
      childScript = canonicalRoot(this.opts.childScript);
      read = [engineDir, childScript, ...(this.opts.allowRead ?? []).map((p) => canonicalRoot(p))];
    } catch (err) {
      console.warn(`[rendition] engine did not start: ${(err as Error).message}`);
      throw new EngineUnavailable('the conversion engine could not start');
    }
    const child = fork(childScript, [engineDir], {
      execPath: process.execPath,
      // Its own directory — never the directory the app was started from.
      cwd: engineDir,
      // Omitting --allow-net, --allow-child-process, --allow-addons and every
      // --allow-fs-write is the point.
      execArgv: ['--permission', ...read.map((p) => `--allow-fs-read=${p}`), '--allow-worker'],
      // Nothing of ours — no capability token, no data dir, no paths.
      env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    this.stderrTail = '';
    child.stderr?.on('data', (d: Buffer) => { this.stderrTail = (this.stderrTail + d.toString()).slice(-2000); });

    await new Promise<void>((resolve, reject) => {
      const fail = (why: string) => {
        clearTimeout(timer);
        if (child.exitCode === null) child.kill('SIGKILL');
        console.warn(`[rendition] engine did not start: ${why}\n${this.stderrTail}`);
        reject(new EngineUnavailable('the conversion engine could not start'));
      };
      const timer = setTimeout(() => fail('timed out'), this.opts.startTimeoutMs ?? 60_000);
      child.once('error', (err) => fail(err.message));
      child.once('exit', (code) => fail(`exited with ${code}`));
      child.on('message', function ready(msg: { type?: string; version?: string }) {
        if (msg?.type !== 'ready') return;
        child.off('message', ready);
        clearTimeout(timer);
        child.removeAllListeners('exit');
        child.removeAllListeners('error');
        resolve();
      });
    });

    this.version = checked.manifest.version;
    console.log(`[rendition] engine ${checked.manifest.version} started in ${Date.now() - startedAt}ms`);
    return child;
  }

  private onMessage(msg: { type: string; id: number; pdf?: Uint8Array; message?: string }): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.type === 'result' && msg.pdf) {
      const pdf = new Uint8Array(msg.pdf.buffer, msg.pdf.byteOffset, msg.pdf.byteLength);
      if (pdf.byteLength > (this.opts.maxOutputBytes ?? 200 * 1024 * 1024)) {
        p.reject(new ConversionFailed('The converted document is larger than the viewer will show'));
      } else if (!startsWithPdf(pdf)) {
        p.reject(new ConversionFailed('The engine did not produce a PDF'));
      } else {
        p.resolve(pdf);
      }
    } else {
      console.warn(`[rendition] conversion failed: ${msg.message ?? 'unknown'}`);
      p.reject(new ConversionFailed('The document could not be converted'));
    }
  }

  private onExit(child: ChildProcess): void {
    if (this.child === child) this.child = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new ConversionFailed('The conversion engine stopped unexpectedly'));
      this.pending.delete(id);
    }
  }

  private armIdle(): void {
    this.clearIdle();
    if (!this.child || this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => this.stop(), this.opts.idleMs ?? 3 * 60_000);
    this.idleTimer.unref();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

function startsWithPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
}
