/**
 * Phase 31 §8.1 — the mechanical checks a criterion has.
 *
 * Every check answers in words, naming the file and the place, because the
 * reader is an agent that will act on it: "Q3-sales.xlsx has no sheet
 * "Regionl" — it has Summary, Regional" is a fix; "invalid locator" is a
 * conversation. Each finding is `pass`, `fail` or `unverified`, and only
 * `fail` refuses a submission: a format we cannot read yet, or a file past
 * the size cap, is said plainly and never counted against the agent.
 *
 * No model calls, nothing leaves the machine (§8.4). Files are read only
 * through the confined helpers, under the item's trusted project root.
 *
 * This module knows nothing about the database: the loop service gathers
 * the facts and hands them in, so the rules here are testable on their own.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readFileWithin, resolveWithin } from './confined-fs';
import { listZipEntries, readZipEntry, type ZipEntry } from '../lib/zip-entries';
import type { Artefact } from './artefact-service';
import { decodeXml, parseWorkbookSheets, sheetDimension } from '../../shared/lib/xlsx-xml';
import type { CheckFinding, CriterionCheck, CriterionKind } from '../../shared/types';

/** Past this, a file is not read for a check — the finding says so. */
export const MAX_CHECK_READ_BYTES = 50 * 1024 * 1024;

const TEXT_EXTS = new Set(['md', 'txt', 'json', 'log', 'csv', 'html', 'htm', 'xml', 'svg']);

export interface EvidenceFact {
  attachmentUid: string | null;
  locator: unknown;
  /** The recorded artefact, or null when the attachment is not one (or is not on this item). */
  artefact: Artefact | null;
}

export interface CheckContext {
  criterion: { uid: string; itemUid: string; kind: CriterionKind };
  /** The item's trusted project root, or null when that project is not open. */
  root: string | null;
  /** When the item started: its first move to in_progress, else its creation. */
  itemStartedAt: number;
  /** The newest mtime among the item's target files, when it has any on disk. */
  lastTargetChangeAt: number | null;
  /** What is offered — a submission, or a dry run of one. */
  evidence: EvidenceFact[];
  /** Every artefact on the item, for a check with no evidence offered yet. */
  itemArtefacts: Artefact[];
  /** A `code` criterion's review verdict; undefined when not computed. */
  code?: { verdict: 'landed' | 'partial' | 'untouched' | 'no-targets'; missing: string[] } | { unavailable: string };
}

const pass = (message: string, attachmentUid: string | null = null): CheckFinding => ({ status: 'pass', message, attachmentUid });
const fail = (message: string, attachmentUid: string | null = null): CheckFinding => ({ status: 'fail', message, attachmentUid });
const unverified = (message: string, attachmentUid: string | null = null): CheckFinding => ({ status: 'unverified', message, attachmentUid });

// ── Reading a file for a check ────────────────────────────────────────

type Read = { ok: true; buf: Buffer } | { ok: false; finding: CheckFinding };

function readForCheck(root: string, a: Artefact): Read {
  try {
    const st = fs.lstatSync(resolveWithin(root, a.path, 'artefact'));
    if (!st.isFile()) return { ok: false, finding: fail(`${a.path} is no longer a regular file in the project`, a.uid) };
    if (st.size > MAX_CHECK_READ_BYTES) {
      return { ok: false, finding: unverified(`${a.path} is larger than ${MAX_CHECK_READ_BYTES / 1024 / 1024} MB, so its contents were not checked`, a.uid) };
    }
    return { ok: true, buf: readFileWithin(root, a.path, 'artefact') };
  } catch {
    return { ok: false, finding: fail(`${a.path} is not in the project any more, or is now a link`, a.uid) };
  }
}

const extOf = (p: string) => path.extname(p).slice(1).toLowerCase();

// ── Office parts ──────────────────────────────────────────────────────


function zipText(buf: Buffer, name: string, entries: ZipEntry[]): string | null {
  const b = readZipEntry(buf, name, { entries });
  return b ? b.toString('utf8') : null;
}

interface Sheet { name: string; dimension: string | null }

