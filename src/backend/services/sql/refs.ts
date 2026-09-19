import { tokenize, isWord, isNameToken, type Token } from './tokenizer';

/**
 * Table-reference extraction — Phase 21, the ref-tracker half.
 *
 * Answers "which tables does this SQL touch, and does it read or write
 * them" for SQL found anywhere: a `.sql` file, or a string literal
 * lifted out of Go / Python / TypeScript / Java / PHP.
 *
 * Read vs write is the finding that makes this worth building. "Seven
 * services read `orders`, two write it" is a fact most teams cannot
 * state about their own system, and it falls straight out of the verb.
 *
 * Deliberate non-goals: correctness on every dialect's exotic syntax,
 * and any attempt to resolve dynamic SQL. When in doubt this reports
 * nothing rather than guessing — a wrong edge on an architecture graph
 * costs more than a missing one, because people act on it.
 */

export type TableOp = 'read' | 'write';

export interface TableRef {
  /** Bare table name, lower-cased for matching. */
  table: string;
  /** Name as written, for display. */
  raw: string;
  /** Schema qualifier when one was written (`billing.orders`). */
  schema: string | null;
  op: TableOp;
  /** The keyword that introduced it — FROM, JOIN, INSERT INTO, … */
  keyword: string;
  line: number;
}

/**
 * Words that end a table list. Anything here stops us consuming names,
 * which is what keeps `FROM orders WHERE …` from reading `WHERE` as a
 * second table.
 */
/**
 * What may legitimately follow a table reference in a FROM clause.
 *
 * Narrower than CLAUSE_END, which exists to end a name and therefore contains
 * conjunctions like AND/OR that never follow a table. That difference is what
 * separates `FROM orders o JOIN …` from "from the archive and send it": both
 * have a word then a CLAUSE_END word, but only one of them is SQL.
 */
const AFTER_TABLE = new Set([
  'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER',
  'NATURAL', 'LATERAL', 'ON', 'USING', 'GROUP', 'ORDER', 'HAVING', 'LIMIT',
  'OFFSET', 'FETCH', 'WINDOW', 'UNION', 'INTERSECT', 'EXCEPT', 'RETURNING',
  'FOR', 'SET', 'VALUES', 'INTO', 'FROM', 'FORCE', 'USE', 'IGNORE', 'FINAL',
  'FILTER', 'FIRST', 'FOLLOWING', 'FORMAT', 'OPTION', 'FORCESEEK',
]);

const CLAUSE_END = new Set([
  'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH', 'WINDOW',
  'UNION', 'INTERSECT', 'EXCEPT', 'SET', 'VALUES', 'ON', 'USING', 'SELECT',
  'RETURNING', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER',
  'NATURAL', 'LATERAL', 'WITH', 'AS', 'INTO', 'FROM', 'AND', 'OR', 'NOT',
  'DELETE', 'INSERT', 'UPDATE', 'CREATE', 'DROP', 'ALTER', 'TRUNCATE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'DO', 'NOTHING', 'CONFLICT', 'DUPLICATE',
  'KEY', 'FOR', 'BY', 'DESC', 'ASC', 'ONLY', 'TABLE', 'PARTITION',
]);

/** Join keywords that precede a table without an intervening FROM. */
const JOIN_WORDS = ['JOIN'];

/**
 * Names introduced by `WITH x AS (…)`. These look exactly like tables at
 * every later `FROM`, and reporting them would invent dependencies on
 * things that do not exist.
 */
function collectCteNames(tokens: Token[]): Set<string> {
  const names = new Set<string>();

  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], 'WITH')) continue;

    let j = i + 1;
    if (isWord(tokens[j], 'RECURSIVE')) j++;

    // `name [(cols)] AS ( … )` , repeated comma-separated.
    for (;;) {
      const nameTok = tokens[j];
      if (!isNameToken(nameTok)) break;

      let k = j + 1;
      // Optional column list.
      if (tokens[k]?.value === '(') k = skipParens(tokens, k);
      if (isWord(tokens[k], 'AS')) k++;
      if (isWord(tokens[k], 'MATERIALIZED') || isWord(tokens[k], 'NOT')) {
        while (tokens[k] && tokens[k].value !== '(') k++;
      }
      if (tokens[k]?.value !== '(') break;

      names.add(nameTok.value.toLowerCase());
      k = skipParens(tokens, k);

      if (tokens[k]?.value === ',') {
        j = k + 1;
        continue;
      }
      break;
    }
  }

  return names;
}

