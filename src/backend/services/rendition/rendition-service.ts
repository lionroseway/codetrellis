/**
 * Phase 31 §7.6 — an Office file, as it looks, as a PDF.
 *
 * The file is found and read exactly as the viewer's bytes are (§7.1):
 * from the attachment uid, confined to its item's opened project, opened
 * once without following links. The engine is handed those bytes, never a
 * path. The PDF it returns is kept in `<dataDir>/renditions/`, named by the
 * hash of the bytes converted and the engine's version — so an unchanged
 * file is never converted twice, a changed one never shows a stale
 * rendition, and a second look does not start the engine.
 *
 * Anything that stops a conversion — no engine in this build, a runtime
 * that cannot confine it, a timeout, a document it cannot read — is a 503
 * with a sentence, and the viewer shows the packaged fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getDataDir } from '../persistence';
import { openReadStreamWithin, removeWithin, resolveWithin, writeFileWithin } from '../confined-fs';
import { resolveServable, type ServableFile } from '../artefact-content-service';
import { isPackagedElectron } from '../../mcp/connector/command';
import { ENGINE_PIN } from './engine-lock';
import { EngineHost, EngineUnavailable, ConversionFailed, ConversionTimedOut } from './engine-host';

/** What the engine converts, and the most it will read of each (§7.2's caps). */
export const CONVERTIBLE: Record<string, number> = {
  docx: 25 * 1024 * 1024,
  pptx: 100 * 1024 * 1024,
  xlsx: 25 * 1024 * 1024,
  xls: 25 * 1024 * 1024,
};

const CACHE_CAP_BYTES = 500 * 1024 * 1024;

export type RenditionResult =
  | { ok: true; file: ServableFile }
  | { ok: false; status: 404 | 413 | 415 | 503; reason: string };

let sharedHost: EngineHost | null | undefined;

/**
 * The app's one engine host — or null when this build carries no engine.
 * Packaged, only the engine shipped beside the asar and the hashes pinned in
 * this build count. From source, `CODETRELLIS_RENDITION_ENGINE` may point at
 * a locally built engine, which is then checked against its own manifest.
 */
export function getEngineHost(): EngineHost | null {
  if (sharedHost !== undefined) return sharedHost;
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  const packaged = isPackagedElectron({ execPath: process.execPath, electronVersion: process.versions.electron });
  if (packaged) {
    sharedHost = ENGINE_PIN && resourcesPath
      ? new EngineHost({
        engineDir: path.join(resourcesPath, 'rendition', 'engine'),
        childScript: path.join(resourcesPath, 'rendition', 'engine-child.cjs'),
        pinned: ENGINE_PIN,
      })
      : null;
  } else {
    sharedHost = new EngineHost({
      engineDir: process.env.CODETRELLIS_RENDITION_ENGINE || path.join(process.cwd(), 'resources', 'rendition', 'engine'),
      childScript: path.join(process.cwd(), 'out', 'rendition', 'engine-child.cjs'),
      pinned: ENGINE_PIN,
    });
  }
  return sharedHost;
}

/** Stop the engine now — the app is quitting or going to sleep. */
export function stopEngine(): void {
  sharedHost?.stop();
}

function cacheRoot(): string {
  const root = path.join(getDataDir(), 'renditions');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function readCapped(file: ServableFile, cap: number): Promise<Buffer | null> {
  const { stream, size } = openReadStreamWithin(file.root, file.rel, {}, 'attachment');
  if (size > cap) { stream.destroy(); return Promise.resolve(null); }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let read = 0;
    stream.on('data', (chunk: string | Buffer) => {
      const c = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      read += c.length;
      // The file grew after it was measured.
      if (read > cap) { stream.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** Oldest-first, until the cache is under its cap. */
function prune(root: string): void {
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.pdf'))
    .map((e) => { const st = fs.statSync(path.join(root, e.name)); return { name: e.name, size: st.size, mtimeMs: st.mtimeMs }; })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = entries.reduce((n, e) => n + e.size, 0);
  for (const e of entries) {
    if (total <= CACHE_CAP_BYTES) break;
    try { removeWithin(root, e.name, {}, 'rendition'); total -= e.size; } catch { /* in use, or gone */ }
  }
}

const inFlight = new Map<string, Promise<RenditionResult>>();

export async function renditionOf(uid: string, host: EngineHost | null = getEngineHost()): Promise<RenditionResult> {
  const file = await resolveServable(uid);
  if (!file) return { ok: false, status: 404, reason: 'This attachment is not a file that can be shown' };
  const ext = path.extname(file.rel).slice(1).toLowerCase();
  const cap = CONVERTIBLE[ext];
  if (!cap) return { ok: false, status: 415, reason: `.${ext} files are not converted` };
  if (!host) return { ok: false, status: 503, reason: 'this build carries no conversion engine' };

  const checked = await host.check();
  if (!checked.ok) return { ok: false, status: 503, reason: checked.reason };

  let bytes: Buffer | null;
  try { bytes = await readCapped(file, cap); } catch {
    return { ok: false, status: 404, reason: 'The file is not there, or is not a regular file in the project' };
  }
  if (!bytes) return { ok: false, status: 413, reason: 'This file is larger than the viewer will convert' };

  const sha = createHash('sha256').update(bytes).digest('hex');
  const name = `${sha}-${checked.manifest.version.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
  const root = cacheRoot();
  const served = (): RenditionResult => ({ ok: true, file: { root, rel: name, contentType: 'application/pdf', itemUid: file.itemUid } });

  try {
    const cached = resolveWithin(root, name, 'rendition');
    if (fs.lstatSync(cached).isFile()) {
      const now = new Date();
      fs.utimesSync(cached, now, now);
      return served();
    }
  } catch { /* not cached */ }

  const running = inFlight.get(name);
  if (running) return running;
  const job = (async (): Promise<RenditionResult> => {
    try {
      let pdf: Uint8Array;
      try {
        pdf = await host.convert(bytes, ext);
      } catch (err) {
        // A hang has been seen in roughly one conversion in fifteen, and not
        // again on a fresh engine; the hung one was killed. One retry.
        if (!(err instanceof ConversionTimedOut)) throw err;
        pdf = await host.convert(bytes, ext);
      }
      writeFileWithin(root, name, Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength), 'rendition');
      prune(root);
      return served();
    } catch (err) {
      if (err instanceof EngineUnavailable || err instanceof ConversionFailed) {
        return { ok: false, status: 503, reason: err.message };
      }
      console.warn('[rendition] unexpected failure', err);
      return { ok: false, status: 503, reason: 'The document could not be converted' };
    } finally {
      inFlight.delete(name);
    }
  })();
  inFlight.set(name, job);
  return job;
}
