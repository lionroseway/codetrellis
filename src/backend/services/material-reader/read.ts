/**
 * Phase 31 §5.1 — a material's content as text an agent can use: CSV per
 * sheet for a workbook, markdown for a Word document, words per slide for a
 * deck, text per page for a PDF, numbered lines for a text file.
 *
 * Bytes and a name in, text out. Nothing here touches the filesystem or
 * the database — the host reads the file through the confined resolver and
 * hands over only its bytes, and this runs in a worker thread under memory
 * and time limits (reader-host.ts). The caps are the viewer's (§7.2): every
 * zip part is inflated under a budget, rows, cells and pages are capped,
 * and what comes back is capped again, with a note saying what was left out
 * and the locator that reads it.
 *
 * Nothing is run or followed: a workbook's cells are the values the
 * spreadsheet app last saved, macros are reported and never run, a Word
 * document's linked images are never fetched, and a PDF's scripts and
 * forms are not evaluated.
 */

import mammoth from 'mammoth';
import { CapError, listEntries, readEntry, readText, type InflateBudget } from '../../../shared/lib/zip-reader';
import { colLetters, parseDateStyles, parseSharedStrings, parseSheetGrid, parseWorkbookSheets, sheetDimension } from '../../../shared/lib/xlsx-xml';
import { slideOrder, slideText } from '../../../shared/lib/pptx-xml';
import { parseRange, toSpan, TEXT_EXTS, type CellRange } from '../../../shared/lib/locator';
import { docxHtmlToMarkdown } from './docx-markdown';

/** The places `read_material` narrows to — the evidence locator's own shapes (§8.1). */
export interface MaterialLocator {
  sheet?: string;
  range?: string;
  /** A PDF page or a deck's slide: `3`, or a span `"3-5"`. */
  page?: number | string;
  /** Lines of a text file, or of a Word document's markdown: `40`, `"40-80"`. */
  lines?: number | string;
  /** Words to find: the page, slide, sheet or passage that has them comes back. */
  text?: string;
}

export interface ReadRequest {
  /** The file's name, for the words in the result — never opened. */
  name: string;
  ext: string;
  bytes: Uint8Array;
  locator?: MaterialLocator | null;
  /**
   * The PDF CodeTrellis already made of this DOCX or PPTX to show it (§7.6),
   * when there is one. Read in its place, so an agent reads the words on the
   * pages the person sees (§5.1).
   */
  rendition?: Uint8Array | null;
}

export interface ReadSection { heading: string; body: string }

export type ReadReply =
  | {
    ok: true;
    format: 'csv' | 'markdown' | 'text';
    /** What part was read, in words ("sheet Regional", "pages 2–3"); null for the whole file. */
    where: string | null;
    /** What the whole file holds, so the agent knows what else it can ask for. */
    outline: string;
    sections: ReadSection[];
    notes: string[];
  }
  | { ok: false; reason: string };

/** What one read returns at most — about 25k tokens. */
export const MAX_OUTPUT_CHARS = 100_000;
const MAX_PART_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const SHEET_CAPS = { maxRows: 5000, maxCols: 200, maxCells: 250_000 };
const MAX_PDF_PAGES = 500;
const MAX_SLIDES = 500;
/** Lines either side of a `{text}` match in a linear document. */
const TEXT_CONTEXT_LINES = 15;


class ReadError extends Error {}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const dash = (a: number, b: number) => (a === b ? String(a) : `${a}–${b}`);

// ── Output budget ─────────────────────────────────────────────────────

/**
 * Sections in order until the budget is spent. A section that does not fit
 * is cut at a line, and the note names the locator that reads the rest.
 */
