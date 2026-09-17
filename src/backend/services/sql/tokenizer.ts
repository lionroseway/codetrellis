/**
 * A small SQL tokenizer — Phase 21.
 *
 * See [docs/PHASE-21-SQL-REF-TRACKER.md](../../../../docs/PHASE-21-SQL-REF-TRACKER.md).
 *
 * ## Why a tokenizer and not a SQL parser
 *
 * Both jobs this phase needs — pulling table definitions out of DDL, and
 * pulling table *references* out of SQL embedded in application code —
 * are answered at the token level. The cases where naive regex gets
 * things wrong are all lexical:
 *
 *   -- SELECT * FROM ghost_table     ← a comment
 *   SELECT 'from fake_table' AS s    ← a string literal
 *   WITH recent AS (…) SELECT … FROM recent   ← a CTE, not a table
 *
 * A tokenizer that understands comments, string literals and quoted
 * identifiers removes the first two outright, and the third is a
 * keyword-tracking problem, not a grammar problem.
 *
 * Meanwhile a real parser is actively worse for the ref-tracker half,
 * because embedded SQL is rarely a complete statement:
 *
 *   "SELECT * FROM orders WHERE id = ?"        driver placeholder
 *   "INSERT INTO orders VALUES (%s, %s)"       psycopg2 style
 *   `SELECT * FROM orders WHERE id = ${id}`    template interpolation
 *   "SELECT * FROM orders WHERE "              a fragment, concatenated later
 *
 * Measured during design: `sql-parser-cst` rejects the last three even
 * with `paramTypes` configured. A tokenizer does not care — it never has
 * to accept a grammar, so a fragment degrades to "fewer tokens", not to
 * an exception.
 *
 * Python's `sqlglot` handles every one of those cases and is the better
 * library in the abstract, but it would mean shipping a Python runtime
 * inside an Electron app on five platform targets. That cost is not
 * repayable by a table-name extractor. See the phase doc for the full
 * comparison.
 *
 * ## What this deliberately does not do
 *
 * Resolve expressions, validate syntax, or understand dialect
 * semantics. It reads SQL the way a careful skim does.
 */

export type TokenType =
  /** A bare word: keyword, identifier, or function name. */
  | 'word'
  /** A quoted identifier — "orders", `orders`, [orders]. */
  | 'quoted'
  /** A string literal. Its content is never interpreted. */
  | 'string'
  /** A numeric literal. */
  | 'number'
  /** A bind parameter or host-language interpolation. */
  | 'param'
  /** Any single punctuation character: ( ) , . ; * = etc. */
  | 'punct';

export interface Token {
  type: TokenType;
  /** For `quoted`, the unquoted text. For `string`, the raw body. */
  value: string;
  /** Byte offset of the token's first character. */
  start: number;
  /** 1-indexed line of the token's first character. */
  line: number;
}

const QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  '`': '`',
  '[': ']',
};

