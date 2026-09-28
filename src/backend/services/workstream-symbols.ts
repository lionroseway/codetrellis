/**
 * Which symbols a workstream's changes touch (Phase 32 A1.5).
 *
 * For each changed file, the version in the workstream's folder is compared
 * with the version at its merge base: symbols added, removed, and modified.
 * Modified means the symbol's own source text changed — enough to say "both
 * workstreams are editing `refreshToken`", which is what a collision is
 * (A1.6). Whether its *signature* changed is A2's, and needs the parsers to
 * extract signatures first.
 *
 * Nothing here is written to the graph tables: the opened project's graph is
 * the base, and a workstream is a small delta on top of it (spec §4.2). Only
 * the changed files are parsed.
 *
 * The current version is read through `confined-fs` with the workstream's
 * folder as the root, so a symlink out of it is refused rather than
 * followed. The base version comes from `git show <sha>:<path>`, with the
 * sha checked and the path refused if git could read it as an option.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ChangedFile, ParsedSymbol, SymbolChange, WorkstreamChanges } from '../../shared/types';
import { readTextWithin } from './confined-fs';
import { assertSafeGitPathArg } from './git-safety';

/** Files larger than this are not parsed: a footprint is a summary. */
export const MAX_PARSE_BYTES = 1_000_000;
/** At most this many files per workstream are parsed; the rest keep their path only. */
export const MAX_PARSED_FILES = 200;

/** Parse a file's source into symbols, or null when its language is unsupported. */
export type SymbolParser = (filePath: string, content: string) => ParsedSymbol[] | null;

interface FlatSymbol {
  name: string;
  kind: ParsedSymbol['kind'];
  line: number;
  /** Hash of the symbol's own source lines (its members' excluded), trailing whitespace ignored. */
  body: string;
}

