/**
 * Unit tests for SQL table-reference extraction (Phase 21).
 *
 * The hard cases below are the ones that decided the implementation
 * approach. During design they were run against Python's `sqlglot`
 * (which got all nine right) and against `sql-parser-cst`; this suite
 * holds the tokenizer to the same answers, so any regression against
 * that bar is visible.
 *
 * The fragment cases matter just as much: embedded SQL in application
 * code is usually not a complete statement, and a strict parser refuses
 * most of them outright.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractTableRefs, looksLikeSql } from './refs';

const tablesOf = (sql: string): string[] =>
  [...new Set(extractTableRefs(sql).map((r) => r.table))].sort();

const opsOf = (sql: string): string[] =>
  extractTableRefs(sql)
    .map((r) => `${r.op}:${r.table}`)
    .sort();

describe('lexical noise — the cases naive regex gets wrong', () => {
  test('a table named in a line comment is not a reference', () => {
    assert.deepEqual(tablesOf('-- SELECT * FROM ghost_table\nSELECT * FROM orders'), ['orders']);
  });

  test('a table named in a block comment is not a reference', () => {
    assert.deepEqual(tablesOf('/* FROM ghost_table */ SELECT * FROM orders'), ['orders']);
  });

  test('a table named inside a string literal is not a reference', () => {
    assert.deepEqual(tablesOf("SELECT 'from fake_table' AS s FROM orders"), ['orders']);
  });

  test('a CTE alias is not a table', () => {
    const sql = `WITH recent AS (SELECT * FROM orders WHERE created_at > now())
                 SELECT * FROM recent JOIN users ON users.id = recent.user_id`;
    assert.deepEqual(tablesOf(sql), ['orders', 'users']);
  });

  test('multiple and recursive CTEs are all excluded', () => {
    const sql = `WITH RECURSIVE tree AS (SELECT * FROM nodes),
                      flat AS (SELECT * FROM tree)
                 SELECT * FROM flat, edges`;
    assert.deepEqual(tablesOf(sql), ['edges', 'nodes']);
  });

  test('a derived table contributes only its inner tables', () => {
    assert.deepEqual(tablesOf('SELECT * FROM (SELECT id FROM orders) AS o'), ['orders']);
  });

  test('a table function in FROM is not a table', () => {
    assert.deepEqual(tablesOf('SELECT * FROM generate_series(1, 10) g, orders'), ['orders']);
  });
});

describe('shapes', () => {
  test('schema-qualified names keep the schema and use the bare name', () => {
    const refs = extractTableRefs('SELECT * FROM billing.orders o WHERE o.id = 1');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].table, 'orders');
    assert.equal(refs[0].schema, 'billing');
    assert.equal(refs[0].raw, 'billing.orders');
  });

  test('quoted identifiers are unquoted and case-folded for matching', () => {
    const refs = extractTableRefs('SELECT * FROM "Orders" WHERE id = 1');
    assert.equal(refs[0].table, 'orders');
    assert.equal(refs[0].raw, 'Orders');
  });

  test('comma joins yield every table', () => {
    assert.deepEqual(
      tablesOf('SELECT * FROM orders, users WHERE orders.user_id = users.id'),
      ['orders', 'users'],
    );
  });

  test('aliases are not mistaken for tables', () => {
    assert.deepEqual(tablesOf('SELECT * FROM orders o JOIN users AS u ON u.id = o.user_id'), [
      'orders',
      'users',
    ]);
  });

  test('a table joined twice is reported once', () => {
    const refs = extractTableRefs(
      'SELECT * FROM orders a JOIN orders b ON a.parent_id = b.id',
    );
    assert.equal(refs.length, 1);
  });
});

describe('read vs write', () => {
  test('SELECT reads', () => {
    assert.deepEqual(opsOf('SELECT * FROM orders'), ['read:orders']);
  });

  test('INSERT INTO writes, and its SELECT source reads', () => {
    assert.deepEqual(opsOf('INSERT INTO audit_log (msg) SELECT msg FROM orders'), [
      'read:orders',
      'write:audit_log',
    ]);
  });

  test('UPDATE writes its target and reads its FROM', () => {
    assert.deepEqual(
      opsOf("UPDATE orders SET status = 'x' FROM users WHERE users.id = orders.user_id"),
      ['read:users', 'write:orders'],
    );
  });

  test('DELETE FROM writes — a bare FROM would otherwise read', () => {
    assert.deepEqual(opsOf('DELETE FROM orders WHERE id = 1'), ['write:orders']);
  });

  test('TRUNCATE writes, with or without the TABLE keyword', () => {
    assert.deepEqual(opsOf('TRUNCATE TABLE orders'), ['write:orders']);
    assert.deepEqual(opsOf('TRUNCATE orders'), ['write:orders']);
  });

  test('a later SELECT does not inherit an earlier DELETE', () => {
    assert.deepEqual(opsOf('DELETE FROM a; SELECT * FROM b'), ['read:b', 'write:a']);
  });
});

describe('fragments — how embedded SQL actually looks', () => {
  // A strict SQL parser rejects most of these. Measured during design:
  // sql-parser-cst refuses the %s, ${} and truncated forms outright.
  const fragments: Array<[string, string]> = [
    ['driver ?', 'SELECT * FROM orders WHERE id = ?'],
    ['numbered $1', 'SELECT o.id FROM orders o WHERE o.user_id = $1'],
    ['psycopg %s', 'INSERT INTO orders (user_id, total) VALUES (%s, %s)'],
    ['named :param', 'UPDATE orders SET status = :status WHERE id = :id'],
    ['at-param', 'SELECT * FROM orders WHERE id = @id'],
    ['template ${}', 'SELECT * FROM orders WHERE id = ${id}'],
    ['truncated', 'SELECT * FROM orders WHERE '],
  ];

  for (const [label, sql] of fragments) {
    test(`${label} still yields its table`, () => {
      assert.deepEqual(tablesOf(sql), ['orders'], sql);
    });
  }

  test('a %s placeholder does not swallow the table name', () => {
    assert.deepEqual(opsOf('INSERT INTO orders (user_id) VALUES (%s)'), ['write:orders']);
  });
});

describe('looksLikeSql', () => {
  test('accepts real statements', () => {
    for (const sql of [
      'SELECT id FROM orders',
      'INSERT INTO orders VALUES (1)',
      "UPDATE orders SET status = 'x'",
      'DELETE FROM orders WHERE id = 1',
      'WITH x AS (SELECT 1) SELECT * FROM x',
    ]) {
      assert.equal(looksLikeSql(sql), true, sql);
    }
  });

  test('rejects prose and short strings', () => {
    for (const s of [
      'delete from the list of users',
      'select an option',
      'from',
      '',
      'SELECT',
      'insert into the form',
    ]) {
      assert.equal(looksLikeSql(s), false, JSON.stringify(s));
    }
  });
});
