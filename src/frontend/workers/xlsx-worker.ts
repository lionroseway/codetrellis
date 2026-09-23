/// <reference lib="webworker" />
/**
 * Phase 31 §7.2 — a workbook read in a worker, with caps.
 *
 * An .xlsx is a zip, and a zip can be a bomb. The page hands over bytes it
 * already capped; here every inflated part is counted as it streams and
 * abandoned past the limit, rows, columns and cells are capped, and the page
 * terminates this worker if it runs past its time. Any of those produces a
 * sentence and the metadata card — never a hung window.
 *
 * Nothing is evaluated: each cell's value is the one the spreadsheet app
 * last saved. Macros in an .xlsm are reported, never run — nothing here
 * could run them.
 */
import {
  parseDateStyles,
  parseSharedStrings,
  parseSheetGrid,
  parseWorkbookSheets,
  sheetDimension,
} from '../../shared/lib/xlsx-xml';

export interface XlsxRequest { buffer: ArrayBuffer }
export interface XlsxSheet { name: string; dimension: string | null; rows: string[][]; truncated: boolean }
export type XlsxReply =
  | { ok: true; sheets: XlsxSheet[]; macros: boolean; truncated: boolean }
  | { ok: false; reason: string };

const MAX_PART_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const CAPS = { maxRows: 2000, maxCols: 200, maxCells: 200_000 };

class CapError extends Error {}

interface Entry { name: string; method: number; compressedSize: number; offset: number }

function listEntries(view: DataView): Entry[] {
  const floor = Math.max(0, view.byteLength - 22 - 0xffff);
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out: Entry[] = [];
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

let totalOut = 0;

async function readPart(view: DataView, entries: Entry[], name: string): Promise<string | null> {
  const e = entries.find((x) => x.name === name);
  if (!e) return null;
  if (view.getUint32(e.offset, true) !== 0x04034b50) throw new Error('corrupt local header');
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
  const raw = new Uint8Array(view.buffer, view.byteOffset + start, e.compressedSize);
  let bytes: Uint8Array;
  if (e.method === 0) {
    bytes = raw;
  } else if (e.method === 8) {
    const reader = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      totalOut += value.byteLength;
      if (size > MAX_PART_BYTES || totalOut > MAX_TOTAL_BYTES) {
        await reader.cancel();
        throw new CapError(`${name} expands past what the viewer will read`);
      }
      chunks.push(value);
    }
    bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  } else {
    throw new Error(`${name} uses a compression this viewer does not read`);
  }
  return new TextDecoder().decode(bytes);
}

async function readWorkbook(buffer: ArrayBuffer): Promise<XlsxReply> {
  totalOut = 0;
  const view = new DataView(buffer);
  const entries = listEntries(view);
  const workbook = await readPart(view, entries, 'xl/workbook.xml');
  if (!workbook) return { ok: false, reason: 'This is not an Excel workbook (.xlsx) — it has no workbook part.' };
  const rels = (await readPart(view, entries, 'xl/_rels/workbook.xml.rels')) ?? '';
  const shared = parseSharedStrings((await readPart(view, entries, 'xl/sharedStrings.xml')) ?? '');
  const dates = parseDateStyles((await readPart(view, entries, 'xl/styles.xml')) ?? '');
  const macros = entries.some((e) => /vbaProject\.bin$/i.test(e.name));

  const sheets: XlsxSheet[] = [];
  let cellsLeft = CAPS.maxCells;
  let truncated = false;
  for (const ref of parseWorkbookSheets(workbook, rels)) {
    const xml = ref.part ? await readPart(view, entries, ref.part) : null;
    if (!xml) { sheets.push({ name: ref.name, dimension: null, rows: [], truncated: false }); continue; }
    const grid = parseSheetGrid(xml, shared, dates, { ...CAPS, maxCells: Math.max(0, cellsLeft) });
    cellsLeft -= grid.cells;
    truncated ||= grid.truncated;
    sheets.push({ name: ref.name, dimension: sheetDimension(xml), rows: grid.rows, truncated: grid.truncated });
  }
  return { ok: true, sheets, macros, truncated };
}

self.onmessage = async (e: MessageEvent<XlsxRequest>) => {
  let reply: XlsxReply;
  try {
    reply = await readWorkbook(e.data.buffer);
  } catch (err) {
    reply = { ok: false, reason: err instanceof CapError ? err.message : `The workbook could not be read (${(err as Error).message}).` };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
};