/** Sheet names in workbook order, each with its used range when the file records one. */
export function workbookSheets(buf: Buffer): Sheet[] {
  const entries = listZipEntries(buf);
  const workbook = zipText(buf, 'xl/workbook.xml', entries);
  if (!workbook) throw new Error('no xl/workbook.xml');
  const rels = zipText(buf, 'xl/_rels/workbook.xml.rels', entries) ?? '';
  return parseWorkbookSheets(workbook, rels).map((s) => {
    const xml = s.part ? zipText(buf, s.part, entries) : null;
    return { name: s.name, dimension: xml ? sheetDimension(xml) : null };
  });
}

/** Visible text of a docx, pptx or xlsx (shared strings), for a {text} locator. */
function officeText(buf: Buffer, ext: string): string {
  const entries = listZipEntries(buf);
  const parts =
    ext === 'docx' ? ['word/document.xml']
    : ext === 'pptx' ? entries.map((e) => e.name).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    : ['xl/sharedStrings.xml'];
  return parts
    .map((p) => zipText(buf, p, entries) ?? '')
    .map((xml) => decodeXml(xml.replace(/<\/(w:p|a:p|si)>/g, '\n').replace(/<[^>]+>/g, '')))
    .join('\n');
}

function slideCount(buf: Buffer): number {
  return listZipEntries(buf).filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).length;
}

// ── Other formats ─────────────────────────────────────────────────────

/** Page count from the page tree, or null when it is inside a compressed object stream. */
export function pdfPageCount(buf: Buffer): number | null {
  const s = buf.toString('latin1');
  let best = 0;
  for (const m of s.matchAll(/<<(?:(?!<<|>>)[\s\S])*?\/Type\s*\/Pages\b(?:(?!<<|>>)[\s\S])*?>>/g)) {
    const count = m[0].match(/\/Count\s+(\d+)/);
    if (count) best = Math.max(best, Number(count[1]));
  }
  if (best > 0) return best;
  const pages = s.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return pages > 0 ? pages : null;
}

/** Duration in seconds from an mp4/mov `mvhd` box, or null. */
export function mp4DurationSeconds(buf: Buffer): number | null {
  const i = buf.indexOf('mvhd', 0, 'latin1');
  if (i < 0 || i + 32 > buf.length) return null;
  const version = buf[i + 4];
  const timescale = version === 1 ? buf.readUInt32BE(i + 24) : buf.readUInt32BE(i + 16);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(i + 28)) : buf.readUInt32BE(i + 20);
  return timescale > 0 ? duration / timescale : null;
}

// ── Cell references ───────────────────────────────────────────────────

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseCell(ref: string): { col: number; row: number } | null {
  const m = ref.replace(/\$/g, '').match(/^([A-Za-z]{1,3})(\d+)$/);
  return m ? { col: colNumber(m[1]), row: Number(m[2]) } : null;
}

function parseRange(ref: string): { from: { col: number; row: number }; to: { col: number; row: number } } | null {
  const [a, b] = ref.split(':');
  const from = parseCell(a ?? '');
  const to = b === undefined ? from : parseCell(b);
  return from && to ? { from, to } : null;
}

function rangeInside(range: string, dimension: string): boolean {
  const r = parseRange(range);
  const d = parseRange(dimension);
  if (!r || !d) return true; // cannot tell: not a failure
  return r.from.col >= d.from.col && r.from.row >= d.from.row && r.to.col <= d.to.col && r.to.row <= d.to.row;
}

// ── Locators ──────────────────────────────────────────────────────────