/** Index just past the `)` matching the `(` at `open`. */
function skipParens(tokens: Token[], open: number): number {
  let depth = 0;
  let i = open;
  for (; i < tokens.length; i++) {
    if (tokens[i].value === '(') depth++;
    else if (tokens[i].value === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return i;
}

interface QualifiedName {
  raw: string;
  table: string;
  schema: string | null;
  next: number;
  /**
   * Whether a `(` immediately follows. Its meaning depends on context:
   * after FROM it is a table function (`generate_series(…)`), after
   * INSERT INTO it is the column list — so the caller decides, not this
   * function.
   */
  followedByParen: boolean;
}

/** Read a possibly schema-qualified name starting at `i`. */
function readQualifiedName(tokens: Token[], i: number): QualifiedName | null {
  if (!isNameToken(tokens[i])) return null;

  const parts: string[] = [tokens[i].value];
  let j = i + 1;
  while (tokens[j]?.value === '.' && isNameToken(tokens[j + 1])) {
    parts.push(tokens[j + 1].value);
    j += 2;
  }

  const table = parts[parts.length - 1];
  const schema = parts.length > 1 ? parts[parts.length - 2] : null;
  return {
    raw: parts.join('.'),
    table,
    schema,
    next: j,
    followedByParen: tokens[j]?.value === '(',
  };
}

/** Skip an alias — `orders o` or `orders AS o`. */
function skipAlias(tokens: Token[], i: number): number {
  let j = i;
  if (isWord(tokens[j], 'AS')) {
    j++;
    if (isNameToken(tokens[j])) j++;
    return j;
  }
  const tok = tokens[j];
  if (isNameToken(tok) && !CLAUSE_END.has(tok.value.toUpperCase())) j++;
  return j;
}

/**
 * Consume a comma-separated table list starting at `i`, emitting a ref
 * for each name found.
 *
 * `allowParen` says how to read a `(` straight after a name. In a write
 * target (`INSERT INTO orders (user_id, total)`) it is a column list and
 * the name is still a table. In a FROM clause it is a call, and
 * `generate_series(1, 10)` is not a table.
 */
function consumeTableList(
  tokens: Token[],
  i: number,
  op: TableOp,
  keyword: string,
  ctes: Set<string>,
  out: TableRef[],
  allowParen = false,
): number {
  let j = i;

  for (;;) {
    // A derived table or a parenthesised join — the main loop descends
    // into it, so skip the group here rather than reading it as a name.
    if (tokens[j]?.value === '(') return j;

    const name = readQualifiedName(tokens, j);
    if (!name) return j;

    if (name.followedByParen && !allowParen) {
      // A table function. Step over its arguments so a following
      // `, orders` is still seen — returning here would silently drop
      // every remaining entry in the list.
      j = skipAlias(tokens, skipParens(tokens, name.next));
      if (tokens[j]?.value === ',') {
        j++;
        continue;
      }
      return j;
    }

    if (!ctes.has(name.table.toLowerCase())) {
      out.push({
        table: name.table.toLowerCase(),
        raw: name.raw,
        schema: name.schema,
        op,
        keyword,
        line: tokens[j].line,
      });
    }

    // A write target's column list is not an alias — step over it.
    j = name.followedByParen && allowParen
      ? skipParens(tokens, name.next)
      : skipAlias(tokens, name.next);

    if (tokens[j]?.value === ',') {
      j++;
      continue;
    }
    return j;
  }
}

/**
 * Extract every table reference in `sql`.
 *
 * Tolerant by construction: the input may be a fragment, may contain
 * driver placeholders or host-language interpolation, and may be
 * truncated mid-statement. Whatever can be read is read.
 */
export function extractTableRefs(sql: string): TableRef[] {
  if (!sql || sql.length === 0) return [];

  const tokens = tokenize(sql);
  if (tokens.length === 0) return [];

  const ctes = collectCteNames(tokens);
  const out: TableRef[] = [];

  // `DELETE … FROM x` writes; a bare `FROM x` reads. The verb arrives
  // before the FROM, so it has to be remembered.
  let pendingDelete = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // A statement end clears any pending verb. Without this a DELETE in one
    // statement reached across the ';' into the next one's FROM.
    if (t.value === ';') { pendingDelete = false; continue; }
    if (t.type !== 'word') continue;
    const w = t.value.toUpperCase();

    // `ON DELETE CASCADE` / `ON UPDATE` are the referential actions of a
    // constraint, not a verb. Without this, the DELETE inside an ALTER TABLE
    // set `pendingDelete` and it was never cleared at the statement end, so
    // the FROM of the NEXT statement was read as a write. Ubiquitous in DDL:
    // one foreign key with ON DELETE CASCADE mislabelled everything after it.
    if (w === 'ON') {
      pendingDelete = false;
      continue;
    }

    if (w === 'DELETE') {
      pendingDelete = true;
      continue;
    }

    if (w === 'FROM') {
      const op: TableOp = pendingDelete ? 'write' : 'read';
      const keyword = pendingDelete ? 'DELETE FROM' : 'FROM';
      pendingDelete = false;
      i = consumeTableList(tokens, i + 1, op, keyword, ctes, out) - 1;
      continue;
    }

    if (JOIN_WORDS.includes(w)) {
      i = consumeTableList(tokens, i + 1, 'read', 'JOIN', ctes, out) - 1;
      continue;
    }

    if (w === 'INTO') {
      // INSERT INTO / REPLACE INTO / MERGE INTO. A bare `SELECT … INTO x`
      // (Postgres) also writes, so the verb lookup is advisory only.
      i = consumeTableList(tokens, i + 1, 'write', 'INSERT INTO', ctes, out, true) - 1;
      continue;
    }

    if (w === 'UPDATE') {
      i = consumeTableList(tokens, i + 1, 'write', 'UPDATE', ctes, out, true) - 1;
      continue;
    }

    if (w === 'TRUNCATE') {
      let j = i + 1;
      if (isWord(tokens[j], 'TABLE')) j++;
      i = consumeTableList(tokens, j, 'write', 'TRUNCATE', ctes, out) - 1;
      continue;
    }

    // Any other verb clears a dangling DELETE.
    if (w === 'SELECT' || w === 'INSERT' || w === 'CREATE') pendingDelete = false;
  }

  return dedupe(out);
}

/**
 * One row per (table, op). A query joining `orders` twice is still one
 * dependency on `orders`.
 */
function dedupe(refs: TableRef[]): TableRef[] {
  const seen = new Map<string, TableRef>();
  for (const ref of refs) {
    const key = `${ref.schema ?? ''}.${ref.table}:${ref.op}`;
    if (!seen.has(key)) seen.set(key, ref);
  }
  return [...seen.values()];
}

/**
 * Does this string look like SQL at all?
 *
 * The gate for lifting an arbitrary string literal out of application
 * code. It has to be strict, because a false positive here becomes a
 * fabricated dependency edge on an architecture graph, and people act on
 * those. Regex alone is not strict enough: `/INSERT\s+INTO/` happily
 * matches the prose "insert into the form", and `/DELETE\s+FROM/`
 * matches "delete from the list of users".
 *
 * So this checks *structure* on the token stream — a verb, then the
 * shape that verb requires. Prose passes the verb and fails the shape.
 */
export function looksLikeSql(text: string): boolean {
  if (!text || text.length < 12) return false;

  const tokens = tokenize(text);
  if (tokens.length < 3) return false;

  const w = (i: number): string =>
    tokens[i]?.type === 'word' ? tokens[i].value.toUpperCase() : '';

  /** Index after a possibly schema-qualified name at `i`, or -1. */
  const afterName = (i: number): number => {
    const name = readQualifiedName(tokens, i);
    return name ? name.next : -1;
  };

  /** A clause keyword, statement end, or the end of the fragment. */
  const isBoundary = (i: number): boolean => {
    if (i >= tokens.length) return true;
    const t = tokens[i];
    if (t.value === ';' || t.value === '(') return true;
    return t.type === 'word' && CLAUSE_END.has(t.value.toUpperCase());
  };

  switch (w(0)) {
    case 'SELECT': {
      // Require a FROM, and require what follows it to look like a table
      // reference rather than a sentence. `SELECT 1` is valid SQL but names no
      // table, so it is of no interest to a ref-tracker either way.
      //
      // Presence of the word FROM alone is not enough: "Select all invoices
      // from customers with overdue balances" is UI copy, and it used to
      // produce a cross-system edge to a table called `customers` — a
      // fabricated coupling in the graph, which is worse than a missed one
      // because someone will act on it. The DELETE and TRUNCATE branches
      // already apply this discipline; SELECT did not.
      const from = tokens.findIndex(
        (t, i) => i > 0 && t.type === 'word' && t.value.toUpperCase() === 'FROM',
      );
      if (from === -1) return false;
      const after = afterName(from + 1);
      if (after === -1) return false;

      /** End of fragment, statement end, a list comma, or a paren. */
      const structural = (i: number): boolean =>
        i >= tokens.length || tokens[i].value === ';' || tokens[i].value === ','
        || tokens[i].value === '(' || tokens[i].value === ')';

      const wordAt = (i: number): string =>
        tokens[i]?.type === 'word' ? tokens[i].value.toUpperCase() : '';

      const acceptable = (i: number): boolean => {
        if (structural(i)) return true;
        const kw = wordAt(i);
        // WITH is in both languages: after a table it is only the T-SQL hint
        // `FROM t WITH (NOLOCK)`, while English uses it constantly
        // ("from customers with overdue balances"). Require the paren.
        if (kw === 'WITH') return tokens[i + 1]?.value === '(';
        return AFTER_TABLE.has(kw);
      };

      if (acceptable(after)) return true;

      // `FROM orders o` / `FROM orders AS o` — an alias, then the same test.
      let k = after;
      if (wordAt(k) === 'AS') k += 1;
      if (tokens[k]?.type === 'word' && !CLAUSE_END.has(wordAt(k))) k += 1;
      else return false;
      return acceptable(k);
    }

    case 'INSERT':
    case 'REPLACE': {
      if (w(1) !== 'INTO') return false;
      const after = afterName(2);
      if (after === -1) return false;
      // `INSERT INTO t (cols)`, `… VALUES`, `… SELECT`, `… SET`,
      // `… DEFAULT VALUES`.
      return (
        tokens[after]?.value === '(' ||
        ['VALUES', 'SELECT', 'SET', 'DEFAULT', 'WITH'].includes(w(after))
      );
    }

    case 'MERGE':
      return w(1) === 'INTO' && afterName(2) !== -1;

    case 'UPDATE': {
      const after = afterName(1);
      if (after === -1) return false;
      // `UPDATE t SET` — possibly with an alias in between.
      return w(after) === 'SET' || w(after + 1) === 'SET';
    }

    case 'DELETE': {
      if (w(1) !== 'FROM') return false;
      const after = afterName(2);
      if (after === -1) return false;
      // "delete from the list of users" gets this far and fails here:
      // `list` is neither a clause keyword nor a statement end.
      return isBoundary(after);
    }

    case 'TRUNCATE': {
      const start = w(1) === 'TABLE' ? 2 : 1;
      const after = afterName(start);
      return after !== -1 && isBoundary(after);
    }

    case 'WITH': {
      // `WITH x AS ( … )` — the CTE collector already knows this shape,
      // so reuse it rather than re-deriving it.
      return collectCteNames(tokens).size > 0;
    }

    default:
      return false;
  }
}
