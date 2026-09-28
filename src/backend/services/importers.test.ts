/**
 * Who imports a file, or a name from it (Phase 32 A2.2), against a real
 * database holding the real parsers' output. Resolution is set by hand (the
 * resolvers are tested on their own); what is under test is that re-exports
 * are stored and followed, for the right names, and that Python's aliases
 * no longer hide the name imported.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-importers-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let importers: typeof import('./importers');

/** file → source, and where each of its import sources resolves. */
const FILES: Record<string, { src: string; resolves?: Record<string, string> }> = {
  'src/validators.ts': { src: 'export function isValidEmail(e: string) { return true }\nexport function validateCreateUser(u: unknown) { return [] }\nfunction internal() {}\n' },
  'src/types.ts': { src: 'export interface User { id: string }\n' },
  'src/index.ts': { src: "export * from './types'\nexport * from './validators'\n", resolves: { './types': 'src/types.ts', './validators': 'src/validators.ts' } },
  'src/named.ts': { src: "export { isValidEmail } from './validators'\n", resolves: { './validators': 'src/validators.ts' } },
  'src/loop-a.ts': { src: "export * from './loop-b'\nexport * from './validators'\n", resolves: { './loop-b': 'src/loop-b.ts', './validators': 'src/validators.ts' } },
  'src/loop-b.ts': { src: "export * from './loop-a'\n", resolves: { './loop-a': 'src/loop-a.ts' } },
  'web/UserList.tsx': { src: "import { validateCreateUser, User } from '@shared'\nexport function UserList() { return null }\n", resolves: { '@shared': 'src/index.ts' } },
  'web/api.ts': { src: "import type { User } from '@shared'\nexport const api = 1\n", resolves: { '@shared': 'src/index.ts' } },
  'web/ns.ts': { src: "import * as shared from '@shared'\nexport const x = shared\n", resolves: { '@shared': 'src/index.ts' } },
  'web/direct.ts': { src: "import { isValidEmail } from '../src/validators'\nexport const d = 1\n", resolves: { '../src/validators': 'src/validators.ts' } },
  'web/viaNamed.ts': { src: "import { isValidEmail } from '../src/named'\nexport const n = 1\n", resolves: { '../src/named': 'src/named.ts' } },
  'web/viaLoop.ts': { src: "import { isValidEmail } from '../src/loop-b'\nexport const l = 1\n", resolves: { '../src/loop-b': 'src/loop-b.ts' } },
  'app/db.py': { src: 'def add_order(o):\n    pass\n\ndef _private():\n    pass\n' },
  'app/routes.py': { src: 'from app.db import add_order as insert_order\n\ndef create(o):\n    insert_order(o)\n', resolves: { 'app.db': 'app/db.py' } },
};

const ROOT = '/repo';
const abs = (rel: string) => `${ROOT}/${rel}`;
const rels = (list: { relativePath: string }[]) => list.map((i) => i.relativePath);

before(async () => {
  const parser = await import('./ast-parser');
  await parser.initParser();
  db = await import('./database');
  importers = await import('./importers');
  await db.initDatabase();
  for (const [rel, f] of Object.entries(FILES)) {
    const parsed = parser.parseVirtualFile(abs(rel), f.src)!;
    db.storeParsedFile({ ...parsed, path: abs(rel), contentHash: rel }, ROOT);
  }
  const d = db.getDb();
  try { d.run('ALTER TABLE imports ADD COLUMN resolved_path TEXT'); } catch { /* exists */ }
  for (const [rel, f] of Object.entries(FILES)) {
    for (const [source, target] of Object.entries(f.resolves ?? {})) {
      d.run(`UPDATE imports SET resolved_path = ? WHERE source_path = ? AND file_id = (SELECT id FROM files WHERE path = ?)`, [abs(target), source, abs(rel)]);
    }
  }
});

