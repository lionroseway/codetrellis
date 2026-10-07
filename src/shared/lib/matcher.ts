/**
 * Phase 33 B1 — how a rule recognises its target.
 *
 * A package, symbol or call rule names its target exactly, as it always has:
 * `npm:stripe` (and what is under it), `src/db.ts#raw`, `http:api.stripe.com`.
 * A matcher says otherwise:
 *
 * - `glob`: `*` is any run of characters but `/`, `**` any run at all. Written
 *   with a `*` in the target, it needs no `match:` to say so:
 *   `http:*.stripe.com`, `sql:payments_*`, `npm:@aws-sdk/*`, `src/db.ts#raw*`.
 * - `regex`: a regular expression over the whole entry, anchored at both ends:
 *   `http:api\.(stripe|paypal)\.com(/.*)?`.
 *
 * - `fuzzy` (B3): like it, and not it, at or above a `threshold` (shared/lib/fuzzy.ts).
 *
 * Paths (`from`, `only`, `except`) are globs already.
 *
 * A rulebook is code a pull request can change, and the check runs in the app
 * and in CI, so a regex is held to what cannot run away: at most 200
 * characters, and no quantified group that itself repeats, the shape that
 * backtracks without end (`(a+)+`).
 */

import { DEFAULT_THRESHOLD, similarity, wordsOf } from './fuzzy';

export type MatchKind = 'glob' | 'regex';
/** How a rule's target is matched: by a pattern, or by likeness (B3). */
export type TargetMatch = MatchKind | 'fuzzy';
export const MATCH_KINDS: readonly TargetMatch[] = ['glob', 'regex', 'fuzzy'];

const MAX_PATTERN = 200;

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** A glob as a regex source: `**` any run, `*` any run but `/`. Not anchored. */
export function globSource(glob: string): string {
  return glob.split('**').map((part) => part.split('*').map(escapeRe).join('[^/]*')).join('.*');
}

/** A regex's source, or why it cannot be one. */
export function regexProblem(source: string): string | null {
  if (source.length > MAX_PATTERN) return `a regex is at most ${MAX_PATTERN} characters`;
  // A group that repeats and holds a repeat: (a+)+, (\w*)*, (x|y+){2,}.
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(source)) return 'a regex may not repeat a group that itself repeats, like (a+)+: it can run without end';
  try { new RegExp(source); } catch (err) { return `the regex does not compile: ${(err as Error).message}`; }
  return null;
}

const compiled = new Map<string, RegExp>();

/** Whether `text` is wholly matched by the glob or regex `pattern`. */
export function wholly(kind: MatchKind, pattern: string, text: string): boolean {
  const key = `${kind}\u0000${pattern}`;
  let re = compiled.get(key);
  if (!re) {
    re = new RegExp(`^(?:${kind === 'glob' ? globSource(pattern) : pattern})$`);
    if (compiled.size > 500) compiled.clear();
    compiled.set(key, re);
  }
  return re.test(text);
}

/** Whether `text` starts with a whole match of the pattern, followed by its end or a `/`. */
export function underPattern(kind: MatchKind, pattern: string, text: string): boolean {
  if (wholly(kind, pattern, text)) return true;
  for (let i = text.indexOf('/'); i >= 0; i = text.indexOf('/', i + 1)) {
    if (wholly(kind, pattern, text.slice(0, i))) return true;
  }
  return false;
}

/** The matcher a target is written with: what `match:` says, else `glob` for a `*`, else none (exact). */
export function matcherOf(match: unknown, value: string): TargetMatch | null | 'bad' {
  if (match === undefined || match === null || match === 'exact') return value.includes('*') ? 'glob' : null;
  return MATCH_KINDS.includes(match as TargetMatch) ? (match as TargetMatch) : 'bad';
}

/** Why a written threshold is not one, or null: a number above 0.5 and below 1. */
export function thresholdProblem(t: unknown): string | null {
  return typeof t === 'number' && t > 0.5 && t < 1 ? null : 'threshold is how alike, above 0.5 and below 1, like 0.85';
}

/** A rule's target written as `{ match, value, threshold }`, or as the value alone. */
export function splitTarget(v: unknown): { value: unknown; match: unknown; threshold?: unknown } {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) {
    const o = v as { value: unknown; match?: unknown; threshold?: unknown };
    return { value: o.value, match: o.match, ...(o.threshold !== undefined ? { threshold: o.threshold } : {}) };
  }
  return { value: v, match: undefined };
}

const lineCompiled = new Map<string, RegExp>();
const MAX_LINE = 2000;

/**
 * Whether a line of text holds the pattern anywhere in it (B2, grep rules).
 * Exact (`null`) is the text itself; a glob's `*` is any run of characters,
 * since a line has no folders; a regex is searched for, not anchored. A line
 * is read to its first 2000 characters, so a minified file costs no more than
 * a long line.
 */
export function lineMatches(kind: TargetMatch | null, pattern: string, line: string, ignoreCase = false, threshold = DEFAULT_THRESHOLD): boolean {
  const text = line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line;
  if (kind === null) return ignoreCase ? text.toLowerCase().includes(pattern.toLowerCase()) : text.includes(pattern);
  // B3: a word like the text, and not the text itself (fuzzy reads whole words, in any case).
  if (kind === 'fuzzy') return wordsOf(text).some((w) => w.toLowerCase() !== pattern.toLowerCase() && similarity(w, pattern) >= threshold);
  const key = `${kind}\u0000${ignoreCase ? 'i' : ''}\u0000${pattern}`;
  let re = lineCompiled.get(key);
  if (!re) {
    re = new RegExp(kind === 'glob' ? pattern.split('*').map(escapeRe).join('.*') : pattern, ignoreCase ? 'i' : '');
    if (lineCompiled.size > 500) lineCompiled.clear();
    lineCompiled.set(key, re);
  }
  return re.test(text);
}
