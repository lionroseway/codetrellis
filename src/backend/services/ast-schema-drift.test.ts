/**
 * An upgrade must not cost the user the graph.
 *
 * Phase 27 added `imports.is_relative`. The reconciler — which exists for
 * exactly this, "added a column to CREATE TABLE but forgot the matching
 * ALTER" — was told to skip the five AST tables, on the grounds that they
 * are "dropped + rebuilt on every project scan, so reconciling them is
 * wasted work".
 *
 * They are not dropped. They are emptied with `DELETE FROM`, and the DDL
 * is `CREATE TABLE IF NOT EXISTS`, which does nothing to a table that
 * already exists. And `PERSISTENT_SCHEMA_SQL` did not contain the AST
 * schema at all, so the reconciler could not have seen the column even
 * if it had been looking.
 *
 * So on every database created before Phase 27 — i.e. every existing
 * install — each scan failed with `table imports has no column named
 * is_relative` and fell back to "serving file tree only": no graph, no
 * symbols, no edges, a warning on the server console and an empty
 * project on screen. Found by watching a real dev database do it, not by
 * reading the code; neither review caught it, because nothing in the
 * source is wrong when read against a fresh database.
 *
 * This test builds a database with the OLD shape and asserts the app
 * heals it, which is the only way to see this class of defect.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-drift-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

/** `imports` exactly as it stood before Phase 27 — no `is_relative`. */
const PRE_PHASE_27 = `
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    language TEXT,
    content_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    source_path TEXT NOT NULL,
    specifiers TEXT,
    is_default INTEGER DEFAULT 0,
    is_namespace INTEGER DEFAULT 0
  );
`;

let db: typeof import('./database');

before(async () => {
  // Plant the old database BEFORE the app opens it, the way an upgrade
  // finds one.
  const Database = require_('better-sqlite3');
  const planted = new Database(path.join(tmp, 'data.db'));
  planted.exec(PRE_PHASE_27);
  planted.close();

  db = await import('./database');
  await db.initDatabase();
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const columns = (table: string): string[] =>
  (db.getDb().exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map(
    (r: unknown[]) => r[1] as string,
  );

describe('an AST column added after a database was created (N2)', () => {
  test('the missing column is added on open', () => {
    assert.ok(
      columns('imports').includes('is_relative'),
      'imports.is_relative was never added — every scan on this database fails',
    );
  });

  test('the columns that were already there survive', () => {
    // Additive only. The reconciler must never drop or rewrite, because
    // this table holds the user's scanned project.
    for (const col of ['id', 'file_id', 'source_path', 'specifiers', 'is_default', 'is_namespace']) {
      assert.ok(columns('imports').includes(col), col);
    }
  });

  test('a write using the new column succeeds', () => {
    // The real failure was an INSERT, not a schema comparison. This is
    // the statement that was throwing on every scanned file.
    db.getDb().run(
      `INSERT INTO files (path, language, content_hash) VALUES ('/repo/a.ts', 'typescript', 'h')`,
    );
    const fileId = db.getDb().exec(`SELECT id FROM files WHERE path = '/repo/a.ts'`)[0]
      .values[0][0] as number;
    db.getDb().run(
      `INSERT INTO imports (file_id, source_path, specifiers, is_default, is_namespace, is_relative)
       VALUES (?, './b', '[]', 0, 0, 1)`,
      [fileId],
    );
    const rows = db.getDb().exec(`SELECT is_relative FROM imports WHERE file_id = ?`, [fileId]);
    assert.equal(rows[0].values[0][0], 1);
  });

  test('no AST table is excluded from reconciliation any more', async () => {
    // The exclusion list is what caused this, and an empty list is the
    // fix. A future entry here re-opens the hole, so it is asserted
    // rather than left to a comment.
    const { EPHEMERAL_TABLES } = await import('./db-schema');
    assert.deepEqual(EPHEMERAL_TABLES, []);
  });

  test('the reconciled schema covers the AST tables', async () => {
    const { RECONCILED_SCHEMA_SQL } = await import('./db-schema');
    for (const table of ['files', 'symbols', 'imports', 'callsites', 'cross_system_edges']) {
      assert.ok(
        RECONCILED_SCHEMA_SQL.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
        `${table} is not in the schema the reconciler is given`,
      );
    }
  });
});
