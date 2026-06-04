import type { Database } from 'sql.js';

/**
 * Schema reconciler — keep live DBs aligned with the declared schema.
 *
 * Why it exists: `CREATE TABLE IF NOT EXISTS` does nothing when the
 * table already exists, so adding a column to the CREATE block doesn't
 * help anyone whose DB was created before that line existed. The
 * historical workaround is a list of `ALTER TABLE … ADD COLUMN`
 * statements, but it's easy to forget one — and when you do, every
 * upgrader crashes the first time the new code reads the missing
 * column. The `tasks.file_spec` bug shipped that way.
 *
 * This reconciler is a safety net for that class of bug. It parses the
 * declared CREATE TABLE statements, queries the live DB with
 * `PRAGMA table_info(<table>)`, and ALTERs any column that's declared
 * but missing. It does **not** delete or rename anything; it only adds.
 *
 * It's complementary to the explicit lazy-migration block — that block
 * stays the right place for non-additive changes (indexes, NOT NULL
 * with non-trivial defaults, data backfills). The reconciler handles
 * the ordinary "added a nullable column and forgot the ALTER" case.
 */

export interface ColumnSpec {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
}

export interface TableSchema {
  name: string;
  columns: ColumnSpec[];
}

export interface ReconcileReport {
  tablesChecked: number;
  tablesSkipped: string[];
  columnsAdded: Array<{ table: string; column: string; sql: string }>;
  errors: Array<{ table: string; column: string; error: string }>;
}

const COMMENT_LINE = /--[^\n]*/g;
const COMMENT_BLOCK = /\/\*[\s\S]*?\*\//g;

/**
 * Strip SQL comments so the column scanner doesn't see commas /
 * keywords inside them.
 */
function stripComments(sql: string): string {
  return sql.replace(COMMENT_BLOCK, '').replace(COMMENT_LINE, '');
}

/**
 * Parse every `CREATE TABLE IF NOT EXISTS <name> ( <body> )` block in a
 * SQL string. Ignores everything else (indexes, ALTERs, comments).
 *
 * Multi-line, balanced-paren aware. Handles the things our schema
 * actually uses: column-level REFERENCES with `(col)`, the quoted
 * `"references"` column name in system_docs, table-level UNIQUE / FK
 * constraints (which are skipped as non-columns), inline column
 * defaults that include parens (rare but possible).
 */
export function parseCreateTableSql(sql: string): TableSchema[] {
  const cleaned = stripComments(sql);
  const out: TableSchema[] = [];

  // Match the table name + opening paren; we'll scan from there.
  const headRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;
  let m: RegExpExecArray | null;

  while ((m = headRe.exec(cleaned)) !== null) {
    const tableName = m[1];
    const bodyStart = m.index + m[0].length;
    const bodyEnd = findMatchingParen(cleaned, bodyStart - 1);
    if (bodyEnd < 0) continue;
    const body = cleaned.slice(bodyStart, bodyEnd);
    const columns = parseColumnList(body);
    out.push({ name: tableName, columns });
    // Resume scanning past the closing paren.
    headRe.lastIndex = bodyEnd + 1;
  }

  return out;
}

/**
 * Given a position pointing at `(`, return the index of the matching
 * `)` accounting for nesting. Returns -1 if unbalanced.
 *
 * Skips quoted strings so a literal `'(' ` inside a default doesn't
 * throw off the counter.
 */
