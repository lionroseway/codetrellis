/**
 * Smoke test for the schema reconciler.
 *
 * Simulates a v0.1.8-style "old DB" by creating a `tasks` table that's
 * missing the `file_spec` column (the actual bug we shipped), runs the
 * reconciler against the declared schema, and asserts that the missing
 * column was added.
 *
 * Also covers a few parser corner cases that the live schema relies on:
 *   - quoted `"references"` column name in system_docs
 *   - column-level REFERENCES with `(col)` parens
 *   - UNIQUE(...) at the end of a CREATE TABLE body (constraint, not a column)
 *
 * Run: `npx tsx scripts/smoke-schema-reconcile.ts`. Exits 0 on success,
 * non-zero with a contextual message on first assertion failure.
 */

import path from 'node:path';
import fs from 'node:fs';
import {
  parseCreateTableSql,
  reconcileSchemaFromSql,
} from '../src/backend/services/schema-reconciler';
import { PERSISTENT_SCHEMA_SQL, SCHEMA_PLANS_CORE } from '../src/backend/services/db-schema';

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

async function loadSqlJs(): Promise<typeof import('sql.js').default> {
  // Match the runtime loader's logic: prefer the bundled resourcesPath
  // when running inside Electron, else fall back to require.resolve.
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  if (resourcesPath) {
    const packagedPath = path.join(resourcesPath, 'sql.js', 'dist', 'sql-wasm.js');
    if (fs.existsSync(packagedPath)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(packagedPath);
    }
  }
  const sqlJsName = 'sql' + '.js';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(sqlJsName);
}

async function main(): Promise<void> {
  console.log('schema-reconciler smoke test');

  // --- Parser unit checks ---
  console.log('parser:');
  const tables = parseCreateTableSql(PERSISTENT_SCHEMA_SQL);
  const byName = new Map(tables.map((t) => [t.name, t]));

  const tasks = byName.get('tasks');
  if (!tasks) fail('parser missed `tasks` table');
  if (!tasks!.columns.some((c) => c.name === 'file_spec')) {
    fail('parser did not extract `tasks.file_spec` column');
  }
  ok('tasks.file_spec recognised by parser');

  const systemDocs = byName.get('system_docs');
  if (!systemDocs) fail('parser missed `system_docs` table');
  if (!systemDocs!.columns.some((c) => c.name === 'references')) {
    fail('parser did not handle the quoted `"references"` column in system_docs');
  }
  ok('quoted "references" column parsed');

  const planItems = byName.get('plan_items');
  if (!planItems) fail('parser missed `plan_items` table');
  if (!planItems!.columns.some((c) => c.name === 'parent_uid')) {
    fail('parser did not extract `plan_items.parent_uid` (column-level REFERENCES with parens)');
  }
  ok('column-level REFERENCES with parens parsed');

  // Constraint clauses like UNIQUE(...) must NOT be misparsed as columns.
  if (planItems!.columns.some((c) => /^UNIQUE/i.test(c.name))) {
    fail('UNIQUE(...) constraint was misparsed as a column');
  }
  ok('UNIQUE / FK constraint clauses correctly skipped');

  // --- Reconciler integration check ---
  console.log('reconciler:');
  const SQL = await loadSqlJs();
  const initSqlJs = SQL as any;
  const SqlJs = await initSqlJs({
    locateFile: (file: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require.resolve(`sql.js/dist/${file}`);
    },
  });
  const db = new SqlJs.Database();

  // Build a "v0.1.7-style" tasks table — the declared schema minus
  // `file_spec`. This is the exact shape that bit users on the May
  // build.
  db.run(`
    CREATE TABLE tasks (
      uid TEXT PRIMARY KEY,
      plan_uid TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE plans (
      uid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      project_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  // Put a row in so the reconciler's ALTER has to handle a non-empty table.
  db.run(
    `INSERT INTO tasks (uid, plan_uid, sort_order, description, created_at, updated_at)
     VALUES ('t1', 'p1', 0, 'demo', ?, ?)`,
    [Date.now(), Date.now()],
  );

  const before = liveColumns(db, 'tasks');
  if (before.includes('file_spec')) fail('test fixture already had file_spec — bad setup');
  ok(`fixture missing file_spec (has ${before.length} columns)`);

  const report = reconcileSchemaFromSql(db, SCHEMA_PLANS_CORE);

  const added = report.columnsAdded.filter((c) => c.table === 'tasks' && c.column === 'file_spec');
  if (added.length !== 1) {
    fail(
      `expected exactly one columnsAdded entry for tasks.file_spec; got ${added.length}. ` +
        `Full report: ${JSON.stringify(report, null, 2)}`,
    );
  }
  ok(`reconciler reported adding tasks.file_spec (sql: \`${added[0].sql}\`)`);

  const after = liveColumns(db, 'tasks');
  if (!after.includes('file_spec')) {
    fail(`tasks.file_spec still missing after reconcile. cols=${after.join(',')}`);
  }
  ok(`tasks.file_spec present after reconcile (${after.length} columns)`);

  // Existing row must still exist (ALTER ADD COLUMN is additive).
  const rowsResult = db.exec('SELECT count(*) AS n FROM tasks');
  const n = rowsResult[0]?.values[0]?.[0] as number;
  if (n !== 1) fail(`expected 1 row in tasks, got ${n}`);
  ok('existing row preserved across ALTER');

  // Running the reconciler again should be a no-op (idempotent).
  const second = reconcileSchemaFromSql(db, SCHEMA_PLANS_CORE);
  if (second.columnsAdded.length !== 0) {
    fail(
      `second pass should be a no-op but added ${second.columnsAdded.length} column(s): ` +
        JSON.stringify(second.columnsAdded),
    );
  }
  ok('second pass is idempotent (no further ALTERs)');

  // Tables that don't exist on the live DB should be skipped, not errored.
  const reportPersistent = reconcileSchemaFromSql(db, PERSISTENT_SCHEMA_SQL);
  if (!reportPersistent.tablesSkipped.includes('plan_items')) {
    fail('reconciler should skip `plan_items` (not present on this fixture)');
  }
  ok('non-existent tables are skipped, not errored');

  if (reportPersistent.errors.length > 0) {
    fail(`reconciler reported errors: ${JSON.stringify(reportPersistent.errors, null, 2)}`);
  }
  ok('no reconciler errors on the fixture DB');

  console.log('all good');
}

function liveColumns(db: any, table: string): string[] {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const names: string[] = [];
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject() as { name?: string };
      if (row.name) names.push(row.name);
    }
  } finally {
    stmt.free();
  }
  return names;
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
