/**
 * Phase 31 §7.2 — reading a zip in a viewer worker, with caps.
 *
 * An .xlsx or .docx is a zip, and a zip can be a bomb: a few megabytes
 * that inflate to gigabytes. A worker shares the renderer's process, so
 * running out of memory here takes the window with it. Every part is
 * inflated as a stream and its real output counted — never the size the
 * archive declares — and abandoned the moment it passes the budget.
 */

export class CapError extends Error {}

export interface ZipEntry { name: string; method: number; compressedSize: number; offset: number }

/** What inflating may produce: per part, and across the whole archive. */
export interface InflateBudget { maxPart: number; maxTotal: number; used: number }

export function listEntries(view: DataView): ZipEntry[] {
  const floor = Math.max(0, view.byteLength - 22 - 0xffff);
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > view.byteLength || view.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt central directory');
    const nameLen = view.getUint16(p + 28, true);
    out.push({
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      offset: view.getUint32(p + 42, true),
      name: decoder.decode(new Uint8Array(view.buffer, view.byteOffset + p + 46, nameLen)),
    });
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return out;
}

/** One entry's bytes, inflated under the budget. */
export async function readEntry(view: DataView, e: ZipEntry, budget: InflateBudget): Promise<Uint8Array> {
  if (view.getUint32(e.offset, true) !== 0x04034b50) throw new Error('corrupt local header');
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
  const raw = new Uint8Array(view.buffer, view.byteOffset + start, e.compressedSize);
  if (e.method === 0) {
    budget.used += raw.byteLength;
    if (raw.byteLength > budget.maxPart || budget.used > budget.maxTotal) {
      throw new CapError(`${e.name} is larger than the viewer will read`);
    }
    return raw;
  }
  if (e.method !== 8) throw new Error(`${e.name} uses a compression this viewer does not read`);
  const reader = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    budget.used += value.byteLength;
    if (size > budget.maxPart || budget.used > budget.maxTotal) {
      await reader.cancel();
      throw new CapError(`${e.name} expands past what the viewer will read`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return bytes;
}

/** A named part as text, or null when the archive has no such part. */
export async function readText(view: DataView, entries: ZipEntry[], name: string, budget: InflateBudget): Promise<string | null> {
  const e = entries.find((x) => x.name === name);
  return e ? new TextDecoder().decode(await readEntry(view, e, budget)) : null;
}