function findMatchingParen(s: string, openIdx: number): number {
  if (s[openIdx] !== '(') return -1;
  let depth = 1;
  let i = openIdx + 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" || ch === '"') {
      // Skip the quoted literal — handle doubled-quote escape.
      const quote = ch;
      i++;
      while (i < s.length) {
        if (s[i] === quote) {
          if (s[i + 1] === quote) { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Split a table body by top-level commas (not commas inside parens or
 * quotes), then classify each part as a column or a constraint clause.
 */
function parseColumnList(body: string): ColumnSpec[] {
  const parts = splitTopLevelCommas(body);
  const columns: ColumnSpec[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (isConstraintClause(part)) continue;
    const col = parseColumnDef(part);
    if (col) columns.push(col);
  }
  return columns;
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < s.length) {
        if (s[i] === quote) {
          if (s[i + 1] === quote) { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(s.slice(start));
  return out;
}

const CONSTRAINT_KEYWORDS = [
  'PRIMARY KEY',
  'UNIQUE',
  'CHECK',
  'FOREIGN KEY',
  'CONSTRAINT',
];

function isConstraintClause(part: string): boolean {
  const upper = part.toUpperCase().trimStart();
  return CONSTRAINT_KEYWORDS.some((kw) => upper.startsWith(kw + ' ') || upper.startsWith(kw + '('));
}

/**
 * Parse a single column definition like:
 *   `name TEXT NOT NULL DEFAULT '[]'`
 *   `id INTEGER PRIMARY KEY AUTOINCREMENT`
 *   `"references" TEXT NOT NULL DEFAULT '{}'`
 *   `parent_uid TEXT REFERENCES plan_items(uid)`
 */
function parseColumnDef(def: string): ColumnSpec | null {
  // Extract the column name. Allow `"quoted"` identifiers.
  let rest = def.trim();
  let name: string;
  if (rest.startsWith('"')) {
    const closeIdx = rest.indexOf('"', 1);
    if (closeIdx < 0) return null;
    name = rest.slice(1, closeIdx);
    rest = rest.slice(closeIdx + 1).trim();
  } else {
    const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([\s\S]*)$/);
    if (!m) return null;
    name = m[1];
    rest = m[2];
  }

  // Type is the next whitespace-delimited token (TEXT, INTEGER, REAL,
  // BLOB, etc.). We don't need to model the full type system — sqlite
  // is permissive — but capturing it makes the ALTER readable.
  const typeMatch = rest.match(/^([A-Za-z][A-Za-z0-9_]*)/);
  const type = typeMatch ? typeMatch[1].toUpperCase() : 'TEXT';

  const upper = rest.toUpperCase();
  const notNull = /\bNOT\s+NULL\b/.test(upper);
  const defaultValue = extractDefault(rest);

  return { name, type, notNull, defaultValue };
}

/**
 * Pull out the DEFAULT clause's value. Supports a quoted string, a
 * numeric literal, NULL, and bare identifiers (e.g. CURRENT_TIMESTAMP).
 * Returns null if there's no DEFAULT.
 */
function extractDefault(s: string): string | null {
  const re = /\bDEFAULT\s+/i;
  const m = re.exec(s);
  if (!m) return null;
  let i = m.index + m[0].length;
  // Skip leading whitespace already handled by re.
  if (i >= s.length) return null;
  const ch = s[i];
  if (ch === "'" || ch === '"') {
    const quote = ch;
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === quote) {
        if (s[j + 1] === quote) { j += 2; continue; }
        return s.slice(i, j + 1);
      }
      j++;
    }
    return null;
  }
  // Bare token: stop at whitespace or comma.
  let j = i;
  while (j < s.length && !/\s|,/.test(s[j])) j++;
  return s.slice(i, j);
}

/**
 * Query the live DB for one table's column names.
 * Returns an empty array if the table doesn't exist (so the caller
 * can skip rather than ALTERing a non-existent table).
 */
function liveColumns(db: Database, table: string): string[] {
  // PRAGMA table_info takes the table name as an unquoted identifier;
  // it can't be parameter-bound. Validate the name to keep this
  // injection-safe — only callers passing tables from db-schema.ts
  // should hit this anyway.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return [];
  const result = db.exec(`PRAGMA table_info(${table})`);
  if (result.length === 0) return [];
  const { columns, values } = result[0];
  const nameIdx = columns.indexOf('name');
  if (nameIdx < 0) return [];
  const out: string[] = [];
  for (const row of values) {
    const v = row[nameIdx];
    if (typeof v === 'string') out.push(v);
  }
  return out;
}

function buildAddColumnSql(table: string, col: ColumnSpec): string {
  // SQLite's ALTER TABLE ADD COLUMN forbids NOT NULL without a
  // DEFAULT on a non-empty table. If the declared schema has NOT NULL
  // with no default, drop the NOT NULL on the live alter — the data
  // model already allowed the column to be absent (NULL) until now,
  // so existing rows will be NULL until backfilled. Future writes
  // still go through the typed code path that enforces non-null.
  const parts = [`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`];
  if (col.notNull && col.defaultValue !== null) {
    parts.push(`NOT NULL DEFAULT ${col.defaultValue}`);
  } else if (col.defaultValue !== null) {
    parts.push(`DEFAULT ${col.defaultValue}`);
  }
  return parts.join(' ');
}

export interface ReconcileOptions {
  /**
   * Tables to skip entirely. The AST tables are torn down + rebuilt on
   * every project scan, so reconciling them is wasted work.
   */
  skipTables?: string[];
}

export function reconcileSchema(
  db: Database,
  expected: TableSchema[],
  options: ReconcileOptions = {},
): ReconcileReport {
  const skip = new Set(options.skipTables ?? []);
  const report: ReconcileReport = {
    tablesChecked: 0,
    tablesSkipped: [],
    columnsAdded: [],
    errors: [],
  };

  for (const table of expected) {
    if (skip.has(table.name)) {
      report.tablesSkipped.push(table.name);
      continue;
    }
    const actual = liveColumns(db, table.name);
    if (actual.length === 0) {
      // Table doesn't exist on this DB. Either it's a fresh table that
      // a later CREATE TABLE will handle, or the bootstrap hasn't run
      // yet. Either way, not the reconciler's problem.
      report.tablesSkipped.push(table.name);
      continue;
    }
    report.tablesChecked++;
    const actualSet = new Set(actual);
    for (const col of table.columns) {
      if (actualSet.has(col.name)) continue;
      const sql = buildAddColumnSql(table.name, col);
      try {
        db.run(sql);
        report.columnsAdded.push({ table: table.name, column: col.name, sql });
      } catch (err) {
        report.errors.push({
          table: table.name,
          column: col.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return report;
}

/**
 * Convenience: parse + reconcile in one call.
 */
export function reconcileSchemaFromSql(
  db: Database,
  schemaSql: string,
  options: ReconcileOptions = {},
): ReconcileReport {
  return reconcileSchema(db, parseCreateTableSql(schemaSql), options);
}
