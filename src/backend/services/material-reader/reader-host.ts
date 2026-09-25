/**
 * Phase 31 §5.1 — reading a material for an agent.
 *
 * The attachment is resolved the way every read is (§7.1): by uid, under
 * the item's trusted project root, links refused, the whole file read
 * under a cap. The bytes — never the path — go to a process started for
 * this one read and thrown away after it:
 *
 *  - its heap ceiling is set on its own command line and its environment is
 *    empty, so nothing inherited can raise it. A worker thread's
 *    `resourceLimits` cannot promise that: a `--max-old-space-size` in
 *    NODE_OPTIONS overrides them, and a hostile workbook then grows inside
 *    the backend's own process (measured: 3 GB against a 64 MB limit);
 *  - packaged, it runs under the permission model with nothing granted but
 *    its own script — it can open no file, start no process, and has no
 *    network to reach — as the conversion engine's child does (§7.6);
 *  - a deadline kills it.
 *
 * Images need no parsing and come back as themselves. Video and old-format
 * workbooks are said plainly not to be readable as text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { readServableCapped, resolveServable, type ServableFile } from '../artefact-content-service';
import { existingRendition } from '../rendition/rendition-service';
import type { EngineHost } from '../rendition/engine-host';
import { isPackagedElectron } from '../../mcp/connector/command';
import { TEXT_EXTS } from '../../../shared/lib/locator';
import type { MaterialLocator, ReadReply, ReadRequest } from './read';

/** The most of each kind of file that is read at all. */
const READ_CAPS: Record<string, number> = {
  pdf: 100 * 1024 * 1024,
  pptx: 100 * 1024 * 1024,
  xlsx: 25 * 1024 * 1024,
  xlsm: 25 * 1024 * 1024,
  docx: 25 * 1024 * 1024,
};
const TEXT_CAP = 20 * 1024 * 1024;
const IMAGE_CAP = 5 * 1024 * 1024;

const IMAGE_TYPES: Record<string, { mimeType: string; magic: (b: Buffer) => boolean }> = {
  png: { mimeType: 'image/png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mimeType: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mimeType: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { mimeType: 'image/gif', magic: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  webp: { mimeType: 'image/webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);

export const READ_TIMEOUT_MS = 30_000;
export const READER_HEAP_MB = 768;

export type MaterialRead =
  | { ok: true; kind: 'text'; name: string; itemUid: string; reply: Extract<ReadReply, { ok: true }> }
  | { ok: true; kind: 'image'; name: string; itemUid: string; mimeType: string; base64: string; bytes: number }
  | { ok: false; status: 404 | 413 | 415 | 422 | 504; reason: string; name?: string; itemUid?: string };

type RunReply = ReadReply | { ok: false; timedOut: true; reason: string };

/**
 * Where the reader's script is. Packaged: the bundle shipped beside the
 * asar (`vite.reader.config.ts`), because pdf.js is not in the packaged
 * node_modules. From source under tsx: the TypeScript itself. Built for
 * Electron in dev: the bundle `npm run build:reader` wrote.
 */
export function readerScript(): string {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  if (isPackagedElectron({ execPath: process.execPath, electronVersion: process.versions.electron }) && resourcesPath) {
    return path.join(resourcesPath, 'reader', 'material-reader.mjs');
  }
  const source = path.join(__dirname, 'child.ts');
  if (__filename.endsWith('.ts') && fs.existsSync(source)) return source;
  return path.join(process.cwd(), 'out', 'reader', 'material-reader.mjs');
}

/**
 * How the reader's process is started. The built bundle — what ships — runs
 * confined: it may read itself and nothing else. The TypeScript source (dev
 * and tests only) runs through tsx, which reads the checkout, probes the
 * temp directory and starts esbuild, so it gets the heap ceiling and the
 * empty environment but not the permission model; `reader-confinement`
 * proves the bundle's confinement in CI.
 */
export function readerLaunch(script: string, opts: { heapMb?: number } = {}): { execArgv: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  const heap = `--max-old-space-size=${opts.heapMb ?? READER_HEAP_MB}`;
  // Nothing of ours — no capability token, no data dir, no NODE_OPTIONS.
  const env: NodeJS.ProcessEnv = process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {};
  if (script.endsWith('.ts')) {
    return { execArgv: [heap, '--import', 'tsx'], cwd: path.resolve(__dirname, '..', '..', '..', '..'), env };
  }
  return { execArgv: [heap, '--permission', `--allow-fs-read=${script}`], cwd: path.dirname(script), env };
}

/** Run one read in a fresh process; it is killed on reply, error or deadline. */
export function runReader(
  req: ReadRequest,
  opts: { script?: string; timeoutMs?: number; heapMb?: number } = {},
): Promise<RunReply> {
  return new Promise((resolve) => {
    const script = opts.script ?? readerScript();
    const launch = readerLaunch(script, opts);
    let settled = false;
    let stderr = '';
    let child: ReturnType<typeof fork>;
    try {
      child = fork(script, [], {
        execPath: process.execPath,
        execArgv: launch.execArgv,
        cwd: launch.cwd,
        env: launch.env,
        // pdf.js warns on every load that it cannot draw, which a reader never
        // asks it to: stdout is dropped, and stderr kept only to tell a heap
        // limit from any other death.
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        serialization: 'advanced',
      });
    } catch (err) {
      resolve({ ok: false, reason: `The reader could not start (${(err as Error).message})` });
      return;
    }
    child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });
    const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
    const done = (r: RunReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve(r);
    };
    const timer = setTimeout(() => done({
      ok: false,
      timedOut: true,
      reason: `Reading ${req.name} took longer than ${Math.round(timeoutMs / 1000)}s and was stopped. Ask for a smaller part of it.`,
    }), timeoutMs);
    child.once('message', (reply: ReadReply) => done(reply));
    child.once('error', (err) => done({ ok: false, reason: `${req.name} could not be read (${err.message})` }));
    child.once('exit', (code, signal) => {
      // 'exit' can arrive before the reply the child sent just before it: a
      // message still on the IPC channel is delivered before 'disconnect', so
      // only a child that has gone AND whose channel is empty has failed. The
      // wait is capped, and stderr (the heap-limit message) drains meanwhile.
      const judge = () => setImmediate(() => {
        if (settled) return;
        const outOfMemory = /heap limit|out of memory/i.test(stderr);
        if (!outOfMemory) {
          console.warn(`[reader] stopped without answering (code ${code}, signal ${signal}): ${stderr.trim().split('\n').slice(-5).join(' | ') || 'no output'}`);
        }
        done({
          ok: false,
          reason: outOfMemory
            ? `${req.name} needs more memory to read than CodeTrellis allows. Ask for a smaller part of it.`
            : `${req.name} could not be read (the reader stopped)`,
        });
      });
      if (!child.connected) { judge(); return; }
      const cap = setTimeout(judge, 2_000);
      child.once('disconnect', () => { clearTimeout(cap); judge(); });
    });
    child.send({ ...req, bytes: req.bytes });
  });
}

