/**
 * Phase 33 B4 — a team's own patterns: what counts as a call, or as any entry
 * worth a rule, without code.
 *
 * The extractors in `callsites/<lang>.ts` turn source into call entries
 * (`http:host/path`, `sql:table`). A team's code reaches those through its
 * own clients too, and has kinds of its own (queues, events, flags). A
 * pattern says what to look for and what it is:
 *
 *     # .codetrellis/patterns/payments.yaml
 *     patterns:
 *       - id: payments-sdk
 *         find: { match: regex, value: "paymentsClient\\.(charge|refund)\\(" }
 *         is: http:api.stripe.com/v1/charges
 *       - id: orders-queue
 *         in: [services/]
 *         find: { match: regex, value: "publish\\(['\"]orders\\.(\\w+)" }
 *         is: queue:orders.$1
 *
 * - `find` is read line by line, as a grep rule's text is: literal, a glob,
 *   or a regex (B1's limits). `$1`…`$9` in `is` are the regex's groups.
 * - `is` is an entry: `http:` and `sql:` become callsites like any
 *   extractor's, normalised the same way (`callsites/shared.ts`), so call
 *   rules, the cross-system map and reviews read them unchanged; any other
 *   lowercase kind (`queue:`, `event:`, `flag:`) is an entry of the team's own,
 *   which call rules hold (`shared/lib/call-entry.ts`).
 * - `in` and `except` limit the files (every file when `in` is not said).
 * - `method` gives an HTTP entry its verb, so the cross-system map can pair it
 *   with a route; without one it is `ANY`.
 * - `side: sends` or `side: receives` says which end of a kind of its own this
 *   code is, so the cross-system map pairs each sender of `queue:orders.created`
 *   with each of its receivers, as a call pairs with its route (Phase 33
 *   follow-up). Without one, the entry is held by call rules and paired with
 *   nothing: which way it goes cannot be told.
 *
 * Patterns are found by the file: the nearest folder above it with a
 * `.codetrellis/patterns/`, read through the confined-file helper. So the
 * scan, the watcher, the gate and reviews read the same ones with nothing
 * passed in. Each callsite says which pattern found it (`pattern:<id>`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Callsite } from '../../shared/types';
import { inPattern } from './architecture-rule';
import { readTextWithin, resolveWithin } from './confined-fs';
import { call } from './callsites/shared';
import { callProblem, isOwnKind } from '../../shared/lib/call-entry';
import { regexProblem, splitTarget } from '../../shared/lib/matcher';

export const PATTERNS_DIR = '.codetrellis/patterns';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_PATTERNS = 200;
const MAX_FIND = 200;
const MAX_LINE = 2000;
const MAX_PER_FILE = 1000;
const RECHECK_MS = 2000;

export interface Pattern {
  id: string;
  /** The suite file it is in: `payments.yaml`. */
  file: string;
  in: string[];
  except: string[];
  find: { match: 'glob' | 'regex' | null; value: string };
  is: string;
  method?: string;
  /** Which end of a kind of its own this code is: it sends the entry, or receives it. */
  side?: 'sends' | 'receives';
}

export interface PatternBook { patterns: Pattern[]; problems: string[]; stamp: string }

const EMPTY: PatternBook = { patterns: [], problems: [], stamp: '' };

const list = (v: unknown): string[] | null => (v === undefined ? [] : typeof v === 'string' ? [v] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : null);
const relative = (p: string) => !p.startsWith('/') && !/^[a-zA-Z]:/.test(p) && !p.includes('\\') && !p.split('/').includes('..');

