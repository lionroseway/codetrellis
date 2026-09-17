import { tokenize, isWord, isNameToken, type Token } from './tokenizer';
import type { ParsedSymbol } from '../../../shared/types';

/**
 * Schema extraction — Phase 21, piece A.
 *
 * Turns the DDL in a `.sql` file into symbols, so a table becomes a
 * first-class thing the rest of CodeTrellis already knows how to handle:
 * the Inspector renders it, `search_symbols` finds it, the `@` mention
 * picker offers it, and the symbol-depth graph view draws it. No new
 * storage, no new UI.
 *
 * **Columns are deliberately not symbols.** At the altitude this product
 * works at the table is the unit; a sixty-column table would swamp the
 * graph and bury what the user came to see.
 */

export type SchemaAction = 'create' | 'alter' | 'drop' | 'rename';
export type SchemaKind = 'table' | 'view' | 'proc';

export interface SchemaStatement {
  action: SchemaAction;
  kind: SchemaKind;
  /** Lower-cased bare name, for matching. */
  name: string;
  /** Name as written, for display. */
  raw: string;
  schema: string | null;
  /** For `rename`, the new name (lower-cased). */
  renameTo?: string;
  /** Extra descriptors — `materialized`, `temporary`. */
  modifiers: string[];
  line: number;
  startLine: number;
  endLine: number;
}

/** Words that may sit between CREATE and the object keyword. */
const CREATE_MODIFIERS = new Set([
  'OR', 'REPLACE', 'TEMP', 'TEMPORARY', 'UNLOGGED', 'GLOBAL', 'LOCAL',
  'MATERIALIZED', 'RECURSIVE', 'EXTERNAL', 'VIRTUAL',
]);

function readName(
  tokens: Token[],
  i: number,
): { raw: string; name: string; schema: string | null; next: number } | null {
  if (!isNameToken(tokens[i])) return null;
  const parts = [tokens[i].value];
  let j = i + 1;
  while (tokens[j]?.value === '.' && isNameToken(tokens[j + 1])) {
    parts.push(tokens[j + 1].value);
    j += 2;
  }
  const bare = parts[parts.length - 1];
  return {
    raw: parts.join('.'),
    name: bare.toLowerCase(),
    schema: parts.length > 1 ? parts[parts.length - 2] : null,
    next: j,
  };
}

/** Step over `IF NOT EXISTS` / `IF EXISTS`. */
function skipIfExists(tokens: Token[], i: number): number {
  let j = i;
  if (!isWord(tokens[j], 'IF')) return j;
  j++;
  if (isWord(tokens[j], 'NOT')) j++;
  if (isWord(tokens[j], 'EXISTS')) j++;
  return j;
}

/**
 * The line the statement's body ends on — used so a table's symbol spans
 * its definition rather than collapsing to a single line.
 */
function statementEndLine(tokens: Token[], from: number): number {
  let depth = 0;
  for (let i = from; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.value === '(') depth++;
    else if (t.value === ')') depth--;
    else if (t.value === ';' && depth <= 0) return t.line;
  }
  return tokens[tokens.length - 1]?.line ?? tokens[from]?.line ?? 1;
}

/**
 * Every DDL statement in `sql`, in source order.
 *
 * `CREATE INDEX` is skipped on purpose: an index is an implementation
 * detail of a table, not an architectural object, and emitting one
 * symbol per index buries the tables among them.
 */