function toSeconds(t: unknown): number | null {
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  if (typeof t !== 'string') return null;
  const parts = t.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function toLineSpan(lines: unknown): { start: number; end: number } | null {
  if (typeof lines === 'number' && Number.isInteger(lines)) return { start: lines, end: lines };
  if (Array.isArray(lines) && lines.length === 2 && lines.every((n) => Number.isInteger(n))) {
    return { start: lines[0] as number, end: lines[1] as number };
  }
  if (typeof lines === 'string') {
    const m = lines.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (m) return { start: Number(m[1]), end: Number(m[2] ?? m[1]) };
  }
  return null;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Does the place a locator names exist in the file? `{sheet, range}`,
 * `{page}`, `{t}`, `{lines}`, `{text}` — each checked where the format
 * allows, and said to be unverified where it does not.
 */
export function checkLocator(root: string, a: Artefact, locator: unknown): CheckFinding[] {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) {
    return [fail(`The locator for ${a.path} must be an object such as {"sheet": "Regional", "range": "C14"}`, a.uid)];
  }
  const loc = locator as Record<string, unknown>;
  const ext = extOf(a.path);
  const read = readForCheck(root, a);
  if (!read.ok) return [read.finding];
  const buf = read.buf;
  const out: CheckFinding[] = [];
  const known = new Set(['sheet', 'range', 'page', 't', 'lines', 'text']);

  try {
    if ('sheet' in loc || 'range' in loc) {
      const sheet = typeof loc.sheet === 'string' ? loc.sheet : null;
      const range = typeof loc.range === 'string' ? loc.range.trim() : null;
      if (range !== null && !parseRange(range)) {
        out.push(fail(`"${range}" is not a cell or range — write it as C14 or A1:F20`, a.uid));
      } else if (ext === 'xlsx' || ext === 'xlsm') {
        const sheets = workbookSheets(buf);
        const target = sheet === null ? sheets[0] : sheets.find((s) => s.name === sheet);
        if (!target) {
          out.push(fail(`${a.path} has no sheet "${sheet}" — it has ${sheets.map((s) => `"${s.name}"`).join(', ') || 'none'}`, a.uid));
        } else if (range && target.dimension && !rangeInside(range, target.dimension)) {
          out.push(fail(`${target.name}!${range} is outside what ${a.path} has in that sheet (${target.dimension})`, a.uid));
        } else {
          out.push(pass(`${a.path} has ${range ? `${target.name}!${range}` : `a sheet "${target.name}"`}`, a.uid));
        }
      } else if (ext === 'csv') {
        const rows = buf.toString('utf8').split(/\r?\n/).filter((l, i, all) => l !== '' || i < all.length - 1);
        const cols = Math.max(0, ...rows.map((l) => l.split(',').length));
        const r = range ? parseRange(range) : null;
        if (r && (r.to.row > rows.length || r.to.col > cols)) {
          out.push(fail(`${range} is outside ${a.path}, which has ${rows.length} rows and ${cols} columns`, a.uid));
        } else {
          out.push(pass(`${a.path} has ${range ?? 'that sheet'}`, a.uid));
        }
      } else if (ext === 'xls') {
        out.push(unverified(`${a.path} is an old-format workbook; its sheets are not read yet`, a.uid));
      } else {
        out.push(fail(`A {sheet, range} locator points into a workbook; ${a.path} is a .${ext} file`, a.uid));
      }
    }

    if ('page' in loc) {
      const page = loc.page;
      if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
        out.push(fail(`page must be a whole number from 1 — got ${JSON.stringify(page)}`, a.uid));
      } else {
        const count = ext === 'pdf' ? pdfPageCount(buf) : ext === 'pptx' ? slideCount(buf) : undefined;
        if (count === undefined) {
          out.push(ext === 'docx'
            ? unverified(`${a.path} is a Word document; its pages depend on layout and are not checked`, a.uid)
            : fail(`A {page} locator points into a PDF or a deck; ${a.path} is a .${ext} file`, a.uid));
        } else if (count === null) {
          out.push(unverified(`The page count of ${a.path} could not be read`, a.uid));
        } else if (page > count) {
          out.push(fail(`${a.path} has ${count} ${ext === 'pptx' ? 'slides' : 'pages'}; ${page} is not one of them`, a.uid));
        } else {
          out.push(pass(`${a.path} has ${ext === 'pptx' ? 'slide' : 'page'} ${page}`, a.uid));
        }
      }
    }

    if ('t' in loc) {
      const t = toSeconds(loc.t);
      if (t === null || t < 0) {
        out.push(fail(`t must be seconds or mm:ss — got ${JSON.stringify(loc.t)}`, a.uid));
      } else if (ext === 'mp4' || ext === 'mov') {
        const d = mp4DurationSeconds(buf);
        if (d === null) out.push(unverified(`The length of ${a.path} could not be read`, a.uid));
        else if (t > d) out.push(fail(`${a.path} is ${Math.round(d)}s long; ${loc.t} is past the end`, a.uid));
        else out.push(pass(`${a.path} reaches ${loc.t}`, a.uid));
      } else if (ext === 'webm') {
        out.push(unverified(`The length of a .webm file is not read yet`, a.uid));
      } else {
        out.push(fail(`A {t} locator points into a video; ${a.path} is a .${ext} file`, a.uid));
      }
    }

    if ('lines' in loc) {
      const span = toLineSpan(loc.lines);
      if (!span || span.start < 1 || span.end < span.start) {
        out.push(fail(`lines must be a line number or a span such as "10-20" — got ${JSON.stringify(loc.lines)}`, a.uid));
      } else if (!TEXT_EXTS.has(ext)) {
        out.push(fail(`A {lines} locator points into a text file; ${a.path} is a .${ext} file`, a.uid));
      } else {
        const count = buf.toString('utf8').split(/\r?\n/).length;
        if (span.end > count) out.push(fail(`${a.path} has ${count} lines; ${span.end} is past the end`, a.uid));
        else out.push(pass(`${a.path} has lines ${span.start}${span.end !== span.start ? `–${span.end}` : ''}`, a.uid));
      }
    }

    if ('text' in loc) {
      const quote = typeof loc.text === 'string' ? squash(loc.text) : '';
      if (!quote) {
        out.push(fail(`text must be the words being cited`, a.uid));
      } else {
        const body =
          TEXT_EXTS.has(ext) ? buf.toString('utf8')
          : ext === 'docx' || ext === 'pptx' || ext === 'xlsx' || ext === 'xlsm' ? officeText(buf, ext)
          : null;
        if (body === null) out.push(unverified(`Text is not read from .${ext} files yet, so the quote was not checked`, a.uid));
        else if (!squash(body).includes(quote)) out.push(fail(`${a.path} does not contain "${String(loc.text).slice(0, 80)}"`, a.uid));
        else out.push(pass(`${a.path} contains the quoted words`, a.uid));
      }
    }
  } catch (err) {
    out.push(unverified(`${a.path} could not be read as a .${ext} file (${(err as Error).message})`, a.uid));
  }

  const unknown = Object.keys(loc).filter((k) => !known.has(k));
  if (unknown.length) {
    out.push(unverified(`Locator keys ${unknown.join(', ')} are not ones CodeTrellis checks`, a.uid));
  }
  if (out.length === 0) out.push(fail(`The locator for ${a.path} names no place — use sheet/range, page, t, lines or text`, a.uid));
  return out;
}