function fit(sections: ReadSection[], notes: string[], rest: (heading: string) => string): ReadSection[] {
  const out: ReadSection[] = [];
  let left = MAX_OUTPUT_CHARS;
  for (const [i, s] of sections.entries()) {
    const cost = s.heading.length + s.body.length + 4;
    if (cost <= left) { out.push(s); left -= cost; continue; }
    let partly = false;
    if (left > 2000) {
      const heading = `${s.heading} (cut short)`;
      const cut = s.body.slice(0, left - heading.length - 4);
      out.push({ heading, body: cut.slice(0, Math.max(0, cut.lastIndexOf('\n'))) });
      partly = true;
    }
    const skipped = sections.slice(partly ? i + 1 : i).map((x) => x.heading);
    notes.push(`Stopped at about ${MAX_OUTPUT_CHARS.toLocaleString('en-GB')} characters. ${rest(s.heading)}${skipped.length ? ` Not shown: ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ', …' : ''}.` : ''}`);
    break;
  }
  return out;
}

// ── Text files ────────────────────────────────────────────────────────

function numbered(lines: string[], start: number, end: number): string {
  const width = String(end).length;
  const out: string[] = [];
  for (let n = start; n <= end; n++) out.push(`${String(n).padStart(width)}  ${lines[n - 1]}`);
  return out.join('\n');
}

/** A linear document's lines: the span asked for, the passage around `{text}`, or all of it. */
function readLines(
  lines: string[],
  locator: MaterialLocator,
  opts: { number: boolean; name: string },
): { where: string | null; section: ReadSection } {
  const total = lines.length;
  const body = (a: number, b: number) => (opts.number ? numbered(lines, a, b) : lines.slice(a - 1, b).join('\n'));
  if (locator.lines !== undefined) {
    const span = toSpan(locator.lines);
    if (!span || span.start < 1 || span.end < span.start) {
      throw new ReadError(`lines must be a line number or a span such as "10-20" — got ${JSON.stringify(locator.lines)}`);
    }
    if (span.start > total) throw new ReadError(`${opts.name} has ${total} lines; ${span.start} is past the end`);
    const end = Math.min(span.end, total);
    return { where: `lines ${dash(span.start, end)}`, section: { heading: `Lines ${dash(span.start, end)} of ${total}`, body: body(span.start, end) } };
  }
  if (locator.text !== undefined) {
    const quote = squash(locator.text);
    if (!quote) throw new ReadError('text must be the words to find');
    // The line the quote starts on: match across line breaks by squashing a window.
    const at = lines.findIndex((_, i) => squash(lines.slice(i, i + 8).join(' ')).includes(quote));
    if (at < 0) throw new ReadError(`${opts.name} does not contain "${locator.text.slice(0, 80)}"`);
    let first = at;
    while (first + 1 < total && squash(lines.slice(first + 1, first + 9).join(' ')).includes(quote)) first++;
    const a = Math.max(1, first + 1 - TEXT_CONTEXT_LINES);
    const b = Math.min(total, first + 1 + TEXT_CONTEXT_LINES);
    return { where: `the passage at line ${first + 1}`, section: { heading: `Lines ${dash(a, b)} of ${total}`, body: body(a, b) } };
  }
  return { where: null, section: { heading: `Lines 1–${total}`, body: body(1, total) } };
}

function readTextFile(req: ReadRequest, locator: MaterialLocator): ReadReply {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(req.bytes);
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const notes: string[] = [];
  refuseKeys(locator, ['lines', 'text'], req);
  const { where, section } = readLines(lines, locator, { number: true, name: req.name });
  const sections = fit([section], notes, () => 'Ask for {"lines": "N-M"} to read further.');
  return { ok: true, format: 'text', where, outline: `${lines.length} lines`, sections, notes };
}

// ── Workbooks ─────────────────────────────────────────────────────────

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(rows: string[][]): string {
  // Trailing empty rows and columns say nothing.
  let lastRow = rows.length;
  while (lastRow > 0 && rows[lastRow - 1].every((c) => c === '')) lastRow--;
  const width = Math.max(0, ...rows.slice(0, lastRow).map((r) => {
    let w = r.length;
    while (w > 0 && r[w - 1] === '') w--;
    return w;
  }));
  return rows.slice(0, lastRow).map((r) => Array.from({ length: width }, (_, i) => csvField(r[i] ?? '')).join(',')).join('\n');
}

