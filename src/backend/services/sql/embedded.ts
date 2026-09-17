import type { Callsite } from '../../../shared/types';
import { extractTableRefs, looksLikeSql } from './refs';
import { sqlRefsToCallsites } from './index';

/**
 * Embedded-SQL extraction — Phase 21, the half that matters.
 *
 * Finds SQL inside application code and reports the tables it touches.
 *
 * ## Why this is one scanner and not five
 *
 * The per-language callsite extractors exist because HTTP routing looks
 * completely different in each framework. SQL does not: it is the same
 * language everywhere, and the only thing that varies by host language
 * is **how a string literal is written**. So this scans for string
 * literals across every quoting style the supported languages use, and
 * hands anything SQL-shaped to the shared tokenizer.
 *
 * The payoff is that Rust, PHP and Java get table references with no
 * per-language work at all, and a sixth language gets them for free.
 *
 * ## Known limitation, stated rather than hidden
 *
 * A SQL-shaped string inside a host-language *comment* is still
 * reported. Distinguishing them would mean parsing each host language's
 * comment syntax here, duplicating what tree-sitter already did. In
 * practice a commented query usually documents a real dependency, so the
 * failure mode is a mild over-report rather than a wrong answer.
 *
 * Dynamically assembled SQL (concatenation, query builders, ORMs) is out
 * of scope by design — see the phase doc. A literal fragment still
 * yields its tables, because the tokenizer does not require a complete
 * statement.
 */

interface StringLiteral {
  body: string;
  line: number;
}

/**
 * Every string literal in `content`, across the quoting styles used by
 * the languages this codebase parses:
 *
 *   "…"        all
 *   '…'        all
 *   `…`        Go raw strings, JS/TS template literals
 *   """…"""    Python, Java text blocks
 *   '''…'''    Python
 *
 * Multi-character delimiters are tried first so a triple-quote is never
 * read as an empty string followed by a quote.
 */
function scanStringLiterals(content: string): StringLiteral[] {
  const out: StringLiteral[] = [];
  const len = content.length;
  let i = 0;
  let line = 1;

  const openers: Array<{ open: string; close: string; raw: boolean }> = [
    { open: '"""', close: '"""', raw: true },
    { open: "'''", close: "'''", raw: true },
    { open: '`', close: '`', raw: true },
    { open: '"', close: '"', raw: false },
    { open: "'", close: "'", raw: false },
  ];

  while (i < len) {
    if (content[i] === '\n') {
      line++;
      i++;
      continue;
    }

    const opener = openers.find((o) => content.startsWith(o.open, i));
    if (!opener) {
      i++;
      continue;
    }

    const startLine = line;
    const bodyStart = i + opener.open.length;
    let j = bodyStart;
    let body = '';

    while (j < len) {
      // Escapes only apply to the interpolating forms; a Go raw string
      // and a Python triple-quote take a backslash literally.
      if (!opener.raw && content[j] === '\\' && j + 1 < len) {
        body += content[j + 1];
        j += 2;
        continue;
      }
      if (content.startsWith(opener.close, j)) break;
      if (content[j] === '\n') {
        line++;
        // A single-quote form does not span lines in any of these
        // languages — an unterminated one is a false opener, so stop.
        if (!opener.raw) {
          body = '';
          break;
        }
      }
      body += content[j];
      j++;
    }

    if (body) out.push({ body, line: startLine });
    i = j + opener.close.length;
  }

  return out;
}

/**
 * `sql_query` callsites for every SQL-shaped string literal in a source
 * file. Safe to call for any language.
 */
export function extractEmbeddedSql(content: string): Callsite[] {
  const out: Callsite[] = [];

  for (const literal of scanStringLiterals(content)) {
    if (!looksLikeSql(literal.body)) continue;

    const refs = extractTableRefs(literal.body);
    if (refs.length === 0) continue;

    out.push(...sqlRefsToCallsites(refs, 'embedded', literal.body, literal.line));
  }

  return dedupe(out);
}

/**
 * A file that runs the same query in three places has one dependency on
 * that table, not three.
 */
function dedupe(callsites: Callsite[]): Callsite[] {
  const seen = new Map<string, Callsite>();
  for (const cs of callsites) {
    const key = `${cs.urlPattern}:${cs.method}`;
    if (!seen.has(key)) seen.set(key, cs);
  }
  return [...seen.values()];
}