/** One pattern file's patterns, and why any were not read. Pure. */
export function parsePatterns(file: string, text: string): { patterns: Pattern[]; problems: string[] } {
  const problems: string[] = [];
  let raw: unknown;
  try { raw = parseYaml(text, { maxAliasCount: 0 }); } catch (err) { return { patterns: [], problems: [`${file}: not YAML (${(err as Error).message.split('\n')[0]})`] }; }
  const items = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).patterns : null;
  if (!Array.isArray(items)) return { patterns: [], problems: [`${file}: a pattern file holds patterns: a list`] };
  const patterns: Pattern[] = [];
  for (const item of items) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const why: string[] = [];
    const id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : null;
    if (!id) why.push('id must be a short slug, like payments-sdk');
    const within = list(r.in);
    const except = list(r.except);
    if (within === null || !within.every(relative)) why.push('in must be paths in the project, like services/');
    if (except === null || !except.every(relative)) why.push('except must be paths in the project');
    const { value, match } = splitTarget(r.find);
    const m = match ?? r.match;
    const kind = m === undefined || m === null || m === 'exact' ? null : m === 'glob' || m === 'regex' ? m : 'bad';
    if (kind === 'bad') why.push('find matches exact, glob or regex');
    if (typeof value !== 'string' || !value.trim()) why.push('find must be the text to look for, like paymentsClient.charge(');
    else if (value.length > MAX_FIND) why.push(`find is at most ${MAX_FIND} characters`);
    else if (kind === 'regex') { const p = regexProblem(value); if (p) why.push(p); }
    // `is` must be an entry once its groups are filled in.
    const is = typeof r.is === 'string' ? r.is.trim() : '';
    const shaped = is.replace(/\$[1-9]/g, 'x');
    if (!is) why.push('is must say what it is, like http:api.stripe.com/v1/charges or queue:orders.$1');
    else { const isWhy = callProblem(shaped); if (isWhy) why.push(`is: ${isWhy}`); }
    if (/\$[1-9]/.test(is) && kind !== 'regex') why.push('is may use $1 only when find is a regex');
    if (r.method !== undefined && (typeof r.method !== 'string' || !/^[A-Za-z]+$/.test(r.method))) why.push('method is an HTTP verb, like POST');
    if (r.side !== undefined) {
      if (r.side !== 'sends' && r.side !== 'receives') why.push('side is sends or receives: which end of the entry this code is');
      else if (is && !isOwnKind(shaped)) why.push('side is for a kind of your own, like queue:orders.$1; an HTTP call pairs with its route already');
    }
    if (why.length) { problems.push(`${file}: ${id ?? 'a pattern'}: ${why.join('; ')}`); continue; }
    if (patterns.length >= MAX_PATTERNS) { problems.push(`${file}: more than ${MAX_PATTERNS} patterns; the rest were not read`); break; }
    patterns.push({
      id: id!, file, in: within!, except: except!, find: { match: kind as 'glob' | 'regex' | null, value: value as string }, is,
      ...(typeof r.method === 'string' ? { method: r.method.toUpperCase() } : {}),
      ...(r.side === 'sends' || r.side === 'receives' ? { side: r.side } : {}),
    });
  }
  return { patterns, problems };
}

const books = new Map<string, { checked: number; book: PatternBook }>();

/** The project's patterns, from `.codetrellis/patterns/*.yaml`; re-read when a file there changes. */
export function readPatterns(projectRoot: string, now = Date.now()): PatternBook {
  const hit = books.get(projectRoot);
  if (hit && now - hit.checked < RECHECK_MS) return hit.book;
  let dir: string;
  let names: string[];
  try {
    if (!fs.existsSync(path.join(projectRoot, PATTERNS_DIR))) { books.set(projectRoot, { checked: now, book: EMPTY }); return EMPTY; }
    dir = resolveWithin(projectRoot, PATTERNS_DIR, 'patterns folder');
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.yaml')).map((e) => e.name).sort();
  } catch {
    books.set(projectRoot, { checked: now, book: EMPTY });
    return EMPTY;
  }
  const stamp = names.map((n) => { try { const s = fs.statSync(path.join(dir, n)); return `${n}:${s.size}:${s.mtimeMs}`; } catch { return n; } }).join('|');
  if (hit && hit.book.stamp === stamp) { books.set(projectRoot, { checked: now, book: hit.book }); return hit.book; }
  const patterns: Pattern[] = [];
  const problems: string[] = [];
  for (const name of names) {
    let text: string;
    try { text = readTextWithin(projectRoot, `${PATTERNS_DIR}/${name}`, 'pattern file'); } catch { problems.push(`${name}: could not be read`); continue; }
    const got = parsePatterns(name, text);
    const ids = new Set(patterns.map((p) => p.id));
    for (const p of got.patterns) {
      if (ids.has(p.id)) problems.push(`${name}: ${p.id} is already a pattern in ${patterns.find((x) => x.id === p.id)!.file}`);
      else patterns.push(p);
    }
    problems.push(...got.problems);
  }
  const book = { patterns, problems, stamp };
  books.set(projectRoot, { checked: now, book });
  return book;
}

const roots = new Map<string, string | null>();
let rootsSince = 0;
const ROOTS_MS = 5000;