async function readWorkbook(req: ReadRequest, locator: MaterialLocator): Promise<ReadReply> {
  refuseKeys(locator, ['sheet', 'range', 'text'], req);
  const view = new DataView(req.bytes.buffer, req.bytes.byteOffset, req.bytes.byteLength);
  const entries = listEntries(view);
  const budget: InflateBudget = { maxPart: MAX_PART_BYTES, maxTotal: MAX_TOTAL_BYTES, used: 0 };
  const part = (name: string) => readText(view, entries, name, budget);
  const workbook = await part('xl/workbook.xml');
  if (!workbook) throw new ReadError(`${req.name} is not an Excel workbook — it has no workbook part`);
  const refs = parseWorkbookSheets(workbook, (await part('xl/_rels/workbook.xml.rels')) ?? '');
  const shared = parseSharedStrings((await part('xl/sharedStrings.xml')) ?? '');
  const dates = parseDateStyles((await part('xl/styles.xml')) ?? '');

  const notes = ['Each cell is the value the spreadsheet app last saved; formulas are not re-calculated.'];
  if (entries.some((e) => /vbaProject\.bin$/i.test(e.name))) notes.push('This workbook carries macros. They were not run.');

  let range: CellRange | null = null;
  if (locator.range !== undefined) {
    range = parseRange(String(locator.range).trim());
    if (!range) throw new ReadError(`"${locator.range}" is not a cell or range — write it as C14 or A1:F20`);
  }
  let chosen = refs;
  if (locator.sheet !== undefined) {
    const want = String(locator.sheet);
    const hit = refs.find((r) => r.name === want) ?? refs.find((r) => r.name.toLowerCase() === want.trim().toLowerCase());
    if (!hit) throw new ReadError(`${req.name} has no sheet "${want}" — it has ${refs.map((r) => `"${r.name}"`).join(', ') || 'none'}`);
    chosen = [hit];
  } else if (range) {
    chosen = refs.slice(0, 1);
  }

  const dims: string[] = [];
  const sections: ReadSection[] = [];
  let cellsLeft = SHEET_CAPS.maxCells;
  for (const ref of refs) {
    const xml = ref.part ? await part(ref.part) : null;
    const dimension = xml ? sheetDimension(xml) : null;
    dims.push(`${ref.name}${dimension ? ` (${dimension})` : ''}`);
    if (!chosen.includes(ref) || !xml) continue;
    const caps = range
      ? { maxRows: range.to.row, maxCols: range.to.col, maxCells: cellsLeft }
      : { ...SHEET_CAPS, maxCells: cellsLeft };
    const grid = parseSheetGrid(xml, shared, dates, caps);
    cellsLeft = Math.max(0, cellsLeft - grid.cells);
    let rows = grid.rows;
    let heading = `Sheet "${ref.name}"`;
    if (range) {
      rows = rows.slice(range.from.row - 1, range.to.row).map((r) => r.slice(range!.from.col - 1, range!.to.col));
      heading += `, ${colLetters(range.from.col)}${range.from.row}:${colLetters(range.to.col)}${range.to.row}`;
    } else if (grid.truncated) {
      notes.push(`Sheet "${ref.name}" goes past ${SHEET_CAPS.maxRows.toLocaleString('en-GB')} rows or ${SHEET_CAPS.maxCols} columns; ask for {"sheet": "${ref.name}", "range": "A${SHEET_CAPS.maxRows + 1}:…"} to read further.`);
    }
    if (!range) heading += ' from A1';
    sections.push({ heading, body: toCsv(rows) });
  }

  let shown = sections;
  let where: string | null = locator.sheet !== undefined || range ? sections.map((s) => s.heading.replace(/^Sheet /, 'sheet ').replace(/ from A1$/, '')).join('; ') : null;
  if (locator.text !== undefined) {
    const quote = squash(locator.text);
    if (!quote) throw new ReadError('text must be the words to find');
    shown = sections.filter((s) => squash(s.body.replace(/"/g, '')).includes(quote) || squash(s.body).includes(quote));
    if (shown.length === 0) throw new ReadError(`No sheet in ${req.name} contains "${locator.text.slice(0, 80)}"`);
    where = shown.map((s) => s.heading.replace(/^Sheet /, 'sheet ').replace(/ from A1$/, '')).join('; ');
  }
  return {
    ok: true,
    format: 'csv',
    where,
    outline: `${refs.length} sheet${refs.length === 1 ? '' : 's'}: ${dims.join(', ')}`,
    sections: fit(shown, notes, () => 'Ask for one {"sheet"} and a {"range"} to read the rest.'),
    notes,
  };
}

// ── Word ──────────────────────────────────────────────────────────────

async function readWord(req: ReadRequest, locator: MaterialLocator): Promise<ReadReply> {
  // {lines} are this markdown's lines, so they are always read from it.
  if (req.rendition && locator.lines === undefined) {
    refuseKeys(locator, ['page', 'text', 'lines'], req);
    const read = await readPdfPages(req.rendition, req.name, locator, 'page');
    return pagesReply(read!, locator, 'page', [
      'Read from the pages CodeTrellis shows: its rendition of this document, laid out as the person sees it.',
      'To cite this document, quote it: {"text": "…"}. A {"page"} says where the words are on these pages, but is not checked — a Word document\'s pages depend on layout.',
      'Ask for {"lines": "1-200"} to read it as markdown instead, with its headings and tables.',
    ]);
  }
  if (locator.page !== undefined) {
    throw new ReadError(`${req.name} is a Word document; its pages depend on layout. Ask for {"lines"} of what this returns, or {"text"}`);
  }
  refuseKeys(locator, ['lines', 'text'], req);
  const view = new DataView(req.bytes.buffer, req.bytes.byteOffset, req.bytes.byteLength);
  const entries = listEntries(view);
  if (!entries.some((e) => e.name === 'word/document.xml')) {
    throw new ReadError(`${req.name} is not a Word document — it has no document part`);
  }
  // mammoth inflates without limits, so every entry is inflated under the
  // budget first; inflation is deterministic, so what passes here cannot
  // give mammoth more (docx-worker.ts does the same).
  const budget: InflateBudget = { maxPart: MAX_PART_BYTES, maxTotal: MAX_TOTAL_BYTES, used: 0 };
  for (const e of entries) await readEntry(view, e, budget);

  let images = 0;
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(req.bytes.buffer, req.bytes.byteOffset, req.bytes.byteLength) }, {
    // A document can link an image by path instead of embedding it. Never follow one.
    externalFileAccess: false,
    convertImage: mammoth.images.imgElement(async () => { images++; return { src: '' }; }),
  });
  const markdown = docxHtmlToMarkdown(result.value);
  const lines = markdown.split('\n');
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const notes: string[] = [
    'Converted to markdown: headings, lists, tables and emphasis survive; page layout does not.',
    'To cite this document, quote it: {"text": "…"}. Line numbers here are this markdown\'s, not the document\'s.',
  ];
  if (images) notes.push(`${images} image${images === 1 ? '' : 's'} shown as [image]; open the document in CodeTrellis to see them.`);
  const { where, section } = readLines(lines, locator, { number: false, name: req.name });
  return {
    ok: true,
    format: 'markdown',
    where,
    outline: `${lines.length} lines of markdown`,
    sections: fit([section], notes, () => 'Ask for {"lines": "N-M"} of this markdown to read further.'),
    notes,
  };
}

// ── Pages: PDF and decks ──────────────────────────────────────────────

function pageSpan(locator: MaterialLocator, count: number, noun: 'page' | 'slide', name: string): { start: number; end: number } | null {
  if (locator.page === undefined) return null;
  const span = toSpan(locator.page);
  if (!span || span.start < 1 || span.end < span.start) {
    throw new ReadError(`page must be a ${noun} number from 1, or a span such as "2-4" — got ${JSON.stringify(locator.page)}`);
  }
  if (span.start > count) throw new ReadError(`${name} has ${count} ${noun}s; ${span.start} is not one of them`);
  return { start: span.start, end: Math.min(span.end, count) };
}

function narrowByText(sections: ReadSection[], locator: MaterialLocator, name: string): ReadSection[] {
  if (locator.text === undefined) return sections;
  const quote = squash(locator.text);
  if (!quote) throw new ReadError('text must be the words to find');
  const hits = sections.filter((s) => squash(`${s.heading} ${s.body}`).includes(quote));
  if (hits.length === 0) throw new ReadError(`${name} does not contain "${locator.text.slice(0, 80)}"`);
  return hits;
}

async function readDeck(req: ReadRequest, locator: MaterialLocator): Promise<ReadReply> {
  refuseKeys(locator, ['page', 'text'], req);
  const view = new DataView(req.bytes.buffer, req.bytes.byteOffset, req.bytes.byteLength);
  const entries = listEntries(view);
  const names = entries.map((e) => e.name);
  if (!names.includes('ppt/presentation.xml')) throw new ReadError(`${req.name} is not a PowerPoint deck — it has no presentation part`);
  const budget: InflateBudget = { maxPart: MAX_PART_BYTES, maxTotal: MAX_TOTAL_BYTES, used: 0 };
  const order = slideOrder(
    await readText(view, entries, 'ppt/presentation.xml', budget),
    await readText(view, entries, 'ppt/_rels/presentation.xml.rels', budget),
    names,
  );
  const notes = ['Each slide\'s title and words in presentation order; pictures and charts are not described.'];
  if (req.rendition) {
    // A deck's PDF leaves hidden slides out, and then its page 3 is not
    // slide 3 — the numbering an agent cites and the checker counts. Only a
    // rendition with a page for every slide is read as the slides.
    const read = await readPdfPages(req.rendition, req.name, locator, 'slide', order.length);
    if (read) {
      return pagesReply(read, locator, 'slide', [
        'Read from the slides as CodeTrellis shows them: the words on each, laid out as the person sees it. Pictures are not described.',
      ]);
    }
    notes.push('Read from the slides themselves: the view CodeTrellis shows leaves some out (hidden slides), so its pages are not numbered as the slides are.');
  }
  const span = pageSpan(locator, order.length, 'slide', req.name);
  const first = span?.start ?? 1;
  const last = Math.min(span?.end ?? order.length, MAX_SLIDES);
  if (order.length > MAX_SLIDES && !span) notes.push(`Only the first ${MAX_SLIDES} slides are read.`);
  const sections: ReadSection[] = [];
  for (let n = first; n <= last; n++) {
    const xml = await readText(view, entries, order[n - 1], budget);
    const s = xml ? slideText(n, xml) : { n, title: null, paragraphs: [] };
    sections.push({ heading: `Slide ${n}${s.title ? ` — ${s.title}` : ''}`, body: s.paragraphs.join('\n') || '(no words)' });
  }
  const shown = narrowByText(sections, locator, req.name);
  const where = locator.text !== undefined
    ? shown.map((s) => s.heading.split(' — ')[0].toLowerCase()).join(', ')
    : span ? `slide${span.start === span.end ? '' : 's'} ${dash(span.start, span.end)}` : null;
  return {
    ok: true,
    format: 'markdown',
    where,
    outline: `${order.length} slide${order.length === 1 ? '' : 's'}`,
    sections: fit(shown, notes, () => 'Ask for {"page": "N-M"} to read further slides.'),
    notes,
  };
}

interface PdfTextItem { str?: string; hasEOL?: boolean }
interface PdfJs {
  getDocument(src: object): { promise: Promise<PdfDoc>; destroy(): Promise<void> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: PdfTextItem[] }>; cleanup(): void }>;
}

