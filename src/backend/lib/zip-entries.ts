/**
 * Just enough of the zip format to read an Office file's parts.
 *
 * xlsx, docx and pptx are zip archives of XML. The loops (Phase 31 §8.1)
 * need to ask small questions of them — does this workbook have a sheet
 * called "Regional", does this document contain this sentence — and a
 * dependency to answer those would be the biggest thing in the backend.
 *
 * Reads the central directory, then inflates one named entry. Stored and
 * deflate only (what Office writes). Every size is capped: the caller hands
 * over a buffer it already read under its own cap, and an entry that would
 * inflate past `maxEntryBytes` is refused — a decompression bomb gets an
 * error, not the heap.
 */

import zlib from 'node:zlib';

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** The archive's entries, from its central directory. */
export function listZipEntries(buf: Buffer): ZipEntry[] {
  // The end-of-central-directory record is in the last 22 + 65535 bytes.
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new ZipError('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, size, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** One entry's bytes, inflated, or null when the archive has no such entry. */
export function readZipEntry(
  buf: Buffer,
  name: string,
  opts: { maxEntryBytes?: number; entries?: ZipEntry[] } = {},
): Buffer | null {
  const max = opts.maxEntryBytes ?? 20 * 1024 * 1024;
  const entry = (opts.entries ?? listZipEntries(buf)).find((e) => e.name === name);
  if (!entry) return null;
  const at = entry.localHeaderOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOC_SIG) throw new ZipError('corrupt local header');
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new ZipError('entry runs past the end of the archive');
  const raw = buf.subarray(start, end);
  if (entry.method === 0) {
    if (raw.length > max) throw new ZipError(`${name} is larger than ${max} bytes`);
    return Buffer.from(raw);
  }
  if (entry.method !== 8) throw new ZipError(`${name} uses compression method ${entry.method}`);
  try {
    return zlib.inflateRawSync(raw, { maxOutputLength: max });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new ZipError(`${name} inflates past ${max} bytes`);
    }
    throw new ZipError(`${name} could not be inflated`);
  }
}
