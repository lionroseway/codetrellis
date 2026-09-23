/**
 * Reading an .xlsx workbook's parts — the XML, not the zip.
 *
 * Used on both sides: the backend's mechanical checks ask "is there a
 * sheet called Regional, and does it reach C14" (Phase 31 §8.1), and the
 * viewer's worker lays the cells out as a grid (§7.2). The zip layer
 * differs (Node's zlib vs the browser's DecompressionStream); what a
 * workbook says is the same, so it is read here once.
 *
 * Values and layout only, which is what the viewer promises: the cached
 * value a spreadsheet app last wrote for each cell, never a formula
 * evaluated here, and no charts or conditional formatting. Nothing here
 * produces markup — the caller renders every value as text.
 */

export interface SheetRef {
  name: string;
  /** Path of the sheet part inside the archive, e.g. `xl/worksheets/sheet2.xml`. */
  part: string | null;
}

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Sheets in workbook order, each with the archive part that holds it. */
export function parseWorkbookSheets(workbookXml: string, relsXml: string): SheetRef[] {
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const sheets: SheetRef[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = m[0].match(/\bname="([^"]*)"/)?.[1];
    if (name === undefined) continue;
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1];
    sheets.push({ name: decodeXml(name), part: (rid && targets.get(rid)) || null });
  }
  return sheets;
}

/** The sheet's recorded used range, e.g. `A1:F20`. */
export function sheetDimension(sheetXml: string): string | null {
  return sheetXml.match(/<dimension\b[^>]*\bref="([^"]+)"/)?.[1] ?? null;
}

/** The shared-string table: each `<si>`'s text, rich-text runs joined. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let text = '';
    for (const t of si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    out.push(decodeXml(text));
  }
  return out;
}

/**
 * Which cell styles are dates. A cell's `s` indexes `cellXfs`; its
 * `numFmtId` is a built-in date format (14–22, 45–47) or a custom format
 * whose code has day or year tokens.
 */
export function parseDateStyles(stylesXml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(m[0].match(/\bnumFmtId="(\d+)"/)?.[1]);
    const code = decodeXml(m[0].match(/\bformatCode="([^"]*)"/)?.[1] ?? '');
    if (Number.isFinite(id)) custom.set(id, code);
  }
  const isDateFmt = (id: number) =>
    (id >= 14 && id <= 22) || (id >= 45 && id <= 47) ||
    (custom.has(id) && /(^|[^"\\])[dy]/i.test(custom.get(id)!.replace(/"[^"]*"/g, '')));
  const dates = new Set<number>();
  const xfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
    if (isDateFmt(Number(m[0].match(/\bnumFmtId="(\d+)"/)?.[1] ?? -1))) dates.add(i);
    i++;
  }
  return dates;
}

export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** An Excel serial date as YYYY-MM-DD (with the time when it has one). */
export function serialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const iso = new Date(ms).toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

export interface SheetGrid {
  /** Row-major, 0-based; row r is spreadsheet row r+1. Missing cells are ''. */
  rows: string[][];
  /** Rows or columns beyond the caps were left out. */
  truncated: boolean;
  cells: number;
}

/**
 * A sheet's cells as text, capped. Reads each cell's cached value: shared
 * strings, inline strings, numbers (dates by style), booleans, errors.
 */
export function parseSheetGrid(
  sheetXml: string,
  shared: string[],
  dateStyles: Set<number>,
  caps: { maxRows: number; maxCols: number; maxCells: number },
): SheetGrid {
  const rows: string[][] = [];
  let truncated = false;
  let cells = 0;
  for (const c of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = c[1];
    const ref = attrs.match(/\br="([A-Z]{1,3})(\d+)"/);
    if (!ref) continue;
    const col = colNumber(ref[1]);
    const row = Number(ref[2]);
    if (row > caps.maxRows || col > caps.maxCols) { truncated = true; continue; }
    if (cells >= caps.maxCells) { truncated = true; break; }
    const inner = c[2] ?? '';
    const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? 'n';
    const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1);
    const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    let text = '';
    if (type === 's') text = v !== undefined ? shared[Number(v)] ?? '' : '';
    else if (type === 'inlineStr') text = decodeXml([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
    else if (type === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
    else if (v !== undefined) {
      const raw = decodeXml(v);
      const n = Number(raw);
      text = type === 'n' && dateStyles.has(style) && Number.isFinite(n) ? serialToDate(n) : raw;
    }
    while (rows.length < row) rows.push([]);
    const r = rows[row - 1];
    while (r.length < col - 1) r.push('');
    r[col - 1] = text;
    cells++;
  }
  return { rows, truncated, cells };
}
