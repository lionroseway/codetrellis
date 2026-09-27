/**
 * One CSV parser for everything that reads a cell of a CSV file: the
 * viewer (which cell a citation highlights), the citation check (whether
 * the cell exists) and read_material (what the agent reads there). Three
 * parsers would disagree about a quoted comma, and then a cell the agent
 * cites is not the cell the person is shown (Phase 32 §0.4e).
 */

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Rows and the widest row's column count. */
export function csvShape(rows: string[][]): { rows: number; cols: number } {
  return { rows: rows.length, cols: Math.max(0, ...rows.map((r) => r.length)) };
}
