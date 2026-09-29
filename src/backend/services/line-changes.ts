/**
 * Line changes per workstream (Phase 32 B3.1).
 *
 * A workstream's change to a file is its copy against its merge base with
 * main, committed and not: `git diff -U0 <merge-base> -- <file>` in its
 * folder, or `<merge-base> <head>` for a branch with no folder. Each hunk
 * says which lines, whether they were added, changed or removed, the
 * functions they fall in, and whether any of it is not committed yet.
 *
 * It comes from git and the parser, never from an agent's report, so every
 * client gets the same answer. Another workstream's lines are git's output
 * about the repository, not another agent's words (awareness principle 5).
 *
 * The workstream comes from `listWorkstreams`, never a folder from a caller.
 * The copy is read through `confined-fs` with the workstream's folder as the
 * root before git is asked, so a file that is a link out of it is refused.
 * Git runs with `execFile`, `-C <folder>`, fixed arguments, full SHAs and a
 * path after `--` that `git-safety` has checked.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { LineHunk, ParsedSymbol, Workstream, WorkstreamLineChanges } from '../../shared/types';
import { readFileWithin, resolveWithin } from './confined-fs';
import { assertSafeGitPathArg } from './git-safety';
import { showAt } from './branch-workstreams';
import type { SymbolParser } from './workstream-symbols';

/** Past this, a file's lines are not read: "too large" instead. */
export const MAX_FILE_BYTES = 1_000_000;
/** The diff text, when asked for, is cut here. */
export const MAX_DIFF_CHARS = 20_000;

const SHA = /^[0-9a-f]{40}$/;
/** git's empty tree: the base of a branch that shares no history with main. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** A hunk header's numbers, as git gives them with `-U0`. */
export interface RawHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

/** The hunks of a unified diff, from its `@@ -a,b +c,d @@` headers. Pure. */
export function parseHunkHeaders(diff: string): RawHunk[] {
  const out: RawHunk[] = [];
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    out.push({
      oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]),
    });
  }
  return out;
}

/** git said the file is binary. Pure. */
export function isBinaryDiff(diff: string): boolean {
  return /^Binary files .* differ$/m.test(diff) || /^GIT binary patch$/m.test(diff);
}

/** Already qualified by the language (`(Ledger).Post`, `Invoice#post`, `A.b`). */
const QUALIFIED = /[.#)]/;

export interface SymbolRange {
  name: string;
  start: number;
  end: number;
}

/** Every symbol's lines, members qualified with their parent as the footprints name them. Pure. */
export function symbolRanges(symbols: readonly ParsedSymbol[]): SymbolRange[] {
  const out: SymbolRange[] = [];
  const visit = (list: readonly ParsedSymbol[], parent: string | null) => {
    for (const s of list) {
      const name = parent && !QUALIFIED.test(s.name) ? `${parent}.${s.name}` : s.name;
      out.push({ name, start: s.startLine, end: s.endLine });
      if (s.children.length) visit(s.children, name);
    }
  };
  visit(symbols, null);
  return out;
}

/**
 * The innermost symbols lines `start`–`end` fall in, in file order. Pure.
 * A class is named only for lines in it that are in none of its members, so
 * a change inside one method names the method and not also its class.
 */
export function functionsIn(ranges: readonly SymbolRange[], start: number, end: number): string[] {
  const hit = ranges.filter((r) => r.start <= end && r.end >= start);
  const inner = hit.filter((r) => !hit.some((o) => o !== r && o.start >= r.start && o.end <= r.end && (o.start > r.start || o.end < r.end)));
  return [...new Set(inner.sort((a, b) => a.start - b.start).map((r) => r.name))];
}

/** A hunk's lines in the new version; a removal sits between `start` and the line after it. */
function newSpan(h: RawHunk): [number, number] {
  return h.newLines > 0 ? [h.newStart, h.newStart + h.newLines - 1] : [h.newStart, h.newStart + 1];
}

/**
 * The hunks against the merge base, each placed in its functions and marked
 * committed or not. `uncommitted` is the working copy against HEAD (in the
 * same new-side lines): a hunk touching any of it is not committed. `'all'`
 * for a file git does not track yet, `'none'` for a branch with no folder.
 * Pure.
 */
export function toHunks(
  whole: readonly RawHunk[],
  uncommitted: readonly RawHunk[] | 'all' | 'none',
  placeNew: (start: number, end: number) => string[],
  placeOld: (start: number, end: number) => string[],
): LineHunk[] {
  return whole.map((h) => {
    const kind: LineHunk['kind'] = h.oldLines === 0 ? 'added' : h.newLines === 0 ? 'removed' : 'changed';
    const [a, b] = newSpan(h);
    const committed = uncommitted === 'all' ? false : uncommitted === 'none' ? true
      : !uncommitted.some((u) => { const [c, d] = newSpan(u); return c <= b && d >= a; });
    const functions = kind === 'removed'
      ? placeOld(h.oldStart, h.oldStart + h.oldLines - 1)
      : placeNew(h.newStart, h.newStart + h.newLines - 1);
    return { kind, old: { start: h.oldStart, lines: h.oldLines }, new: { start: h.newStart, lines: h.newLines }, functions, committed };
  });
}

/** Lines added and removed, as `--numstat` counts them. Pure. */
export function countLines(hunks: readonly LineHunk[]): { added: number; removed: number } {
  return hunks.reduce((n, h) => ({ added: n.added + h.new.lines, removed: n.removed + h.old.lines }), { added: 0, removed: 0 });
}

/**
 * A path relative to the repository root, or null when it is not one: no
 * absolute path, no `..`, nothing git could read as an option. Pure.
 */
export function cleanRelPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const p = raw.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (!p || p.length > 300 || p.includes('\0') || p.startsWith('/') || p.startsWith('-') || /^[A-Za-z]:/.test(p)) return null;
  if (p.split('/').some((seg) => seg === '..' || seg === '')) return null;
  return p;
}

