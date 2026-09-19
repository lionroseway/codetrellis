/**
 * Unit tests for embedded-SQL extraction (Phase 21).
 *
 * The samples are written the way each language actually writes queries,
 * because the whole premise of the one-scanner approach is that the only
 * thing varying between languages is the quoting style.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractEmbeddedSql } from './embedded';

const tablesOf = (src: string): string[] =>
  [...new Set(extractEmbeddedSql(src).map((c) => c.urlPattern!))].sort();

const opsOf = (src: string): string[] =>
  extractEmbeddedSql(src)
    .map((c) => `${(c.method ?? '').toLowerCase()}:${c.urlPattern}`)
    .sort();

describe('per-language quoting styles', () => {
  test('Go raw string (backticks)', () => {
    const src = [
      'func list(db *sql.DB) {',
      '\trows, _ := db.Query(`SELECT id, total FROM orders WHERE user_id = $1`)',
      '}',
    ].join('\n');
    assert.deepEqual(tablesOf(src), ['orders']);
  });

  test('Go double-quoted with a placeholder', () => {
    assert.deepEqual(
      tablesOf('db.Exec("INSERT INTO orders (user_id, total) VALUES ($1, $2)")'),
      ['orders'],
    );
  });

  test('Python triple-quoted, spanning lines', () => {
    const src = [
      'QUERY = """',
      '    SELECT o.id',
      '    FROM orders o',
      '    JOIN users u ON u.id = o.user_id',
      '"""',
    ].join('\n');
    assert.deepEqual(tablesOf(src), ['orders', 'users']);
  });

  test('Python %s placeholders', () => {
    assert.deepEqual(
      opsOf('cursor.execute("INSERT INTO orders (user_id, total) VALUES (%s, %s)")'),
      ['write:orders'],
    );
  });

  test('TypeScript template literal with interpolation', () => {
    assert.deepEqual(
      tablesOf('const rows = await sql`SELECT * FROM orders WHERE id = ${id}`;'),
      ['orders'],
    );
  });

  test('Java text block', () => {
    const src = [
      'String q = """',
      '    SELECT * FROM orders WHERE status = ?',
      '    """;',
    ].join('\n');
    assert.deepEqual(tablesOf(src), ['orders']);
  });

  test('PHP single-quoted', () => {
    assert.deepEqual(
      tablesOf("$stmt = $pdo->prepare('SELECT * FROM orders WHERE id = :id');"),
      ['orders'],
    );
  });
});

describe('read vs write attribution', () => {
  test('a file that reads one table and writes another reports both', () => {
    const src = [
      'db.Query("SELECT * FROM orders")',
      'db.Exec("INSERT INTO audit_log (msg) VALUES ($1)")',
    ].join('\n');
    assert.deepEqual(opsOf(src), ['read:orders', 'write:audit_log']);
  });

  test('the same query in three places is one reference', () => {
    const src = [
      'db.Query("SELECT * FROM orders WHERE id = $1")',
      'db.Query("SELECT * FROM orders WHERE id = $1")',
      'db.Query("SELECT * FROM orders WHERE user_id = $1")',
    ].join('\n');
    assert.equal(extractEmbeddedSql(src).length, 1);
  });
});

describe('restraint', () => {
  test('ordinary strings produce nothing', () => {
    const src = [
      'log.Println("failed to select from the list")',
      'const msg = "delete from your cart";',
      'label = "Insert into the form below"',
      'title := "Orders"',
    ].join('\n');
    assert.deepEqual(extractEmbeddedSql(src), []);
  });

  test('a file with no strings at all produces nothing', () => {
    assert.deepEqual(extractEmbeddedSql('func main() { x := 1 + 2 }'), []);
  });

  test('line numbers point at the literal', () => {
    const src = ['package main', '', 'var q = "SELECT * FROM orders WHERE id = $1"'].join('\n');
    const found = extractEmbeddedSql(src);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 3);
  });

  test('the snippet is carried for display', () => {
    const found = extractEmbeddedSql('db.Query("SELECT * FROM orders")');
    assert.match(found[0].sqlText!, /SELECT \* FROM orders/);
  });
});