/** The folder whose `.codetrellis/patterns/` a file is read by: the nearest above it, or null. */
export function patternRootOf(absFile: string, now = Date.now()): string | null {
  // A patterns folder made or taken away is seen within seconds.
  if (now - rootsSince > ROOTS_MS) { roots.clear(); rootsSince = now; }
  const start = path.dirname(path.resolve(absFile));
  const walked: string[] = [];
  let dir = start;
  let found: string | null | undefined;
  for (;;) {
    if (roots.has(dir)) { found = roots.get(dir); break; }
    walked.push(dir);
    if (fs.existsSync(path.join(dir, PATTERNS_DIR))) { found = dir; break; }
    const up = path.dirname(dir);
    if (up === dir) { found = null; break; }
    dir = up;
  }
  for (const d of walked) roots.set(d, found ?? null);
  if (roots.size > 20_000) roots.clear();
  return found ?? null;
}

/** Forget where patterns were found: a patterns folder was made or taken away. */
export function forgetPatternRoots(): void {
  roots.clear();
  books.clear();
}

const compiled = new Map<string, RegExp>();
function finder(p: Pattern): RegExp {
  const key = `${p.find.match}\u0000${p.find.value}`;
  let re = compiled.get(key);
  if (!re) {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const source = p.find.match === 'regex' ? p.find.value : p.find.match === 'glob' ? p.find.value.split('*').map(escape).join('.*?') : escape(p.find.value);
    re = new RegExp(source, 'g');
    if (compiled.size > 500) compiled.clear();
    compiled.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

/** What the entry is, for one match: `$1`… filled in with the regex's groups. */
const entryOf = (is: string, groups: readonly (string | undefined)[]): string =>
  is.replace(/\$([1-9])/g, (_, n: string) => groups[Number(n)] ?? '');

/** The callsite an entry makes, as an extractor would make it. */
function callsiteOf(p: Pattern, entry: string, line: number): Callsite | null {
  if (callProblem(entry)) return null; // a group filled in with something that is no name
  const context = `pattern:${p.id}`;
  if (entry.startsWith('http:')) {
    const rest = entry.slice(5);
    const url = rest.startsWith('/') ? rest : `https://${rest.includes('/') ? rest : `${rest}/`}`;
    return call(line, p.method ?? 'ANY', url, context);
  }
  if (entry.startsWith('sql:')) return { kind: 'sql_query', protocol: 'sql', line, method: 'READ', urlPattern: entry.slice(4).toLowerCase(), context };
  if (isOwnKind(entry)) return { kind: 'entry', protocol: 'entry', line, urlPattern: entry, context, ...(p.side ? { method: p.side === 'sends' ? 'SEND' : 'RECEIVE' } : {}) };
  return null;
}

/** What these patterns find in one file, by its path in the project. Pure given the patterns. */
export function patternCallsites(patterns: readonly Pattern[], relPath: string, content: string): Callsite[] {
  const reading = patterns.filter((p) => (p.in.length === 0 || p.in.some((x) => inPattern(x, relPath))) && !p.except.some((x) => inPattern(x, relPath)));
  if (reading.length === 0) return [];
  const out: Callsite[] = [];
  const seen = new Set<string>();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length && out.length < MAX_PER_FILE; i++) {
    const text = lines[i].length > MAX_LINE ? lines[i].slice(0, MAX_LINE) : lines[i];
    for (const p of reading) {
      for (const m of text.matchAll(finder(p))) {
        if (m[0] === '') break;
        const cs = callsiteOf(p, entryOf(p.is, m), i + 1);
        const key = cs ? `${cs.kind}|${cs.method}|${cs.host ?? ''}|${cs.urlPattern}|${cs.line}` : '';
        if (cs && !seen.has(key)) { seen.add(key); out.push(cs); }
      }
    }
  }
  return out;
}

/** What the patterns of the project a file is in find in it (the parser's hook). Never throws. */
export function patternCallsitesFor(absFile: string, content: string): Callsite[] {
  try {
    const root = patternRootOf(absFile);
    if (!root) return [];
    const { patterns } = readPatterns(root);
    if (patterns.length === 0) return [];
    return patternCallsites(patterns, path.relative(root, path.resolve(absFile)).split(path.sep).join('/'), content);
  } catch {
    return [];
  }
}

/** The patterns' identity for a project, for anything that caches what they find. */
export const patternStamp = (projectRoot: string): string => readPatterns(projectRoot).stamp;