/** Already qualified by the language (`(Ledger).Post`, `Invoice#post`, `A.b`). */
const QUALIFIED = /[.#)]/;

/**
 * Every symbol, members included, under a name that is unique in its file.
 * Pure. Members a parser nests are qualified with their parent, the way
 * languages that emit flat lists already name them.
 */
export function flatSymbols(symbols: ParsedSymbol[], source: string): FlatSymbol[] {
  const lines = source.split('\n');
  const all: Array<{ name: string; kind: ParsedSymbol['kind']; start: number; end: number }> = [];
  const visit = (list: ParsedSymbol[], parent: string | null) => {
    for (const s of list) {
      const name = parent && !QUALIFIED.test(s.name) ? `${parent}.${s.name}` : s.name;
      all.push({ name, kind: s.kind, start: s.startLine, end: s.endLine });
      if (s.children.length) visit(s.children, name);
    }
  };
  visit(symbols, null);

  return all.map((s) => {
    // Its OWN text: lines belonging to a symbol nested inside it are left
    // out, whether the parser nests members as children (TS, Python) or
    // lists them flat with qualified names (Java, Ruby). So a class is not
    // "modified" every time one of its methods is — two workstreams editing
    // different methods of one class are not editing the same thing.
    const inner = all.filter((o) => o !== s && o.start >= s.start && o.end <= s.end && (o.start > s.start || o.end < s.end));
    const own: string[] = [];
    for (let n = s.start; n <= s.end; n++) {
      if (inner.some((o) => n >= o.start && n <= o.end)) continue;
      own.push((lines[n - 1] ?? '').trimEnd());
    }
    return { name: s.name, kind: s.kind, line: s.start, body: createHash('sha1').update(own.join('\n')).digest('hex') };
  });
}

/**
 * What changed between two versions of a file's symbols. Pure. Either side
 * may be null: an added file has no base, a deleted one no current version.
 * Sorted by where the symbol is (current line, or base line when removed).
 */
export function diffSymbols(before: FlatSymbol[] | null, after: FlatSymbol[] | null): SymbolChange[] {
  const key = (s: FlatSymbol) => `${s.kind}\0${s.name}`;
  const old = new Map((before ?? []).map((s) => [key(s), s]));
  const now = new Map((after ?? []).map((s) => [key(s), s]));
  const changes: SymbolChange[] = [];
  for (const [k, s] of now) {
    const was = old.get(k);
    if (!was) changes.push({ name: s.name, kind: s.kind, change: 'added', line: s.line });
    else if (was.body !== s.body) changes.push({ name: s.name, kind: s.kind, change: 'modified', line: s.line });
  }
  for (const [k, s] of old) {
    if (!now.has(k)) changes.push({ name: s.name, kind: s.kind, change: 'removed', line: s.line });
  }
  return changes.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
}

const SHA = /^[0-9a-f]{40}$/;

/** The file's content at `base`, or null when it did not exist there. */
function baseContent(folder: string, base: string, relPath: string): string | null {
  if (!SHA.test(base)) return null;
  assertSafeGitPathArg(relPath, 'workstream base file');
  try {
    return execFileSync('git', ['-C', folder, 'show', `${base}:${relPath}`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      maxBuffer: MAX_PARSE_BYTES * 2,
    });
  } catch {
    return null;
  }
}

/** The file's content in the folder, or null (gone, too big, or outside it). */
function currentContent(folder: string, relPath: string): string | null {
  try {
    const abs = path.join(folder, relPath);
    if (fs.statSync(abs).size > MAX_PARSE_BYTES) return null;
    return readTextWithin(folder, relPath, 'workstream file');
  } catch {
    return null;
  }
}

/**
 * The symbol changes in one changed file, or undefined when its language is
 * not parsed (a README, a lockfile) — "no symbols" and "not a language we
 * read" are different answers.
 */
export function fileSymbolChanges(folder: string, base: string | null, file: ChangedFile, parse: SymbolParser): SymbolChange[] | undefined {
  const abs = path.join(folder, file.path);
  const after = file.status === 'deleted' ? null : currentContent(folder, file.path);
  const beforePath = file.status === 'renamed' && file.from ? file.from : file.path;
  const before = file.status === 'added' || !base ? null : baseContent(folder, base, beforePath);
  if (after === null && before === null) return undefined;

  const afterSyms = after === null ? null : parse(abs, after);
  const beforeSyms = before === null ? null : parse(path.join(folder, beforePath), before);
  if (afterSyms === null && beforeSyms === null) return undefined;
  return diffSymbols(
    beforeSyms && before !== null ? flatSymbols(beforeSyms, before) : null,
    afterSyms && after !== null ? flatSymbols(afterSyms, after) : null,
  );
}

// ── Cache ────────────────────────────────────────────────────────────────

const MAX_CACHED = 5_000;

/** Parsed answers, keyed by folder and path, valid while base, size and times hold. */
const cache = new Map<string, { stamp: string; symbols: SymbolChange[] | undefined }>();

function stampOf(folder: string, base: string | null, file: ChangedFile): string {
  let st = 'gone';
  try {
    const s = fs.statSync(path.join(folder, file.path));
    st = `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  } catch { /* deleted */ }
  return `${base}|${file.status}|${file.from ?? ''}|${st}`;
}

/**
 * The changes with each parseable file's symbol changes attached. Cached per
 * file, so a listing that repeats every few seconds parses only what moved.
 */
export function withSymbolChanges(folder: string, changes: WorkstreamChanges, parse: SymbolParser): WorkstreamChanges {
  const files = changes.files.map((f, i) => {
    if (i >= MAX_PARSED_FILES) return f;
    const k = `${folder}\0${f.path}`;
    const stamp = stampOf(folder, changes.base, f);
    let hit = cache.get(k);
    if (!hit || hit.stamp !== stamp) {
      let symbols: SymbolChange[] | undefined;
      try {
        symbols = fileSymbolChanges(folder, changes.base, f, parse);
      } catch {
        symbols = undefined;
      }
      hit = { stamp, symbols };
      if (cache.size > MAX_CACHED) cache.clear(); // crude, and enough: answers are cheap to rebuild
      cache.set(k, hit);
    }
    return hit.symbols === undefined ? f : { ...f, symbols: hit.symbols };
  });
  return { ...changes, files };
}

/** Forget every parsed answer. For tests. */
export function clearSymbolCache(): void {
  cache.clear();
}
