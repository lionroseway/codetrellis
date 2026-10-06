import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingRuns, findingHover, latestRun, openFindings, placeFindings, type RunFinding, type RunLike } from './open-findings';
import { importLine } from './import-line';

const f = (path: string, imports = 'npm:stripe', failing = true): RunFinding => ({
  rule: 'stripe-via-wrapper', suite: 'payments', path, imports, strength: failing ? 'block' : 'warn', failing,
  words: 'only src/payments.ts may import npm:stripe', fix: 'use src/payments.ts instead',
});
const run = (id: string, at: number, findings: RunFinding[], over: Partial<RunLike> = {}): RunLike => ({
  id, at, who: 'Sam Lee', ranIn: 'the app', scope: null,
  outcome: { ok: !findings.some((x) => x.failing), blocks: findings.filter((x) => x.failing).length, warns: findings.filter((x) => !x.failing).length },
  findings, ...over,
});

test('open findings are the latest run\'s: a later run that no longer finds one has fixed it, whoever ran it', () => {
  const ci = run('ci', 1, [f('src/api.ts'), f('src/cart.ts')], { who: 'ci for Build bot', ranIn: 'GitHub Actions' });
  const mine = run('mine', 2, [f('src/cart.ts')]);
  assert.equal(latestRun([ci, mine])?.id, 'mine');
  assert.equal(latestRun([]), null);
  const open = openFindings([ci, mine], ['src/api.ts', 'src/cart.ts']);
  assert.equal(open?.run.id, 'mine');
  assert.deepEqual(open?.findings.map((x) => x.path), ['src/cart.ts']);
  assert.deepEqual(openFindings([ci, mine], ['src/api.ts'])?.findings, []);
  assert.equal(openFindings([], ['src/api.ts']), null);
});

test('a finding is placed on the line that imports it, in a window of the file too, and left off when the import is gone', () => {
  const text = "// payments are charged through the wrapper\nimport { cart } from './cart';\nimport Stripe from 'stripe';\n";
  const placed = placeFindings([f('src/api.ts'), f('src/api.ts', 'src/db/client.ts')], 'r1', text);
  assert.deepEqual(placed.map((p) => [p.line, p.imports, p.runId]), [[3, 'npm:stripe', 'r1']]);
  assert.equal(placeFindings([f('src/api.ts')], 'r1', text, 40)[0].line, 42);
  assert.deepEqual(placeFindings([f('src/api.ts')], 'r1', 'const stripe = 1;\n'), []);
});

test('the shared importLine is the one SARIF and the terminal use: same answers', () => {
  assert.equal(importLine("// db/client is not used\nimport { c } from '../db/client';\n", 'db/client.ts'), 2);
  assert.equal(importLine('package main\n\nimport (\n  "fmt"\n)\nimport "example.com/ledger"\n', 'internal/ledger/ledger.go'), 6);
  assert.equal(importLine('import "github.com/stripe/stripe-go"\n', 'go:github.com/stripe/stripe-go'), 1);
  assert.equal(importLine('const s = "client";\n', 'db/client.ts'), null);
});

test('a finding in a line says glyph, rule, strength, the rule\'s words and the fix', () => {
  assert.equal(findingHover(f('src/api.ts')), '✗ stripe-via-wrapper (block): only src/payments.ts may import npm:stripe → use src/payments.ts instead');
  assert.equal(findingHover({ ...f('src/api.ts', 'npm:stripe', false), fix: null }), '⚠ stripe-via-wrapper (warn): only src/payments.ts may import npm:stripe');
});

test('the phone hears the latest run from each place when it blocks, newest first; a place whose latest passes needs nobody', () => {
  const runs = [
    run('ci-old', 1, [f('src/api.ts')], { who: 'ci for Build bot', ranIn: 'GitHub Actions' }),
    run('ci-new', 5, [], { who: 'ci for Build bot', ranIn: 'GitHub Actions' }),
    run('agent', 3, [f('src/cart.ts')], { who: 'claude-code', ranIn: 'claude-code\'s session' }),
    run('mine-payments', 4, [f('src/api.ts')], { scope: 'the payments suite' }),
    run('mine-all', 2, [f('src/api.ts', 'npm:stripe', false)]),
  ];
  assert.deepEqual(blockingRuns(runs).map((r) => r.id), ['mine-payments', 'agent']);
  assert.deepEqual(blockingRuns(runs, 1).map((r) => r.id), ['mine-payments']);
});

test('R6: a symbol is found by its name, through a barrel too; a namespace or default import by its module', () => {
  const text = "import { formatMoney } from '../money';\nimport { createCharge, refund } from '../payments';\nimport * as charge from '../payments/charge';\n";
  assert.equal(importLine(text, 'src/payments/charge.ts#createCharge'), 2);
  assert.equal(importLine(text, 'src/payments/charge.ts#*'), 3);
  assert.equal(importLine(text, 'src/payments/charge.ts#voidCharge'), null);
});
