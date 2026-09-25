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
import { CapError, listEntries, readText, type InflateBudget } from '../../shared/lib/zip-reader';

export interface XlsxRequest { buffer: ArrayBuffer }
export interface XlsxSheet { name: string; dimension: string | null; rows: string[][]; truncated: boolean }
export type XlsxReply =
  | { ok: true; sheets: XlsxSheet[]; macros: boolean; truncated: boolean }
  | { ok: false; reason: string };

const MAX_PART_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const CAPS = { maxRows: 2000, maxCols: 200, maxCells: 200_000 };

async function readWorkbook(buffer: ArrayBuffer): Promise<XlsxReply> {
  const view = new DataView(buffer);
  const entries = listEntries(view);
  const budget: InflateBudget = { maxPart: MAX_PART_BYTES, maxTotal: MAX_TOTAL_BYTES, used: 0 };
  const readPart = (name: string) => readText(view, entries, name, budget);
  const workbook = await readPart('xl/workbook.xml');
  if (!workbook) return { ok: false, reason: 'This is not an Excel workbook (.xlsx) — it has no workbook part.' };
  const rels = (await readPart('xl/_rels/workbook.xml.rels')) ?? '';
  const shared = parseSharedStrings((await readPart('xl/sharedStrings.xml')) ?? '');
  const dates = parseDateStyles((await readPart('xl/styles.xml')) ?? '');
  const macros = entries.some((e) => /vbaProject\.bin$/i.test(e.name));

  const sheets: XlsxSheet[] = [];
  let cellsLeft = CAPS.maxCells;
  let truncated = false;
  for (const ref of parseWorkbookSheets(workbook, rels)) {
    const xml = ref.part ? await readPart(ref.part) : null;
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
