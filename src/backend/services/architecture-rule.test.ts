/**
 * Phase 32 A7.1 — an architecture rule, read and checked.
 *
 * Sam writes "web/ may not import db/, except db/types.ts, because web talks
 * to db through the API". A file under web/ importing db/client.ts breaks
 * it; importing db/types.ts does not, nor does anything under db/ itself.
 * Patterns are folders, files or globs; a rule written badly is refused
 * with why, and one that climbs out of the project is never kept.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breachWords, breaks, checkEdges, inPattern, parseArchitectureRule, ruleWords } from './architecture-rule';

const RULE = parseArchitectureRule({
  id: 'web-not-db', from: 'web/', mayNotImport: 'db/', except: ['db/types.ts'], because: 'web talks to db through the API', by: 'Sam Lee',
}).rule!;

test('a folder, a file and a glob are each a pattern', () => {
  assert.equal(inPattern('web/', 'web/reports.ts'), true);
  assert.equal(inPattern('web/', 'webby/x.ts'), false);
  assert.equal(inPattern('web', 'web/reports.ts'), true, 'a folder named without its slash');
  assert.equal(inPattern('db/types.ts', 'db/types.ts'), true);
  assert.equal(inPattern('db/types.ts', 'db/types.tsx'), false);
  assert.equal(inPattern('src/**/ui/**', 'src/billing/ui/Form.tsx'), true);
  assert.equal(inPattern('src/**/ui/**', 'src/billing/api/charge.ts'), false);
  assert.equal(inPattern('src/*.ts', 'src/index.ts'), true);
  assert.equal(inPattern('src/*.ts', 'src/a/index.ts'), false);
});

test('web/ importing db/ breaks the rule; its door, and db/ itself, do not', () => {
  assert.equal(breaks(RULE, 'web/reports.ts', 'db/client.ts'), true);
  assert.equal(breaks(RULE, 'web/reports.ts', 'db/types.ts'), false, 'the door through the wall');
  assert.equal(breaks(RULE, 'db/client.ts', 'db/pool.ts'), false, 'db/ within itself');
  assert.equal(breaks(RULE, 'api/handler.ts', 'db/client.ts'), false, 'not from web/');
  assert.deepEqual(checkEdges([RULE], [
    { from: 'web/reports.ts', to: 'db/client.ts' },
    { from: 'web/reports.ts', to: 'api/client.ts' },
    { from: 'web/admin/users.ts', to: 'db/users.ts' },
  ]), [
    { rule: 'web-not-db', from: 'web/reports.ts', to: 'db/client.ts' },
    { rule: 'web-not-db', from: 'web/admin/users.ts', to: 'db/users.ts' },
  ]);
});

test('in words: the rule, and a breach of it', () => {
  assert.equal(ruleWords(RULE), 'web/ may not import db/ (except db/types.ts): web talks to db through the API');
  assert.equal(breachWords(RULE, { from: 'web/reports.ts', to: 'db/client.ts' }),
    'web/reports.ts imports db/client.ts, which the rule “web/ may not import db/” forbids: web talks to db through the API');
});

test('a rule written badly is refused with why; one that climbs out of the project is never kept', () => {
  assert.deepEqual(parseArchitectureRule({ id: 'Web Not DB', from: '', mayNotImport: '/etc/' }).problems, [
    'id must be a short slug, like web-not-db',
    'from must be a folder or a pattern, like web/',
    'mayNotImport must be relative to the project, like web/',
  ]);
  assert.deepEqual(parseArchitectureRule({ id: 'x', from: '../web/', mayNotImport: 'db/' }).problems, ['from may not climb out of the project']);
  assert.deepEqual(parseArchitectureRule({ id: 'x', from: 'web/', mayNotImport: 'web/' }).problems, ['from and mayNotImport must differ']);
  assert.deepEqual(parseArchitectureRule({ id: 'x', from: 'web/', mayNotImport: 'db/', except: 'db/types.ts' }).problems, ['except must be a list of files or patterns']);
  assert.equal(parseArchitectureRule({ id: 'x', from: './web/', mayNotImport: 'db/' }).rule!.from, 'web/');
});
