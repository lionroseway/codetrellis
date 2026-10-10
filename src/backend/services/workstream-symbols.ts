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

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ChangedFile, ParsedSymbol, SymbolChange, WorkstreamChanges } from '../../shared/types';
import { readTextWithin } from './confined-fs';
import { assertSafeGitPathArg } from './git-safety';
import { gitAsync } from './git-env';

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
  /** Its shape, where the parser gives one (A2.1). */
  signature?: string;
  /** Importable from another file: it, or the top-level symbol it belongs to, is exported (A2.3). */
  exported?: true;
}

/**
 * The names a Python module lists in `__all__` (assigned or extended), from
 * its source. Pure; a best effort over string literals, which is how
 * `__all__` is written in practice.
 */
export function pythonAll(source: string): Set<string> {
  const out = new Set<string>();
  const decl = /^__all__\s*(?::[^=\n]*)?(?:\+)?=\s*[[(]([^\])]*)[\])]/gm;
  for (const m of source.matchAll(decl)) {
    for (const lit of m[1].matchAll(/(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g)) out.add(lit[2]);
  }
  return out;
}

/**
 * Whether a top-level symbol can be used from another file, by the
 * language's rule, or undefined where the language marks nothing (A2.3).
 * TS/JS: `export`. Python: no leading underscore, or listed in `__all__`.
 * The other eight (A2.7): Go, a capital initial (the parser's `exported`,
 * for a method too, which is listed flat); Rust, `pub`; Ruby and PHP, all
 * of them; Java, C#, Kotlin and Swift, anything not `private` (C#'s default
 * `internal` and Swift's are visible across the module, Java's package
 * default across the package).
 */
export function isExported(filePath: string, s: ParsedSymbol, pyAll: Set<string> | null): boolean | undefined {
  if (/\.py$/.test(filePath)) return !s.name.startsWith('_') || (pyAll?.has(s.name) ?? false);
  if (/\.[cm]?[jt]sx?$/.test(filePath)) return s.modifiers.includes('export');
  if (/\.go$/.test(filePath)) return s.modifiers.includes('exported');
  if (/\.rs$/.test(filePath)) return s.modifiers.includes('pub');
  if (/\.(rb|php)$/.test(filePath)) return true;
  // C#'s parser lists members flat (`Ledger.Post`), and they are private unless they say otherwise.
  if (/\.cs$/.test(filePath) && s.name.includes('.')) return CSHARP_VISIBLE.some((m) => s.modifiers.includes(m));
  if (/\.(java|cs|kts?|swift)$/.test(filePath)) return !isPrivate(s);
  return undefined;
}

const CSHARP_VISIBLE = ['public', 'internal', 'protected'];

const isPrivate = (s: ParsedSymbol) => s.modifiers.includes('private') || s.modifiers.includes('fileprivate');

/**
 * Whether a member is usable from another file when its type is (A2.7).
 * TS and Python keep A2.3's rule, the type's. C#'s members are private
 * unless they say otherwise; Java's, Kotlin's, Swift's and PHP's are
 * visible unless they say `private`.
 */
function memberExported(filePath: string, s: ParsedSymbol, typeExported: boolean | undefined): boolean | undefined {
  if (!typeExported) return typeExported;
  if (/\.cs$/.test(filePath)) return CSHARP_VISIBLE.some((m) => s.modifiers.includes(m));
  if (/\.(java|kts?|swift|php)$/.test(filePath)) return !isPrivate(s);
  return typeExported;
}

/** Already qualified by the language (`(Ledger).Post`, `Invoice#post`, `A.b`). */
const QUALIFIED = /[.#)]/;

/**
 * Every symbol, members included, under a name that is unique in its file.
 * Pure. Members a parser nests are qualified with their parent, the way
 * languages that emit flat lists already name them.
 */
export function flatSymbols(symbols: ParsedSymbol[], source: string, filePath = ''): FlatSymbol[] {
  const lines = source.split('\n');
  const pyAll = /\.py$/.test(filePath) ? pythonAll(source) : null;
  const all: Array<{ name: string; kind: ParsedSymbol['kind']; start: number; end: number; signature?: string; exported?: boolean }> = [];
  // A member is importable when the top-level symbol it belongs to is.
  const visit = (list: ParsedSymbol[], parent: string | null, exported: boolean | undefined) => {
    for (const s of list) {
      const name = parent && !QUALIFIED.test(s.name) ? `${parent}.${s.name}` : s.name;
      const mine = parent === null ? isExported(filePath, s, pyAll) : memberExported(filePath, s, exported);
      all.push({ name, kind: s.kind, start: s.startLine, end: s.endLine, signature: s.signature, exported: mine });
      if (s.children.length) visit(s.children, name, mine);
    }
  };
  visit(symbols, null, undefined);

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
    return {
      name: s.name, kind: s.kind, line: s.start, body: createHash('sha1').update(own.join('\n')).digest('hex'),
      ...(s.signature ? { signature: s.signature } : {}),
      ...(s.exported ? { exported: true as const } : {}),
    };
  });
}

