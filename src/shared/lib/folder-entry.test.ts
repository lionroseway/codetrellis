/**
 * Phase 33 R8 — a folder rule: what the files in a folder are, read from each
 * file's own fact, and said in words. Written for this repository's own
 * convention (services are `*-service.ts`), and checked against its files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exportCount, fileFact, folderProblem, folderWords, isFileFact, nameMatches, parseFileFact } from './folder-entry';
import { breaks, checkEdges, parseArchitectureRule, ruleStatement } from '../../backend/services/architecture-rule';

test('a file\'s fact is its name and how many names it exports, or ? when its language does not say', () => {
  assert.equal(fileFact('src/backend/services/plan-service.ts', 3), 'file:plan-service.ts:3');
  assert.equal(fileFact('scripts/run.sh', null), 'file:run.sh:?');
  assert.deepEqual(parseFileFact('file:plan-service.ts:3'), { name: 'plan-service.ts', exports: 3 });
  assert.equal(isFileFact('file:a.ts:?'), true);
  assert.equal(isFileFact('src/a.ts'), false);
  assert.equal(isFileFact('npm:stripe'), false);
  assert.equal(nameMatches('*-service.ts', 'plan-service.ts'), true);
  assert.equal(nameMatches('*-service.ts', 'plan-service.test.ts'), false);
});

test('names are counted as a reader would: export-marked in TypeScript, public in Python, unknown elsewhere', () => {
  const sym = (name: string, ...modifiers: string[]) => ({ name, modifiers });
  assert.equal(exportCount('typescript', [sym('a', 'export'), sym('b'), sym('A.m', 'export')]), 1);
  assert.equal(exportCount('python', [sym('charge'), sym('_helper'), sym('Client.post')]), 1);
  assert.equal(exportCount('go', [sym('Post')]), null);
});

test('what is wrong with a file, in words; a file that holds says nothing', () => {
  const terms = { files: ['*-service.ts'], kinds: ['ts'], exports: 'one' as const };
  assert.equal(folderProblem(terms, 'file:plan-service.ts:1'), null);
  assert.equal(folderProblem(terms, 'file:rulebook.ts:4'), 'is named rulebook.ts, not *-service.ts');
  assert.equal(folderProblem(terms, 'file:plan-service.js:1'), 'is a .js file, not .ts');
  assert.equal(folderProblem(terms, 'file:plan-service.ts:2'), 'exports 2 names, not one');
  assert.equal(folderProblem(terms, 'file:plan-service.ts:?'), null);
  assert.equal(folderWords('src/backend/services/', terms), 'files in src/backend/services/ are .ts files, are named *-service.ts and export one thing each');
});

test('the folder rule reads as the design writes it, is refused when it says nothing, and judges only its folder', () => {
  const services = parseArchitectureRule({
    id: 'services-are-services', kind: 'folder', folder: 'src/backend/services/', files: '*-service.ts', strength: 'warn',
    guide: 'One service per file, named for its domain; pure helpers go in lib/.',
  }).rule!;
  assert.equal(services.kind, 'folder');
  assert.deepEqual(services.files, ['*-service.ts']);
  assert.equal(services.guide, 'One service per file, named for its domain; pure helpers go in lib/.');
  assert.equal(ruleStatement(services), 'files in src/backend/services/ are named *-service.ts');
  assert.equal(breaks(services, 'src/backend/services/rulebook.ts', 'file:rulebook.ts:4'), true);
  assert.equal(breaks(services, 'src/backend/services/plan-service.ts', 'file:plan-service.ts:9'), false);
  assert.equal(breaks(services, 'src/frontend/lib/rulebook.ts', 'file:rulebook.ts:4'), false);
  assert.equal(breaks(services, 'src/backend/services/rulebook.ts', 'npm:stripe'), false);
  assert.deepEqual(checkEdges([services], [{ from: 'src/backend/services/rulebook.ts', to: 'file:rulebook.ts:4' }]),
    [{ rule: 'services-are-services', from: 'src/backend/services/rulebook.ts', to: 'folder:is named rulebook.ts, not *-service.ts' }]);
  assert.match(parseArchitectureRule({ id: 'x', kind: 'folder', folder: 'src/' }).problems.join(' '), /files, kinds or exports/);
  assert.match(parseArchitectureRule({ id: 'x', kind: 'folder', folder: 'src/', files: 'a/b.ts' }).problems.join(' '), /name patterns/);
  assert.match(parseArchitectureRule({ id: 'x', kind: 'folder', folder: 'src/', exports: 'two' }).problems.join(' '), /exports may only be one/);
  // An imports rule never reads a file's fact as a file in its folder.
  const imports = parseArchitectureRule({ id: 'web-not-db', from: 'src/', mayNotImport: 'file:' }).rule!;
  assert.equal(breaks(imports, 'src/a.ts', 'file:a.ts:1'), false);
});

test('this repository\'s convention can be written and checked: its services are *-service.ts, and the rest are named', () => {
  const services = parseArchitectureRule({ id: 'services-are-services', kind: 'folder', folder: 'src/backend/services/', files: ['*-service.ts', '*.test.ts'], kinds: ['ts'] }).rule!;
  const dir = path.join(process.cwd(), 'src', 'backend', 'services');
  const facts = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile())
    .map((d) => ({ from: `src/backend/services/${d.name}`, to: fileFact(d.name, null) }));
  const breaches = checkEdges([services], facts);
  // The services themselves hold; the helpers beside them are named, each with why.
  assert.ok(facts.some((f) => f.from.endsWith('/plan-service.ts')));
  assert.ok(!breaches.some((b) => b.from.endsWith('-service.ts')));
  const rulebook = breaches.find((b) => b.from === 'src/backend/services/rulebook.ts');
  assert.equal(rulebook?.to, 'folder:is named rulebook.ts, not *-service.ts or *.test.ts');
  assert.ok(breaches.length > 10, `the debt is said: ${breaches.length} files`);
});