export function extractSchemaStatements(sql: string): SchemaStatement[] {
  const tokens = tokenize(sql);
  const out: SchemaStatement[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'word') continue;
    const verb = t.value.toUpperCase();

    if (verb === 'CREATE') {
      const modifiers: string[] = [];
      let j = i + 1;
      while (tokens[j]?.type === 'word' && CREATE_MODIFIERS.has(tokens[j].value.toUpperCase())) {
        const m = tokens[j].value.toLowerCase();
        if (m !== 'or' && m !== 'replace') modifiers.push(m);
        j++;
      }

      const objectWord = tokens[j]?.type === 'word' ? tokens[j].value.toUpperCase() : '';
      let kind: SchemaKind | null = null;
      if (objectWord === 'TABLE') kind = 'table';
      else if (objectWord === 'VIEW') kind = 'view';
      else if (objectWord === 'FUNCTION' || objectWord === 'PROCEDURE') kind = 'proc';
      if (!kind) continue;

      j = skipIfExists(tokens, j + 1);
      const name = readName(tokens, j);
      if (!name) continue;

      out.push({
        action: 'create',
        kind,
        name: name.name,
        raw: name.raw,
        schema: name.schema,
        modifiers,
        line: t.line,
        startLine: t.line,
        endLine: statementEndLine(tokens, name.next),
      });
      i = name.next - 1;
      continue;
    }

    if (verb === 'ALTER' && isWord(tokens[i + 1], 'TABLE')) {
      let j = skipIfExists(tokens, i + 2);
      if (isWord(tokens[j], 'ONLY')) j++;
      const name = readName(tokens, j);
      if (!name) continue;

      // `ALTER TABLE x RENAME TO y` is the one ALTER that changes which
      // tables exist, so the fold has to see it.
      let k = name.next;
      if (isWord(tokens[k], 'RENAME') && isWord(tokens[k + 1], 'TO')) {
        const target = readName(tokens, k + 2);
        if (target) {
          out.push({
            action: 'rename',
            kind: 'table',
            name: name.name,
            raw: name.raw,
            schema: name.schema,
            renameTo: target.name,
            modifiers: [],
            line: t.line,
            startLine: t.line,
            endLine: t.line,
          });
          i = target.next - 1;
          continue;
        }
      }

      out.push({
        action: 'alter',
        kind: 'table',
        name: name.name,
        raw: name.raw,
        schema: name.schema,
        modifiers: [],
        line: t.line,
        startLine: t.line,
        endLine: t.line,
      });
      i = k - 1;
      continue;
    }

    if (verb === 'DROP') {
      const objectWord = tokens[i + 1]?.type === 'word' ? tokens[i + 1].value.toUpperCase() : '';
      let kind: SchemaKind | null = null;
      if (objectWord === 'TABLE') kind = 'table';
      else if (objectWord === 'VIEW') kind = 'view';
      else if (objectWord === 'MATERIALIZED' && isWord(tokens[i + 2], 'VIEW')) kind = 'view';
      else if (objectWord === 'FUNCTION' || objectWord === 'PROCEDURE') kind = 'proc';
      if (!kind) continue;

      let j = i + (objectWord === 'MATERIALIZED' ? 3 : 2);
      j = skipIfExists(tokens, j);

      // `DROP TABLE a, b;`
      for (;;) {
        const name = readName(tokens, j);
        if (!name) break;
        out.push({
          action: 'drop',
          kind,
          name: name.name,
          raw: name.raw,
          schema: name.schema,
          modifiers: [],
          line: t.line,
          startLine: t.line,
          endLine: t.line,
        });
        j = name.next;
        if (tokens[j]?.value === ',') {
          j++;
          continue;
        }
        break;
      }
      i = j - 1;
      continue;
    }
  }

  return out;
}

/**
 * Symbols for one `.sql` file.
 *
 * Only `CREATE` statements define something, so only they become
 * symbols. An `ALTER` or `DROP` in a migration is a change to a table
 * defined elsewhere — it belongs to the fold (see `foldMigrations`), not
 * to this file's symbol list, or every migration that touched a table
 * would claim to define it.
 */
export function extractSqlSymbols(sql: string): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  for (const stmt of extractSchemaStatements(sql)) {
    if (stmt.action !== 'create') continue;

    const kind = stmt.kind === 'proc' ? 'function' : 'class';
    const modifiers = [stmt.kind, ...stmt.modifiers];
    if (stmt.schema) modifiers.push(`schema:${stmt.schema}`);

    symbols.push({
      name: stmt.raw,
      kind: kind as ParsedSymbol['kind'],
      startLine: stmt.startLine,
      endLine: stmt.endLine,
      children: [],
      modifiers,
    });
  }

  return symbols;
}

export interface FoldedTable {
  name: string;
  raw: string;
  kind: SchemaKind;
  /** Path of the file whose CREATE introduced it. */
  definedIn: string;
  startLine: number;
  endLine: number;
  /** Paths of files that altered it after creation. */
  alteredIn: string[];
}

/**
 * Replay an ordered list of SQL files and return the tables that still
 * exist at the end.
 *
 * Most repositories define their schema as a pile of migrations rather
 * than one canonical file: `001_create_orders.sql` creates it,
 * `014_add_status.sql` alters it, `031_drop_orders.sql` removes it.
 * Treating each file as an independent definer produces duplicate and
 * zombie tables — a graph showing a table that was deleted two years ago
 * is worse than one showing no tables at all.
 *
 * Scope is capped on purpose: CREATE, ALTER, RENAME and DROP. Anything
 * else leaves the table as it is.
 */
