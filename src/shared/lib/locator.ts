/**
 * Phase 31 §5 / §8.1 — the places a locator names, parsed one way.
 *
 * The same `{sheet, range}`, `{page}` and `{lines}` an agent cites in
 * evidence are what it asks `read_material` for, so the checker and the
 * reader share these parsers: a range the reader reads is a range the
 * checker accepts.
 */
import { colNumber } from './xlsx-xml';

export interface Cell { col: number; row: number }
export interface CellRange { from: Cell; to: Cell }

/** `C14`, `$C$14` — or null. */
export function parseCell(ref: string): Cell | null {
  const m = ref.replace(/\$/g, '').match(/^([A-Za-z]{1,3})(\d+)$/);
  return m ? { col: colNumber(m[1]), row: Number(m[2]) } : null;
}

/** `C14` or `A1:F20` — or null. */
export function parseRange(ref: string): CellRange | null {
  const [a, b] = ref.split(':');
  const from = parseCell(a ?? '');
  const to = b === undefined ? from : parseCell(b);
  return from && to ? { from, to } : null;
}

/** `12`, `"10-20"`, `[10, 20]` — a 1-based inclusive span, or null. */
export function toSpan(value: unknown): { start: number; end: number } | null {
  if (typeof value === 'number' && Number.isInteger(value)) return { start: value, end: value };
  if (Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n))) {
    return { start: value[0] as number, end: value[1] as number };
  }
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (m) return { start: Number(m[1]), end: Number(m[2] ?? m[1]) };
  }
  return null;
}

/** The formats read as lines: what a `{lines}` locator points into. */
export const TEXT_EXTS: ReadonlySet<string> = new Set(['md', 'txt', 'json', 'log', 'csv', 'html', 'htm', 'xml', 'svg']);

/** A locator in words, for a link or the way back: "lines 4–6", "Regional!C14", "page 3". */
export function describeLocator(locator: unknown): string {
  if (!locator || typeof locator !== 'object') return '';
  const l = locator as Record<string, unknown>;
  if (typeof l.range === 'string') return typeof l.sheet === 'string' ? `${l.sheet}!${l.range}` : String(l.range);
  if (typeof l.sheet === 'string') return l.sheet;
  if (typeof l.page === 'number') return `page ${l.page}`;
  if (l.lines !== undefined) {
    const v = Array.isArray(l.lines) ? `${l.lines[0]}–${l.lines[1]}` : String(l.lines).replace('-', '–');
    return /[–]/.test(v) ? `lines ${v}` : `line ${v}`;
  }
  if (l.t !== undefined) return `at ${l.t}`;
  if (typeof l.text === 'string') return `“${l.text.slice(0, 40)}${l.text.length > 40 ? '…' : ''}”`;
  return '';
}