// ── Test reports ──────────────────────────────────────────────────────

/** JUnit totals, summed over the top-level suites; null when it is not a JUnit report. */
export function junitCounts(xml: string): { tests: number; failures: number; errors: number } | null {
  const attr = (tag: string, name: string) => Number(tag.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1] ?? 0);
  const top = xml.match(/<testsuites\b[^>]*>/);
  if (top && /\btests="\d+"/.test(top[0])) {
    return { tests: attr(top[0], 'tests'), failures: attr(top[0], 'failures'), errors: attr(top[0], 'errors') };
  }
  const suites = [...xml.matchAll(/<testsuite\b[^>]*>/g)].map((m) => m[0]);
  if (suites.length === 0) return null;
  return suites.reduce(
    (acc, s) => ({ tests: acc.tests + attr(s, 'tests'), failures: acc.failures + attr(s, 'failures'), errors: acc.errors + attr(s, 'errors') }),
    { tests: 0, failures: 0, errors: 0 },
  );
}

// ── The checks, by kind ───────────────────────────────────────────────

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

export function runChecks(ctx: CheckContext): CriterionCheck {
  const findings: CheckFinding[] = [];
  const { root } = ctx;
  const kind = ctx.criterion.kind;

  // Every piece of evidence offered must be a file this item recorded, and
  // still be there — for every kind but a person's judgement.
  const offered = ctx.evidence.filter((e) => e.attachmentUid);
  if (kind !== 'manual') {
    for (const e of offered) {
      if (!e.artefact) {
        findings.push(fail(
          `Attachment ${e.attachmentUid} is not a file recorded on this item — record it with record_artefact first`,
          e.attachmentUid,
        ));
      } else if (!e.artefact.sha256) {
        findings.push(fail(`${e.artefact.path} is no longer in the project`, e.artefact.uid));
      }
    }
  }

  if (!root && kind !== 'manual') {
    findings.push(unverified('This item\'s project is not open in CodeTrellis, so its files could not be checked'));
    return finish(ctx, findings);
  }

  const files = (roles: Artefact['role'][]) => {
    const fromEvidence = offered.map((e) => e.artefact).filter((a): a is Artefact => !!a && !!a.sha256 && roles.includes(a.role));
    return fromEvidence.length || offered.length ? fromEvidence : ctx.itemArtefacts.filter((a) => a.sha256 && roles.includes(a.role));
  };

  switch (kind) {
    case 'manual':
      findings.push(pass('Nothing mechanical to check — this is a person\'s judgement'));
      break;

    case 'artefact': {
      const outputs = files(['output', 'evidence']);
      if (outputs.length === 0) {
        findings.push(fail('No output file is recorded for this item — record_artefact(path, role: "output") the file the work produced'));
      }
      for (const a of outputs) {
        if (a.mtime !== null && a.mtime < ctx.itemStartedAt) {
          findings.push(fail(`${a.path} was last changed ${when(a.mtime)}, before this item started (${when(ctx.itemStartedAt)}) — it is not this work's output`, a.uid));
        } else {
          findings.push(pass(`${a.path} is in the project and changed since the item started`, a.uid));
        }
      }
      break;
    }

    case 'citation': {
      const cited = ctx.evidence.filter((e) => e.artefact?.role === 'material');
      if (cited.length === 0) {
        findings.push(fail('Cite the material this rests on: attach it as role "material" and give a locator — {sheet, range}, {page}, {lines}, {text} or {t}'));
      }
      for (const e of cited) {
        if (e.locator === null || e.locator === undefined) {
          findings.push(fail(`Citing ${e.artefact!.path} needs a locator saying where in it`, e.artefact!.uid));
        }
      }
      break;
    }

    case 'test': {
      const reports = files(['evidence', 'output']);
      if (reports.length === 0) {
        findings.push(fail('Attach the test report as evidence (a JUnit .xml, or the run\'s log)'));
      }
      for (const a of reports) {
        if (ctx.lastTargetChangeAt !== null && a.mtime !== null && a.mtime < ctx.lastTargetChangeAt) {
          findings.push(fail(`${a.path} is older than the last change to this item's files (${when(ctx.lastTargetChangeAt)}) — run the tests again`, a.uid));
          continue;
        }
        const read = readForCheck(root!, a);
        if (!read.ok) { findings.push(read.finding); continue; }
        const counts = /\.xml$/i.test(a.path) ? junitCounts(read.buf.toString('utf8')) : null;
        if (!counts) {
          findings.push(unverified(`${a.path} is not a JUnit report, so its pass and fail counts were not read`, a.uid));
        } else if (counts.failures + counts.errors > 0) {
          findings.push(fail(`${a.path} reports ${counts.failures + counts.errors} of ${counts.tests} tests failing`, a.uid));
        } else if (counts.tests === 0) {
          findings.push(fail(`${a.path} reports no tests run`, a.uid));
        } else {
          findings.push(pass(`${a.path}: ${counts.tests} tests, none failing`, a.uid));
        }
      }
      break;
    }

    case 'code': {
      const code = ctx.code;
      if (!code) break;
      if ('unavailable' in code) findings.push(unverified(`The item's changes could not be reviewed: ${code.unavailable}`));
      else if (code.verdict === 'landed') findings.push(pass('Every file this item names has changed'));
      else if (code.verdict === 'no-targets') findings.push(unverified('This item names no files, so its changes cannot be checked'));
      else if (code.verdict === 'untouched') findings.push(fail(`None of this item's files have changed yet: ${code.missing.join(', ')}`));
      else findings.push(fail(`Not changed yet: ${code.missing.join(', ')}`));
      break;
    }
  }

  // Any locator offered is checked, whatever the kind: a citation to a
  // sheet that does not exist is wrong on any criterion.
  for (const e of ctx.evidence) {
    if (e.artefact && e.artefact.sha256 && e.locator !== null && e.locator !== undefined) {
      findings.push(...checkLocator(root!, e.artefact, e.locator));
    }
  }

  return finish(ctx, findings);
}

function finish(ctx: CheckContext, findings: CheckFinding[]): CriterionCheck {
  return {
    criterionUid: ctx.criterion.uid,
    itemUid: ctx.criterion.itemUid,
    ok: !findings.some((f) => f.status === 'fail'),
    findings,
  };
}
