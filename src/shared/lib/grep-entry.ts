/**
 * Phase 33 B2 — what a grep rule reads in a file.
 *
 * A grep rule needs no parser, so it holds for every language and every kind
 * of file. Each file gives entries the way an import gives an edge:
 *
 * - `grep:<key>:+<line>` for each line that holds a `mustNot` pattern, the
 *   line's own text (trimmed, at most 200 characters);
 * - `grep:<key>:-<pattern>` once, for a file that never holds a `must`
 *   pattern.
 *
 * The key is the rule's terms (pattern, matcher, case, must or must not), not
 * its id, so a rule changed on a branch is never judged by the other's
 * entries. An entry is the line's text, not its number, so an edit above a
 * line moves it without making it new: the gate reports only the lines a
 * change adds, and an old line in an edited file is not blamed on the edit.
 */
import { lineMatches, type TargetMatch } from './matcher';
import { DEFAULT_THRESHOLD } from './fuzzy';

export interface GrepTerms {
  mayNotImport: string;
  match?: TargetMatch;
  must?: boolean;
  ignoreCase?: boolean;
  /** B3: how alike a word must be, for `match: fuzzy`. */
  threshold?: number;
}

const MAX_TEXT = 200;
/** A file is read for grep rules when it is text: no NUL in its first 8000 characters. */
const BINARY_PROBE = 8000;

/** FNV-1a, 32 bits: a short, stable key for a rule's terms. Pure, so the window and the backend agree. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The key a grep rule's entries carry. */
export function grepKey(t: GrepTerms): string {
  // B3: a fuzzy rule's threshold is part of what it matches; an exact one's key is as it was.
  return fnv(JSON.stringify([t.must ? 'must' : 'mustNot', t.match ?? 'exact', t.ignoreCase ? 'i' : '', t.mayNotImport, ...(t.match === 'fuzzy' ? [t.threshold ?? DEFAULT_THRESHOLD] : [])]));
}

export const isGrepEntry = (e: string): boolean => /^grep:[0-9a-f]{8}:[+-]/.test(e);

/** An entry's parts: whose, whether it is a line found or a pattern missed, and the text. */
export function splitGrep(e: string): { key: string; found: boolean; text: string } | null {
  if (!isGrepEntry(e)) return null;
  return { key: e.slice(5, 13), found: e[14] === '+', text: e.slice(15) };
}

/** What a file gives a grep rule: its lines that hold a `mustNot` pattern, or, when it never holds a `must` one, that. */
export function grepEntries(t: GrepTerms, text: string): string[] {
  if (text.slice(0, BINARY_PROBE).includes('\u0000')) return [];
  const key = grepKey(t);
  const hits: string[] = [];
  for (const line of text.split('\n')) {
    if (!lineMatches(t.match ?? null, t.mayNotImport, line, t.ignoreCase, t.threshold)) continue;
    if (t.must) return [];
    hits.push(`grep:${key}:+${line.trim().slice(0, MAX_TEXT)}`);
  }
  return t.must ? [`grep:${key}:-${t.mayNotImport}`] : [...new Set(hits)];
}

/** The pattern as a rule says it: “requireAuth”, a line like “TODO*”, a line matching /console\.log/. */
export function grepPatternWords(t: Pick<GrepTerms, 'mayNotImport' | 'match' | 'ignoreCase' | 'threshold'>): string {
  const said = t.match === 'regex' ? `a line matching /${t.mayNotImport}/`
    : t.match === 'glob' ? `a line like “${t.mayNotImport}”`
      : t.match === 'fuzzy' ? `a word like “${t.mayNotImport}” (${(t.threshold ?? DEFAULT_THRESHOLD).toFixed(2)} or closer) but not it`
        : `“${t.mayNotImport}”`;
  return `${said}${t.ignoreCase ? ' (in any case)' : ''}`;
}

/** What the file does, in a finding's words: “contains “console.log(x)”” or “never contains “requireAuth””. */
export function grepWords(e: string): string {
  const g = splitGrep(e);
  if (!g) return e;
  return g.found ? `contains “${g.text}”` : `never contains “${g.text}”`;
}

/** The line a grep entry is about, 1-based: the line with its text, or for a pattern a file never holds, the first. */
export function grepLine(text: string, e: string): number | null {
  const g = splitGrep(e);
  if (!g) return null;
  if (!g.found) return text.length ? 1 : null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (lines[i].trim().slice(0, MAX_TEXT) === g.text) return i + 1;
  return null;
}