/** `exported` when any version of a symbol is importable. */
const exportedOf = (...versions: FlatSymbol[]) => (versions.some((v) => v.exported) ? { exported: true as const } : {});

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
    if (!was) changes.push({ name: s.name, kind: s.kind, change: 'added', line: s.line, ...exportedOf(s) });
    else if (was.body !== s.body) {
      // Its shape changed as well as its text (A2.1): what callers see. Only
      // when both versions have one — a parser that gives none says nothing.
      const signature = was.signature && s.signature
        ? (was.signature !== s.signature ? { signature: { before: was.signature, after: s.signature } } : {})
        // Without both, whether its shape changed is not known (A2.7).
        : { signatureUnknown: true as const };
      // Importable in either version: un-exporting it breaks importers too.
      changes.push({ name: s.name, kind: s.kind, change: 'modified', line: s.line, ...signature, ...exportedOf(was, s) });
    }
  }
  for (const [k, s] of old) {
    if (!now.has(k)) changes.push({ name: s.name, kind: s.kind, change: 'removed', line: s.line, ...exportedOf(s) });
  }
  return changes.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
}

const SHA = /^[0-9a-f]{40}$/;

/** The file's content at `base`, or null when it did not exist there. */
export async function baseContent(folder: string, base: string, relPath: string): Promise<string | null> {
  if (!SHA.test(base)) return null;
  assertSafeGitPathArg(relPath, 'workstream base file');
  try {
    return await gitAsync(folder, ['show', `${base}:${relPath}`], { maxBuffer: MAX_PARSE_BYTES * 2 });
  } catch {
    return null;
  }
}

/** The file's content in the folder, or null (gone, too big, or outside it). */
export function currentContent(folder: string, relPath: string): string | null {
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
export async function fileSymbolChanges(
  folder: string,
  base: string | null,
  file: ChangedFile,
  parse: SymbolParser,
  readCurrent: (relPath: string) => string | null | Promise<string | null> = (rel) => currentContent(folder, rel),
): Promise<SymbolChange[] | undefined> {
  const abs = path.join(folder, file.path);
  const after = file.status === 'deleted' ? null : await readCurrent(file.path);
  const beforePath = file.status === 'renamed' && file.from ? file.from : file.path;
  const before = file.status === 'added' || !base ? null : await baseContent(folder, base, beforePath);
  if (after === null && before === null) return undefined;

  const afterSyms = after === null ? null : parse(abs, after);
  const beforeSyms = before === null ? null : parse(path.join(folder, beforePath), before);
  if (afterSyms === null && beforeSyms === null) return undefined;
  return diffSymbols(
    beforeSyms && before !== null ? flatSymbols(beforeSyms, before, beforePath) : null,
    afterSyms && after !== null ? flatSymbols(afterSyms, after, file.path) : null,
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
export async function withSymbolChanges(
  folder: string,
  changes: WorkstreamChanges,
  parse: SymbolParser,
  /**
   * For a branch with no working tree (A1.7a): read the current version at
   * this commit instead of from disk, and key the cache by it.
   */
  atCommit?: { head: string; read: (relPath: string) => Promise<string | null> },
): Promise<WorkstreamChanges> {
  // One file after another: each may ask git for its base version.
  const files: ChangedFile[] = [];
  for (const [i, f] of changes.files.entries()) files.push(await symbolsFor(i, f));
  return { ...changes, files };

  async function symbolsFor(i: number, f: ChangedFile): Promise<ChangedFile> {
    if (i >= MAX_PARSED_FILES) return f;
    const k = `${folder}\0${atCommit ? `@${atCommit.head}` : ''}\0${f.path}`;
    const stamp = atCommit ? `${changes.base}|${atCommit.head}|${f.status}|${f.from ?? ''}` : stampOf(folder, changes.base, f);
    let hit = cache.get(k);
    if (!hit || hit.stamp !== stamp) {
      let symbols: SymbolChange[] | undefined;
      try {
        symbols = await fileSymbolChanges(folder, changes.base, f, parse, atCommit?.read);
      } catch {
        symbols = undefined;
      }
      hit = { stamp, symbols };
      if (cache.size > MAX_CACHED) cache.clear(); // crude, and enough: answers are cheap to rebuild
      cache.set(k, hit);
      // Parsing runs here, in the backend's thread. A new file asks git for
      // nothing, so a batch of them would parse back to back with no request
      // answered between; let waiting requests in after each file parsed.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return hit.symbols === undefined ? f : { ...f, symbols: hit.symbols };
  }
}

/**
 * How many of these files a `withSymbolChanges` call would parse now: the
 * ones within MAX_PARSED_FILES not cached for their current version. A
 * listing uses it to keep its own parsing inside a budget (Phase 33 0.1).
 */
export function uncachedSymbolFiles(folder: string, changes: WorkstreamChanges, atCommit?: { head: string }): number {
  let n = 0;
  for (const [i, f] of changes.files.entries()) {
    if (i >= MAX_PARSED_FILES) break;
    const k = `${folder}\0${atCommit ? `@${atCommit.head}` : ''}\0${f.path}`;
    const stamp = atCommit ? `${changes.base}|${atCommit.head}|${f.status}|${f.from ?? ''}` : stampOf(folder, changes.base, f);
    if (cache.get(k)?.stamp !== stamp) n++;
  }
  return n;
}

/** Forget every parsed answer. For tests. */
export function clearSymbolCache(): void {
  cache.clear();
}