let pdfjsLoaded: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  // pdf.js runs its parser in this thread: the worker module is handed over
  // as a global rather than started as a second worker.
  pdfjsLoaded ??= (async () => {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
  })();
  return pdfjsLoaded;
}

interface PageRead {
  count: number;
  span: { start: number; end: number } | null;
  sections: ReadSection[];
  notes: string[];
}

/**
 * A PDF's text, page by page. `noun` is what a page is called — a rendition
 * of a deck has a page per slide. With `expectPages`, a PDF with any other
 * number of pages is not read, and null comes back.
 */
async function readPdfPages(
  bytes: Uint8Array, name: string, locator: MaterialLocator, noun: 'page' | 'slide', expectPages?: number,
): Promise<PageRead | null> {
  const Noun = noun === 'page' ? 'Page' : 'Slide';
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    let doc: PdfDoc;
    try {
      doc = await task.promise;
    } catch (err) {
      const errName = (err as { name?: string }).name;
      throw new ReadError(errName === 'PasswordException'
        ? `${name} is password-protected, so its text cannot be read`
        : `${name} could not be read as a PDF (${(err as Error).message})`);
    }
    if (expectPages !== undefined && doc.numPages !== expectPages) return null;
    const span = pageSpan(locator, doc.numPages, noun, name);
    const notes: string[] = [];
    const first = span?.start ?? 1;
    const last = Math.min(span?.end ?? doc.numPages, first + MAX_PDF_PAGES - 1);
    if (!span && doc.numPages > MAX_PDF_PAGES) notes.push(`Only the first ${MAX_PDF_PAGES} ${noun}s are read.`);
    const sections: ReadSection[] = [];
    let chars = 0;
    for (let n = first; n <= last; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const body = content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
      page.cleanup();
      sections.push({ heading: `${Noun} ${n}`, body: body || (noun === 'page' ? '(no text on this page — it may be a scanned image)' : '(no text on this slide — it may be a picture)') });
      chars += body.length;
      // Past what one read returns, further pages would only be cut.
      if (chars > MAX_OUTPUT_CHARS * 2 && locator.text === undefined) break;
    }
    return { count: doc.numPages, span, sections: narrowByText(sections, locator, name), notes };
  } finally {
    await task.destroy().catch(() => {});
  }
}

