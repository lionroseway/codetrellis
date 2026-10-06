/**
 * Phase 33 R6 — a named export as a symbol rule names it, and the imports
 * that match it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSymbolEntry, splitSymbol, symbolEntry, symbolMatches, symbolProblem } from './symbol-entry';
import { ruleCovers } from './rule-pattern';

test('a symbol entry is a file and a name, never a package or a plain path', () => {
  assert.equal(symbolEntry('src/payments/charge.ts', 'createCharge'), 'src/payments/charge.ts#createCharge');
  assert.equal(isSymbolEntry('src/payments/charge.ts#createCharge'), true);
  assert.equal(isSymbolEntry('src/payments/charge.ts'), false);
  assert.equal(isSymbolEntry('npm:stripe'), false);
  assert.equal(isSymbolEntry('npm:stripe#x'), false);
  assert.deepEqual(splitSymbol('a/b.ts#default'), { file: 'a/b.ts', name: 'default' });
  assert.equal(splitSymbol('a/b.ts'), null);
});

test('what a rule may name, and why not', () => {
  assert.equal(symbolProblem('src/payments/charge.ts#createCharge'), null);
  assert.match(symbolProblem('createCharge') ?? '', /a file and a name/);
  assert.match(symbolProblem('/abs/a.ts#b') ?? '', /relative to the project/);
  assert.match(symbolProblem('a.ts#*') ?? '', /one export/);
});

test('an import matches the rule\'s symbol by file and name, or as the whole module', () => {
  const rule = 'src/payments/charge.ts#createCharge';
  assert.equal(symbolMatches(rule, 'src/payments/charge.ts#createCharge'), true);
  assert.equal(symbolMatches(rule, 'src/payments/charge.ts#*'), true);
  assert.equal(symbolMatches(rule, 'src/payments/charge.ts#refund'), false);
  assert.equal(symbolMatches(rule, 'src/payments/index.ts#createCharge'), false);
});

test('a symbol rule is about its file, the files that may, and the files under it in the same language', () => {
  const rule = { kind: 'symbol', from: '**', mayNotImport: 'src/payments/charge.ts#createCharge', only: ['src/payments/'] };
  assert.equal(ruleCovers(rule, 'src/payments/charge.ts'), true);
  assert.equal(ruleCovers(rule, 'src/payments/index.ts'), true);
  assert.equal(ruleCovers(rule, 'src/api.ts'), true);
  assert.equal(ruleCovers(rule, 'scripts/charge.py'), false);
  assert.equal(ruleCovers(rule, 'README.md'), false);
});