describe('re-exports are stored', () => {
  test("a barrel's `export … from` is an import that passes names on", () => {
    const deps = db.getFileDependencies('src/index.ts');
    assert.deepEqual(deps.imports.map((i) => [i.relativePath, i.reexport]).sort(), [['src/types.ts', true], ['src/validators.ts', true]]);
    assert.deepEqual(db.getFileDependencies('src/validators.ts').importedBy.filter((i) => i.reexport).map((i) => i.relativePath).sort(),
      ['src/index.ts', 'src/loop-a.ts', 'src/named.ts'], 'before A2.2 it had no importers through barrels at all');
  });
});

describe('importersOf', () => {
  test('follows a barrel, for the names the file exports: a types-only importer is not a user', () => {
    const found = importers.importersOf('src/validators.ts');
    const userList = found.find((i) => i.relativePath === 'web/UserList.tsx');
    assert.deepEqual(userList, { path: abs('web/UserList.tsx'), relativePath: 'web/UserList.tsx', names: ['validateCreateUser'], possibly: false, via: ['src/index.ts'] });
    assert.equal(found.some((i) => i.relativePath === 'web/api.ts'), false, 'it imports only User, which validators.ts does not export');
  });

  test('barrels are followed, not listed; a direct importer comes first', () => {
    const found = rels(importers.importersOf('src/validators.ts'));
    assert.equal(found[0], 'web/direct.ts');
    for (const barrel of ['src/index.ts', 'src/named.ts', 'src/loop-a.ts', 'src/loop-b.ts']) assert.equal(found.includes(barrel), false, barrel);
  });

  test('a namespace import through a barrel is "possibly"', () => {
    const ns = importers.importersOf('src/validators.ts').find((i) => i.relativePath === 'web/ns.ts');
    assert.equal(ns?.possibly, true);
    assert.deepEqual(ns?.via, ['src/index.ts']);
  });

  test('by name: only files that import that name, through a named re-export too', () => {
    assert.deepEqual(rels(importers.importersOf('src/validators.ts', ['isValidEmail'])).sort(),
      ['web/direct.ts', 'web/ns.ts', 'web/viaLoop.ts', 'web/viaNamed.ts'].sort());
    assert.deepEqual(rels(importers.importersOf('src/validators.ts', ['validateCreateUser'])).sort(), ['web/UserList.tsx', 'web/ns.ts']);
  });

  test('a cycle of barrels ends', () => {
    const viaLoop = importers.importersOf('src/validators.ts', ['isValidEmail']).find((i) => i.relativePath === 'web/viaLoop.ts');
    assert.deepEqual(viaLoop?.via, ['src/loop-b.ts', 'src/loop-a.ts'], 'nearest the importer first');
  });

  test('Python: the original name is recorded, so an aliased import is found by it', () => {
    const [routes] = importers.importersOf('app/db.py', ['add_order']);
    assert.equal(routes?.relativePath, 'app/routes.py');
    assert.deepEqual(routes?.names, ['add_order']);
    assert.deepEqual(importers.importersOf('app/db.py', ['insert_order']), [], 'the alias is a local name, not an export');
  });

  test("Python's exported names: no leading underscore", () => {
    assert.deepEqual([...importers.exportedNames(abs('app/db.py'))], ['add_order']);
  });

  test('getFileDependencies lists who uses a file through re-exports, and which barrels', () => {
    const through = db.getFileDependencies('src/validators.ts').throughReexports;
    assert.deepEqual(through.map((t) => `${t.relativePath} via ${t.via.join(' → ')}`).sort(), [
      'web/UserList.tsx via src/index.ts', 'web/ns.ts via src/index.ts', 'web/viaLoop.ts via src/loop-b.ts → src/loop-a.ts', 'web/viaNamed.ts via src/named.ts',
    ]);
  });
});

describe('the lookup is indexed', () => {
  test('imports.resolved_path has an index once resolution has added the column', () => {
    db.resolveImports(ROOT); // adds the column and the index, as a scan does
    const idx = db.getDb().exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'imports'`)[0]?.values.map((r) => r[0]);
    assert.ok(idx?.includes('idx_imports_resolved'), `indexes: ${idx}`);
  });
});