function pagesReply(read: PageRead, locator: MaterialLocator, noun: 'page' | 'slide', notes: string[]): ReadReply {
  const { count, span, sections } = read;
  const all = [...notes, ...read.notes];
  const where = locator.text !== undefined
    ? sections.map((s) => s.heading.toLowerCase()).join(', ')
    : span ? `${noun}${span.start === span.end ? '' : 's'} ${dash(span.start, span.end)}` : null;
  return {
    ok: true,
    format: 'text',
    where,
    outline: `${count} ${noun}${count === 1 ? '' : 's'}`,
    sections: fit(sections, all, () => `Ask for {"page": "N-M"} to read further ${noun}s.`),
    notes: all,
  };
}

async function readPdf(req: ReadRequest, locator: MaterialLocator): Promise<ReadReply> {
  refuseKeys(locator, ['page', 'text'], req);
  const read = await readPdfPages(req.bytes, req.name, locator, 'page');
  return pagesReply(read!, locator, 'page', []);
}

// ── Entry ─────────────────────────────────────────────────────────────

function refuseKeys(locator: MaterialLocator, allowed: Array<keyof MaterialLocator>, req: ReadRequest): void {
  const extra = (Object.keys(locator) as Array<keyof MaterialLocator>).filter((k) => locator[k] !== undefined && !allowed.includes(k));
  if (extra.length) {
    throw new ReadError(`A .${req.ext} file is read by ${allowed.map((k) => `{${k}}`).join(', ')} — not by ${extra.map((k) => `{${k}}`).join(', ')}`);
  }
}

export async function readMaterialBytes(input: ReadRequest): Promise<ReadReply> {
  // A Buffer survives IPC as a Buffer, and pdf.js refuses one: a plain view.
  const view = (b: Uint8Array) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  const req = { ...input, bytes: view(input.bytes), rendition: input.rendition ? view(input.rendition) : null };
  const locator = req.locator ?? {};
  try {
    switch (req.ext) {
      case 'xlsx': case 'xlsm': return await readWorkbook(req, locator);
      case 'docx': return await readWord(req, locator);
      case 'pptx': return await readDeck(req, locator);
      case 'pdf': return await readPdf(req, locator);
      default:
        if (TEXT_EXTS.has(req.ext)) return readTextFile(req, locator);
        return { ok: false, reason: `.${req.ext} files are not read as text` };
    }
  } catch (err) {
    if (err instanceof ReadError || err instanceof CapError) return { ok: false, reason: err.message };
    return { ok: false, reason: `${req.name} could not be read as a .${req.ext} file (${(err as Error).message})` };
  }
}