async function readBytes(file: ServableFile, cap: number): Promise<Buffer | null | 'missing'> {
  try {
    return await readServableCapped(file, cap);
  } catch {
    return 'missing';
  }
}

export async function readMaterial(
  attachmentUid: string,
  locator: MaterialLocator | null | undefined,
  opts: { script?: string; timeoutMs?: number; engine?: EngineHost | null } = {},
): Promise<MaterialRead> {
  const file = await resolveServable(attachmentUid);
  if (!file) return { ok: false, status: 404, reason: 'No material with that uid is a file CodeTrellis can read' };
  const name = path.basename(file.rel);
  const ext = path.extname(file.rel).slice(1).toLowerCase();
  const base = { name, itemUid: file.itemUid };
  const hasLocator = !!locator && Object.values(locator).some((v) => v !== undefined);

  if (VIDEO_EXTS.has(ext)) {
    return { ok: false, status: 415, reason: `${name} is a video; it can be watched in CodeTrellis but not read as text`, ...base };
  }
  if (ext === 'xls') {
    return { ok: false, status: 415, reason: `${name} is an old-format Excel workbook, which is not read as text; saved as .xlsx it can be`, ...base };
  }

  const image = IMAGE_TYPES[ext];
  if (image) {
    if (hasLocator) return { ok: false, status: 422, reason: `${name} is an image; it is read whole, without a locator`, ...base };
    const bytes = await readBytes(file, IMAGE_CAP);
    if (bytes === 'missing') return { ok: false, status: 404, reason: `${name} is not there, or is not a regular file in the project`, ...base };
    if (!bytes) return { ok: false, status: 413, reason: `${name} is larger than the ${IMAGE_CAP / 1024 / 1024} MB an image read returns`, ...base };
    if (!image.magic(bytes)) return { ok: false, status: 422, reason: `${name} is named .${ext} but is not that kind of image`, ...base };
    return { ok: true, kind: 'image', ...base, mimeType: image.mimeType, base64: bytes.toString('base64'), bytes: bytes.length };
  }

  const cap = READ_CAPS[ext] ?? (TEXT_EXTS.has(ext) ? TEXT_CAP : 0);
  if (!cap) return { ok: false, status: 415, reason: `.${ext} files are not read as text`, ...base };
  const bytes = await readBytes(file, cap);
  if (bytes === 'missing') return { ok: false, status: 404, reason: `${name} is not there, or is not a regular file in the project`, ...base };
  if (!bytes) return { ok: false, status: 413, reason: `${name} is larger than the ${Math.round(cap / 1024 / 1024)} MB CodeTrellis reads of a .${ext} file`, ...base };

  // §5.1: a Word document or deck the viewer has already rendered is read
  // as that rendition — the words on the pages the person sees.
  const rendition = ext === 'docx' || ext === 'pptx' ? await existingRendition(bytes, ext, opts.engine) : null;
  const reply = await runReader({ name, ext, bytes, locator, rendition }, opts);
  if (!reply.ok) return { ok: false, status: 'timedOut' in reply ? 504 : 422, reason: reply.reason, ...base };
  return { ok: true, kind: 'text', ...base, reply };
}
