/**
 * Unit tests for SQL schema extraction and the migration fold (Phase 21).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractSchemaStatements,
  extractSqlSymbols,
  foldMigrations,
  looksLikeMigrationsDir,
  sortMigrations,
  applyMigrationFold,
} from './schema';

describe('DDL statements', () => {
  test('CREATE TABLE, with dialect noise around it', () => {
    const stmts = extractSchemaStatements(`
      CREATE TABLE IF NOT EXISTS billing.orders (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'new'
      );
    `);
    assert.equal(stmts.length, 1);
    assert.equal(stmts[0].action, 'create');
    assert.equal(stmts[0].kind, 'table');
    assert.equal(stmts[0].name, 'orders');
    assert.equal(stmts[0].schema, 'billing');
    // The REFERENCES target is not a second definition.
    assert.ok(!stmts.some((s) => s.name === 'users'));
  });

  test('views, including materialized', () => {
    const stmts = extractSchemaStatements(`
      CREATE VIEW order_list AS SELECT * FROM orders;
      CREATE MATERIALIZED VIEW order_totals AS SELECT 1;
    `);
    assert.deepEqual(stmts.map((s) => s.name).sort(), ['order_list', 'order_totals']);
    assert.ok(stmts.every((s) => s.kind === 'view'));
    assert.ok(stmts.find((s) => s.name === 'order_totals')!.modifiers.includes('materialized'));
  });

  test('CREATE OR REPLACE FUNCTION is a proc, and its body does not confuse the scan', () => {
    const stmts = extractSchemaStatements(`
      CREATE OR REPLACE FUNCTION touch_updated() RETURNS trigger AS $$
      BEGIN
        -- CREATE TABLE decoy (id int);
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    assert.equal(stmts.length, 1);
    assert.equal(stmts[0].kind, 'proc');
    assert.equal(stmts[0].name, 'touch_updated');
  });

  test('CREATE INDEX contributes nothing', () => {
    assert.deepEqual(extractSchemaStatements('CREATE INDEX idx_orders_user ON orders(user_id);'), []);
  });

  test('ALTER, RENAME and multi-target DROP', () => {
    const stmts = extractSchemaStatements(`
      ALTER TABLE orders ADD COLUMN status text;
      ALTER TABLE orders RENAME TO sales_orders;
      DROP TABLE IF EXISTS legacy_a, legacy_b;
    `);
    assert.deepEqual(
      stmts.map((s) => `${s.action}:${s.name}`),
      ['alter:orders', 'rename:orders', 'drop:legacy_a', 'drop:legacy_b'],
    );
    assert.equal(stmts[1].renameTo, 'sales_orders');
  });
});

describe('symbols', () => {
  test('only CREATE defines a symbol', () => {
    const symbols = extractSqlSymbols(`
      CREATE TABLE orders (id int);
      ALTER TABLE orders ADD COLUMN status text;
      DROP TABLE legacy;
    `);
    assert.deepEqual(symbols.map((s) => s.name), ['orders']);
  });

  test('a table symbol spans its definition', () => {
    const symbols = extractSqlSymbols('CREATE TABLE orders (\n  id int,\n  total int\n);\n');
    assert.equal(symbols[0].startLine, 1);
    assert.equal(symbols[0].endLine, 4);
    assert.ok(symbols[0].modifiers.includes('table'));
  });

  test('columns are not symbols', () => {
    const symbols = extractSqlSymbols('CREATE TABLE orders (id int, user_id int, total int);');
    assert.equal(symbols.length, 1);
  });
});

describe('migration fold', () => {
  const migrations = [
    { path: 'db/001_create_orders.sql', sql: 'CREATE TABLE orders (id int);' },
    { path: 'db/002_create_legacy.sql', sql: 'CREATE TABLE legacy_notes (id int);' },
    { path: 'db/014_add_status.sql', sql: 'ALTER TABLE orders ADD COLUMN status text;' },
    { path: 'db/031_drop_legacy.sql', sql: 'DROP TABLE legacy_notes;' },
  ];

  test('a dropped table does not survive the fold', () => {
    const live = foldMigrations(migrations);
    assert.ok(live.has('orders'));
    assert.ok(!live.has('legacy_notes'), 'a table dropped by a later migration is gone');
  });

  test('a table is attributed to the migration that created it', () => {
    const live = foldMigrations(migrations);
    assert.equal(live.get('orders')!.definedIn, 'db/001_create_orders.sql');
    assert.deepEqual(live.get('orders')!.alteredIn, ['db/014_add_status.sql']);
  });

  test('a rename moves the table rather than duplicating it', () => {
    const live = foldMigrations([
      { path: '001.sql', sql: 'CREATE TABLE orders (id int);' },
      { path: '002.sql', sql: 'ALTER TABLE orders RENAME TO sales_orders;' },
    ]);
    assert.ok(!live.has('orders'));
    assert.equal(live.get('sales_orders')!.definedIn, '001.sql');
  });

  test('re-creating keeps the original definer', () => {
    const live = foldMigrations([
      { path: '001.sql', sql: 'CREATE VIEW v AS SELECT 1;' },
      { path: '002.sql', sql: 'CREATE OR REPLACE VIEW v AS SELECT 2;' },
    ]);
    assert.equal(live.get('v')!.definedIn, '001.sql');
  });
});

describe('migration directory detection and ordering', () => {
  test('recognises the common prefix conventions', () => {
    assert.equal(looksLikeMigrationsDir(['001_a.sql', '002_b.sql', '003_c.sql']), true);
    assert.equal(looksLikeMigrationsDir(['20240102030405_a.sql', '20240102030406_b.sql']), true);
    // A stray non-numbered file does not disqualify the directory.
    assert.equal(looksLikeMigrationsDir(['001_a.sql', '002_b.sql', 'README.sql']), true);
  });

  test('rejects an ordinary directory of SQL', () => {
    assert.equal(looksLikeMigrationsDir(['schema.sql', 'seed.sql']), false);
    assert.equal(looksLikeMigrationsDir(['schema.sql']), false);
  });

  test('numeric prefixes sort as numbers, not strings', () => {
    const sorted = sortMigrations([
      { path: 'db/10_ten.sql' },
      { path: 'db/9_nine.sql' },
      { path: 'db/2_two.sql' },
    ]);
    assert.deepEqual(sorted.map((f) => f.path), ['db/2_two.sql', 'db/9_nine.sql', 'db/10_ten.sql']);
  });
});

describe('migration paths on Windows (M17)', () => {
  test('a migrations directory is recognised with backslash separators', () => {
    // These paths come from path.join, so on Windows they use backslashes. A
    // forward-slash-only basename strip left the whole path in place, nothing
    // matched the numeric prefix, and the fold silently never ran — so dropped
    // tables stayed in the graph, on Windows only.
    assert.ok(looksLikeMigrationsDir([
      'C:\\repo\\db\\migrations\\001_create_invoices.sql',
      'C:\\repo\\db\\migrations\\002_create_payments.sql',
    ]));
  });

  test('numeric ordering works with backslash separators', () => {
    const sorted = sortMigrations([
      { path: 'C:\\m\\010_b.sql' },
      { path: 'C:\\m\\9_a.sql' },
    ]);
    assert.deepEqual(sorted.map((f) => f.path), ['C:\\m\\9_a.sql', 'C:\\m\\010_b.sql']);
  });
});

describe('same table name in two schemas (M19)', () => {
  test('billing.orders and analytics.orders are not the same table', () => {
    // Keyed by bare name, the second CREATE folded away as a duplicate of the
    // first and one of the two disappeared from the graph entirely.
    const live = foldMigrations([
      { path: 'db/migrations/001_a.sql', sql: 'CREATE TABLE billing.orders (id INT);' },
      { path: 'db/migrations/002_b.sql', sql: 'CREATE TABLE analytics.orders (id INT);' },
    ]);
    assert.equal(live.size, 2, 'both tables survive the fold');
    assert.ok(live.has('billing.orders'));
    assert.ok(live.has('analytics.orders'));
  });
});

describe('an incremental batch must not resurrect a dropped table (M18)', () => {
  test('the fold needs the whole directory, not the changed file', () => {
    // An incremental scan passes only what changed. Editing the migration that
    // CREATED a table, on its own, used to skip the fold — and storeParsedFile
    // deletes and reinserts that file's rows, so the table a later migration
    // had dropped came back and stayed until a full rescan.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mig-'));
    try {
      fs.writeFileSync(path.join(dir, '001_create_legacy_notes.sql'), 'CREATE TABLE legacy_notes (id INT);');
      fs.writeFileSync(path.join(dir, '031_drop_legacy_notes.sql'), 'DROP TABLE legacy_notes;');
      const read = (f: string): string | null => {
        try { return fs.readFileSync(f, 'utf-8'); } catch { return null; }
      };
      const changedFile = () => ([{
        path: path.join(dir, '001_create_legacy_notes.sql'),
        symbols: [{ name: 'legacy_notes', kind: 'table', startLine: 1, endLine: 1, modifiers: [], children: [] }],
      }] as never as Array<{ path: string; symbols: Array<{ name: string }> }>);

      // What an incremental scan used to pass: the changed file alone.
      const alone = changedFile();
      applyMigrationFold(alone as never, read);
      assert.deepEqual(
        alone[0].symbols.map((s2) => s2.name),
        ['legacy_notes'],
        'batch-only: the dropped table survives — this is the defect',
      );

      // What it passes now: the changed file plus its on-disk siblings, whose
      // symbols are empty because the fold derives the live set from the TEXT.
      const withSiblings = changedFile();
      applyMigrationFold(
        [...withSiblings, { path: path.join(dir, '031_drop_legacy_notes.sql'), symbols: [] }] as never,
        read,
      );
      assert.deepEqual(
        withSiblings[0].symbols.map((s2) => s2.name),
        [],
        'whole directory: the dropped table stays dropped',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