export function foldMigrations(files: Array<{ path: string; sql: string }>): Map<string, FoldedTable> {
  const live = new Map<string, FoldedTable>();

  for (const file of files) {
    for (const stmt of extractSchemaStatements(file.sql)) {
      switch (stmt.action) {
        case 'create': {
          if (stmt.kind === 'proc') break;
          // A re-CREATE (`CREATE OR REPLACE VIEW`) keeps the original
          // definer — the first file to introduce it is the one a reader
          // should open.
          if (!live.has(stmt.name)) {
            live.set(stmt.name, {
              name: stmt.name,
              raw: stmt.raw,
              kind: stmt.kind,
              definedIn: file.path,
              startLine: stmt.startLine,
              endLine: stmt.endLine,
              alteredIn: [],
            });
          }
          break;
        }

        case 'alter': {
          const existing = live.get(stmt.name);
          if (existing && !existing.alteredIn.includes(file.path)) {
            existing.alteredIn.push(file.path);
          }
          break;
        }

        case 'rename': {
          const existing = live.get(stmt.name);
          if (existing && stmt.renameTo) {
            live.delete(stmt.name);
            live.set(stmt.renameTo, { ...existing, name: stmt.renameTo, raw: stmt.renameTo });
          }
          break;
        }

        case 'drop':
          live.delete(stmt.name);
          break;
      }
    }
  }

  return live;
}

/**
 * Does this directory look like a migrations directory?
 *
 * The convention is near-universal across goose, golang-migrate,
 * Alembic, Flyway and Knex: a directory of `.sql` whose filenames sort
 * meaningfully, prefixed by a sequence number or a timestamp. Requiring
 * a majority rather than all of them tolerates a stray `README.sql`.
 */
export function looksLikeMigrationsDir(fileNames: string[]): boolean {
  const sqlFiles = fileNames.filter((f) => f.toLowerCase().endsWith('.sql'));
  if (sqlFiles.length < 2) return false;
  const numbered = sqlFiles.filter((f) => /^(\d{3,}|\d{8,})[._-]/.test(f.replace(/^.*\//, '')));
  return numbered.length >= Math.ceil(sqlFiles.length / 2);
}

/**
 * Migration order is filename order, with numeric prefixes compared as
 * numbers so `9_x.sql` precedes `10_x.sql`.
 */
export function sortMigrations<T extends { path: string }>(files: T[]): T[] {
  const keyOf = (p: string): [number, string] => {
    const base = p.replace(/^.*\//, '');
    const m = /^(\d+)/.exec(base);
    return [m ? Number(m[1]) : Number.MAX_SAFE_INTEGER, base];
  };
  return [...files].sort((a, b) => {
    const [an, as_] = keyOf(a.path);
    const [bn, bs] = keyOf(b.path);
    return an !== bn ? an - bn : as_.localeCompare(bs);
  });
}

/**
 * Apply the migration fold to already-parsed `.sql` files.
 *
 * Runs after a batch parse, because folding is a property of a
 * *directory* of migrations, not of any single file — and a per-file
 * parser cannot know that `031_drop_legacy.sql` invalidates a table that
 * `002_create_legacy.sql` defined.
 *
 * Two corrections are made, both of which stop the graph asserting
 * things that are not true:
 *
 *   - a table dropped by a later migration stops being a symbol at all
 *   - a table is a symbol only in the migration that CREATEd it, so an
 *     `ALTER` does not make a second file claim to define it
 *
 * Files outside a migrations directory are left alone: a standalone
 * `schema.sql` is already canonical.
 */
export function applyMigrationFold(
  sqlFiles: Array<{ path: string; symbols: ParsedSymbol[] }>,
  readFile: (path: string) => string | null,
): void {
  const byDir = new Map<string, Array<{ path: string; symbols: ParsedSymbol[] }>>();
  for (const file of sqlFiles) {
    const dir = file.path.replace(/[\\/][^\\/]*$/, '');
    const bucket = byDir.get(dir);
    if (bucket) bucket.push(file);
    else byDir.set(dir, [file]);
  }

  for (const [, files] of byDir) {
    if (!looksLikeMigrationsDir(files.map((f) => f.path))) continue;

    const ordered = sortMigrations(files);
    const withSql: Array<{ path: string; sql: string }> = [];
    for (const file of ordered) {
      const sql = readFile(file.path);
      if (sql !== null) withSql.push({ path: file.path, sql });
    }
    if (withSql.length === 0) continue;

    const live = foldMigrations(withSql);

    for (const file of ordered) {
      file.symbols = file.symbols.filter((sym) => {
        const bare = sym.name.split('.').pop()!.toLowerCase();
        const survivor = live.get(bare);
        // Procedures are not folded (they have no create/drop lifecycle
        // worth tracking here), so they always survive.
        if (!survivor) return sym.modifiers.includes('proc');
        return survivor.definedIn === file.path;
      });
    }
  }
}
