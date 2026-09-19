/**
 * SQL support — Phase 21.
 *
 * SQL is deliberately **not** a parser plugin. It has no import graph,
 * so there is nothing for a resolver to do, and the value is not in the
 * `.sql` files at all — it is in knowing which *application code*
 * touches which tables. See
 * [docs/PHASE-21-SQL-REF-TRACKER.md](../../../../docs/PHASE-21-SQL-REF-TRACKER.md).
 *
 * Two pieces:
 *   - `schema.ts`  — DDL → table / view / proc symbols, plus the
 *                    migration fold.
 *   - `refs.ts`    — any SQL text → the tables it reads and writes.
 *
 * Both sit on `tokenizer.ts`, which is the part that makes this
 * trustworthy: comments, string literals and CTE aliases are handled
 * lexically, so the extractor does not invent dependencies that a naive
 * regex would.
 */

import type { Callsite } from '../../../shared/types';
import type { TableRef } from './refs';

export { tokenize, isWord, isNameToken } from './tokenizer';
export type { Token, TokenType } from './tokenizer';
export { extractTableRefs, looksLikeSql } from './refs';
export type { TableRef, TableOp } from './refs';
export {
  extractSchemaStatements,
  extractSqlSymbols,
  foldMigrations,
  applyMigrationFold,
  looksLikeMigrationsDir,
  sortMigrations,
} from './schema';
export type { SchemaStatement, SchemaKind, SchemaAction, FoldedTable } from './schema';

/** Longest SQL snippet kept on a callsite row. */
const MAX_SQL_TEXT = 400;

/**
 * Turn table references into `sql_query` callsites for the cross-system
 * matcher.
 *
 * ## Column mapping, stated plainly
 *
 * The `callsites` table is shared with HTTP, and its columns are the
 * generic "what was referenced" slots rather than HTTP-specific ones:
 *
 *   `url_pattern` → the table name (a route path for HTTP)
 *   `method`      → READ or WRITE (a verb for HTTP)
 *   `sql_text`    → the snippet the reference came from
 *   `context`     → the keyword that introduced it, e.g. `FROM`
 *
 * Reusing `url_pattern` is not a shortcut: it already carries an index
 * (`idx_callsites_url`), which is exactly the lookup the SQL matcher
 * needs, and it avoids a migration on a table that self-heals.
 */
export function sqlRefsToCallsites(
  refs: TableRef[],
  context: string,
  sqlText?: string,
  line?: number,
): Callsite[] {
  return refs.map((ref) => ({
    kind: 'sql_query' as const,
    protocol: 'sql' as const,
    line: line ?? ref.line,
    method: ref.op.toUpperCase(),
    urlPattern: ref.table,
    sqlText: sqlText ? sqlText.slice(0, MAX_SQL_TEXT) : undefined,
    context: `${context}:${ref.keyword}`,
  }));
}
