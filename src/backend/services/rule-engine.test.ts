/**
 * Phase 33 B5 — the engine, per rule: who judges it, whatever its strength.
 *
 * Done when an agent rule reaches the bundle, a finding citing it is held to
 * the contract, and it does not block at warn (end to end in
 * tests/e2e/agent-rules.test.ts; the parts here).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { breaks, checkEdges, parseArchitectureRule, ruleEngine, ruleStatement } from './architecture-rule';
import { diffRules } from './rule-changes';
import { ruleTerms } from './rule-approvals';
import { readRulebook, writeSuite } from './rulebook';
import { ruleCovers } from '../../shared/lib/rule-pattern';

const ledger = () => parseArchitectureRule({
  id: 'money-through-ledger', engine: 'agent', strength: 'warn', in: ['src/'], except: ['src/ledger/'],
  rule: 'Code that moves money records it through services/ledger, never by writing balances directly.',
}).rule!;

test('an agent rule is its words, about its files, judged by an agent', () => {
  const r = ledger();
  assert.equal(r.kind, 'agent');
  assert.equal(ruleEngine(r), 'agent');
  assert.equal(ruleStatement(r), 'in src/ (except src/ledger/): Code that moves money records it through services/ledger, never by writing balances directly.');
  assert.equal(ruleCovers(r, 'src/billing/refund.ts'), true);
  assert.equal(ruleCovers(r, 'src/ledger/post.ts'), false, 'except');
  assert.equal(ruleCovers(r, 'docs/a.md'), false, 'not in');
});

test('no code checks an agent rule: no edge breaks it', () => {
  const r = ledger();
  assert.equal(breaks(r, 'src/billing/refund.ts', 'src/db/balances.ts'), false);
  assert.deepEqual(checkEdges([{ ...r, strength: 'block' }], [{ from: 'src/a.ts', to: 'http:api.stripe.com' }, { from: 'src/a.ts', to: 'src/b.ts' }]), []);
});

test('every other rule\'s engine follows from how it matches; saying another is refused', () => {
  const exact = parseArchitectureRule({ id: 'r', kind: 'package', package: 'npm:stripe', only: ['a/'] }).rule!;
  assert.equal(ruleEngine(exact), 'deterministic');
  const fuzzy = parseArchitectureRule({ id: 'r', kind: 'package', package: { match: 'fuzzy', value: 'npm:stripe' } }).rule!;
  assert.equal(ruleEngine(fuzzy), 'fuzzy');
  assert.equal(parseArchitectureRule({ id: 'r', kind: 'package', package: 'npm:stripe', only: ['a/'], engine: 'deterministic' }).problems.length, 0);
  assert.match(parseArchitectureRule({ id: 'r', kind: 'package', package: 'npm:stripe', only: ['a/'], engine: 'fuzzy' }).problems.join(), /engine fuzzy is a rule whose target says match: fuzzy/);
  assert.match(parseArchitectureRule({ id: 'r', engine: 'model' }).problems.join(), /engine must be deterministic, fuzzy or agent/);
});

test('an agent rule is refused without its words or its files', () => {
  const why = (raw: Record<string, unknown>) => parseArchitectureRule({ id: 'x', engine: 'agent', ...raw }).problems.join(' ');
  assert.match(why({ in: ['src/'] }), /rule must be the words an agent judges by/);
  assert.match(why({ rule: 'Be kind.' }), /in must list the files it is about/);
  assert.match(why({ rule: 'x'.repeat(1001), in: ['src/'] }), /at most 1000/);
  assert.match(why({ rule: 'Be kind.', in: ['../x/'] }), /climb out/);
  assert.match(why({ rule: 'Be kind.', in: ['src/'], kind: 'calls' }), /an agent rule has no kind/);
});

test('the suite file keeps an agent rule as it was written, and reads it back the same', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-agent-'));
  writeSuite(root, 'money', [{ ...ledger(), suite: 'money' }]);
  const yaml = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'money.yaml'), 'utf-8');
  assert.match(yaml, /engine: agent/);
  assert.match(yaml, /rule: Code that moves money/);
  assert.doesNotMatch(yaml, /kind:/);
  const [back] = readRulebook(root).suites[0].rules;
  assert.equal(ruleStatement(back), ruleStatement(ledger()));
  assert.equal(back.strength, 'warn');
});

test('rewording an agent rule, or what it is about, loosens; lowering it loosens; signed terms carry its words', () => {
  const r = ledger();
  assert.equal(diffRules([r], [{ ...r, mayNotImport: 'Money moves through the ledger.' }], [])[0].effect, 'loosens');
  assert.equal(diffRules([r], [{ ...r, in: ['src/billing/'] }], [])[0].effect, 'loosens');
  assert.equal(diffRules([{ ...r, strength: 'block' }], [r], [])[0].effect, 'loosens');
  assert.equal(diffRules([r], [{ ...r, strength: 'block' }], [])[0].effect, 'tightens');
  assert.deepEqual(ruleTerms(r), { from: '**', mayNotImport: r.mayNotImport, except: ['src/ledger/'], strength: 'warn', kind: 'agent', in: ['src/'] });
});

test('a grep rule covers only the files it reads (B2\'s rules in a bundle or a brief)', () => {
  const g = parseArchitectureRule({ id: 'g', kind: 'grep', in: ['src/backend/'], except: ['**/*.test.ts'], mustNot: 'console.log(' }).rule!;
  assert.equal(ruleCovers(g, 'src/backend/server.ts'), true);
  assert.equal(ruleCovers(g, 'src/backend/a/b.test.ts'), false);
  assert.equal(ruleCovers(g, 'src/frontend/app.ts'), false);
});
