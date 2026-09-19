/**
 * Anchoring an edit to a class member needs the members in the lookup.
 *
 * `getFileSymbols` filters `parent_symbol_id IS NULL`, which is right for a
 * file tree and wrong for resolving a symbol an item names. The TypeScript,
 * Python and PHP parsers store class members as NESTED children, so a plan
 * declaring `edits: [{ symbol: 'save' }]` against `class Store { save() {} }`
 * was answered with "no such symbol". The languages whose parsers flatten
 * members — Go, Ruby, C#, Kotlin, Swift — worked, which is what made this look
 * like a missing feature rather than a bug in four languages.
 *
 * This exercises the QUERY. The overlay's matching is tested separately with an
 * injected lookup, and passed throughout — the filter was the whole defect, so
 * a test that injects its own symbols cannot see it.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-symbols-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

const ROOT = '/repo';
const FILE = '/repo/src/store.ts';

let db: typeof import('./database');

before(async () => {
  db = await import('./database');
  await db.initDatabase();

  // A class with a method, stored the way the TypeScript parser stores it:
  // the member is a CHILD of the class, not a sibling.
  db.storeParsedFile(
    {
      path: FILE,
      language: 'typescript',
      contentHash: 'hash',
      symbols: [
        {
          name: 'Store',
          kind: 'class',
          startLine: 3,
          endLine: 30,
          modifiers: [],
          children: [
            { name: 'save', kind: 'method', startLine: 12, endLine: 18, modifiers: [], children: [] },
          ],
        },
      ],
      imports: [],
      callsites: [],
    } as never,
    ROOT,
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('symbol lookup for edit anchoring (M13)', () => {
  test('the top-level lookup still returns only the top level', () => {
    const names = db.getFileSymbols(FILE).map((s) => s.name);
    assert.deepEqual(names, ['Store'], 'the file-tree lookup is unchanged');
  });

  test('the member-inclusive lookup returns the method, qualified', () => {
    const names = db.getFileSymbolsWithMembers(FILE).map((s) => s.name).sort();
    assert.deepEqual(names, ['Store', 'Store.save']);
  });

  test('the member carries its own line span, not the class span', () => {
    const save = db.getFileSymbolsWithMembers(FILE).find((s) => s.name === 'Store.save');
    assert.ok(save, 'the method is present');
    // The point of anchoring: the marker lands on the method, not on all 27
    // lines of the class.
    assert.equal(save!.startLine, 12);
    assert.equal(save!.endLine, 18);
  });
});