function isWordStart(ch: string): boolean {
  return /[A-Za-z_#]/.test(ch);
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$#]/.test(ch);
}

/**
 * Tokenize a SQL string. Never throws: malformed or truncated input
 * yields whatever tokens could be read, which is the entire point —
 * embedded SQL is frequently a fragment.
 */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const len = sql.length;
  let i = 0;
  let line = 1;

  const push = (type: TokenType, value: string, start: number): void => {
    tokens.push({ type, value, start, line });
  };

  while (i < len) {
    const ch = sql[i];

    // Newline bookkeeping.
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }

    // Line comment — `-- …` and MySQL's `# …`.
    if ((ch === '-' && sql[i + 1] === '-') || ch === '#') {
      while (i < len && sql[i] !== '\n') i++;
      continue;
    }

    // Block comment. Not nested — no mainstream dialect nests them in a
    // way that matters here, and an unterminated one runs to the end,
    // which is the right reading of a truncated fragment.
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    // Dollar-quoted string — Postgres `$$ … $$` / `$tag$ … $tag$`.
    // Checked before bare `$n` parameters so a body containing `$1`
    // is not mistaken for one.
    if (ch === '$') {
      const tagMatch = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const start = i;
        const end = sql.indexOf(tag, i + tag.length);
        const bodyEnd = end === -1 ? len : end;
        const body = sql.slice(i + tag.length, bodyEnd);
        line += (body.match(/\n/g) || []).length;
        push('string', body, start);
        i = end === -1 ? len : end + tag.length;
        continue;
      }
    }

    // Single-quoted string. Doubled quotes escape, and so does a
    // backslash in MySQL — accepting both is harmless here because the
    // body is never interpreted.
    if (ch === "'") {
      const start = i;
      i++;
      let body = '';
      while (i < len) {
        if (sql[i] === '\\' && i + 1 < len) {
          body += sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            body += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (sql[i] === '\n') line++;
        body += sql[i];
        i++;
      }
      push('string', body, start);
      continue;
    }

    // Quoted identifier.
    if (QUOTE_PAIRS[ch]) {
      const closer = QUOTE_PAIRS[ch];
      const start = i;
      i++;
      let body = '';
      while (i < len) {
        if (sql[i] === closer) {
          // A doubled closer is an escaped one ("" inside "…").
          if (sql[i + 1] === closer) {
            body += closer;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (sql[i] === '\n') line++;
        body += sql[i];
        i++;
      }
      push('quoted', body, start);
      continue;
    }

    // Host-language interpolation: `${…}` (JS template), `#{…}` (MyBatis),
    // `%(name)s` / `%s` (Python). Collapsed to one opaque param token so
    // the surrounding SQL still reads correctly.
    if ((ch === '$' || ch === '#') && sql[i + 1] === '{') {
      const start = i;
      const close = sql.indexOf('}', i + 2);
      i = close === -1 ? len : close + 1;
      push('param', sql.slice(start, i), start);
      continue;
    }
    if (ch === '%') {
      const m = /^%(\([^)]*\))?[sdfrv]/.exec(sql.slice(i));
      if (m) {
        push('param', m[0], i);
        i += m[0].length;
        continue;
      }
    }

    // Driver placeholders: `?`, `?1`, `$1`, `:name`, `@name`.
    if (ch === '?') {
      const m = /^\?\d*/.exec(sql.slice(i))!;
      push('param', m[0], i);
      i += m[0].length;
      continue;
    }
    if (ch === '$' && /\d/.test(sql[i + 1] ?? '')) {
      const m = /^\$\d+/.exec(sql.slice(i))!;
      push('param', m[0], i);
      i += m[0].length;
      continue;
    }
    if ((ch === ':' || ch === '@') && isWordStart(sql[i + 1] ?? '')) {
      const m = new RegExp(`^\\${ch}\\w+`).exec(sql.slice(i))!;
      push('param', m[0], i);
      i += m[0].length;
      continue;
    }

    if (/\d/.test(ch)) {
      const m = /^\d+(\.\d+)?/.exec(sql.slice(i))!;
      push('number', m[0], i);
      i += m[0].length;
      continue;
    }

    if (isWordStart(ch)) {
      const start = i;
      while (i < len && isWordChar(sql[i])) i++;
      push('word', sql.slice(start, i), start);
      continue;
    }

    push('punct', ch, i);
    i++;
  }

  return tokens;
}

/** Case-insensitive keyword test against a `word` token. */
export function isWord(token: Token | undefined, ...words: string[]): boolean {
  if (!token || token.type !== 'word') return false;
  const v = token.value.toUpperCase();
  return words.some((w) => w.toUpperCase() === v);
}

/** True for a token that can name a table — bare or quoted. */
export function isNameToken(token: Token | undefined): token is Token {
  return !!token && (token.type === 'word' || token.type === 'quoted');
}