function git(folder: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', folder, ...args], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

const DIFF = ['diff', '--no-color', '--no-ext-diff', '--no-renames'];

function placer(parse: SymbolParser | null, file: string, text: string | null): (s: number, e: number) => string[] {
  if (!parse || text === null) return () => [];
  let ranges: SymbolRange[] = [];
  try {
    ranges = symbolRanges(parse(file, text) ?? []);
  } catch { /* unparseable: no function names, still the lines */ }
  return (s, e) => functionsIn(ranges, s, e);
}

const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/**
 * One workstream's changed lines in one file. `repo` is the main checkout's
 * folder, where a branch with no folder is read. `rel` is already clean.
 */
export function lineChangesOf(
  w: Workstream,
  repo: string,
  rel: string,
  parse: SymbolParser | null,
  opts: { diff?: boolean } = {},
): WorkstreamLineChanges {
  assertSafeGitPathArg(rel, 'line changes');
  const out: WorkstreamLineChanges = { workstream: w.root, branch: w.branch, path: rel, status: 'unchanged', hunks: [], added: 0, removed: 0 };
  const base = w.changes?.base && SHA.test(w.changes.base) ? w.changes.base : EMPTY_TREE;
  const isBranch = w.root.startsWith('branch:');
  const folder = isBranch ? repo : w.root;

  // The two versions, for function names: its copy, and the base's.
  let current: string | null;
  let range: string[];
  let uncommitted: RawHunk[] | 'all' | 'none' = 'none';
  if (isBranch) {
    const head = w.head && SHA.test(w.head) ? w.head : null;
    if (!head) return out;
    current = showAt(repo, head, rel);
    range = [base, head];
  } else {
    let size = -1;
    try {
      const abs = resolveWithin(folder, rel, 'line changes');
      size = fs.existsSync(abs) ? fs.statSync(abs).size : -1;
    } catch {
      return { ...out, status: 'unreadable' };
    }
    if (size > MAX_FILE_BYTES) return { ...out, status: 'too-large' };
    try {
      const buf = size < 0 ? null : readFileWithin(folder, rel, 'line changes');
      if (buf && buf.includes(0)) return { ...out, status: 'binary' };
      current = buf ? buf.toString('utf-8') : null;
    } catch {
      return { ...out, status: 'unreadable' };
    }
    range = [base];
  }

  const baseText = base === EMPTY_TREE ? null : showAt(folder, base, rel);
  if ((baseText?.length ?? 0) > MAX_FILE_BYTES) return { ...out, status: 'too-large' };

  let whole = git(folder, [...DIFF, '-U0', ...range, '--', rel]) ?? '';
  if (isBinaryDiff(whole)) return { ...out, status: 'binary' };
  let hunks = parseHunkHeaders(whole);

  if (!isBranch) {
    // A file git does not track yet is all new, and none of it committed.
    const tracked = git(folder, ['ls-files', '--error-unmatch', '--', rel]) !== null;
    if (!tracked && current !== null) {
      const n = lineCount(current);
      hunks = baseText === null && n > 0 ? [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: n }] : hunks;
      uncommitted = 'all';
      whole = '';
    } else {
      uncommitted = parseHunkHeaders(git(folder, [...DIFF, '-U0', 'HEAD', '--', rel]) ?? '');
    }
  }
  if (!hunks.length) return out;

  const file = path.join(folder, rel);
  const lineHunks = toHunks(hunks, uncommitted, placer(parse, file, current), placer(parse, file, baseText));
  const counts = countLines(lineHunks);
  const result: WorkstreamLineChanges = { ...out, status: 'changed', hunks: lineHunks, ...counts };
  if (opts.diff) {
    const text = uncommitted === 'all' && current !== null
      ? `new file, not tracked by git yet\n${current.split('\n').map((l) => `+${l}`).join('\n')}`
      : git(folder, [...DIFF, '-U3', ...range, '--', rel]) ?? '';
    result.diff = text.slice(0, MAX_DIFF_CHARS);
    if (text.length > MAX_DIFF_CHARS) result.diffTruncated = true;
  }
  return result;
}

/**
 * The line changes in `rel` of the given workstreams: the one named (by id
 * or branch) even when it leaves the file alone, else every workstream whose
 * changed files list it.
 */
export function lineChangesFor(
  workstreams: readonly Workstream[],
  rel: string,
  parse: SymbolParser | null,
  opts: { workstream?: string | null; exclude?: (w: Workstream) => boolean; diff?: boolean } = {},
): WorkstreamLineChanges[] {
  const main = workstreams.find((w) => w.main);
  const repo = main?.root ?? workstreams.find((w) => !w.root.startsWith('branch:'))?.root;
  if (!repo) return [];
  const chosen = opts.workstream
    ? workstreams.filter((w) => w.root === opts.workstream || w.branch === opts.workstream).slice(0, 1)
    : workstreams.filter((w) => w.changes.files.some((f) => f.path === rel) && !opts.exclude?.(w));
  return chosen.map((w) => lineChangesOf(w, repo, rel, parse, { diff: opts.diff }));
}
