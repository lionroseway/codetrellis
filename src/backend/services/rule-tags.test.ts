/**
 * Phase 33 follow-up to B6 — rule tags, and a pipeline stage that selects by
 * them. A rule says `tags: [pci]`; a stage says `rules: { tag: pci }`, and a
 * check `--tag pci`. A tag is a term of the rule: dropping one may take the
 * rule out of a stage, so it loosens, and needs a person's signed approval.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArchitectureRule, tagsOf } from './architecture-rule';
import { ruleTerms } from './rule-approvals';
import { diffRules } from './rule-changes';
import { parseScope, scopeRules, scopeWords } from './rule-scope';
import { parsePipeline, stageScope, stageWords } from './pipeline';
import { readRulebook, writeSuite } from './rulebook';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';

const rule = (id: string, extra: Record<string, unknown> = {}): ArchitectureRule => {
  const { rule: r, problems } = parseArchitectureRule({ id, kind: 'calls', calls: 'http:api.stripe.com', only: ['src/payments/'], strength: 'block', ...extra });
  assert.deepEqual(problems, []);
  return r!;
};

test('a rule carries its tags, sorted and once each, in every kind; tags that are not short slugs are refused', () => {
  assert.deepEqual(rule('a', { tags: ['pci', 'fast', 'pci'] }).tags, ['fast', 'pci']);
  assert.deepEqual(rule('b', { tags: 'pci' }).tags, ['pci'], 'one tag may be written alone');
  assert.equal('tags' in rule('c'), false, 'no tags, no field');
  assert.equal('tags' in rule('d', { tags: [] }), false);
  const grep = parseArchitectureRule({ id: 'g', kind: 'grep', in: ['src/'], mustNot: 'console.log', tags: ['hygiene'] }).rule!;
  assert.deepEqual(grep.tags, ['hygiene']);
  const imports = parseArchitectureRule({ id: 'i', from: 'web/', mayNotImport: 'db/', tags: ['layers'] }).rule!;
  assert.deepEqual(imports.tags, ['layers']);
  for (const bad of [['PCI'], ['two words'], [''], 'x'.repeat(40), Array.from({ length: 11 }, (_, i) => `t${i}`), [1]]) {
    const { rule: r, problems } = parseArchitectureRule({ id: 'x', from: 'web/', mayNotImport: 'db/', tags: bad });
    assert.equal(r, null, JSON.stringify(bad));
    assert.match(problems.join(), /tags are short slugs/);
  }
  assert.equal(tagsOf(['a-b', 'c1']) !== null, true);
});

test('a suite file keeps a rule\'s tags, and reads them back', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-tags-'));
  writeSuite(root, 'payments', [{ ...rule('stripe-only-payments', { tags: ['pci'] }), suite: 'payments' }]);
  assert.match(fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'payments.yaml'), 'utf-8'), /tags:\n\s+- pci/);
  assert.deepEqual(readRulebook(root).suites[0].rules[0].tags, ['pci']);
});

test('tags are signed terms: absent when a rule has none, so approvals signed before them read the same', () => {
  assert.equal('tags' in ruleTerms(rule('a'))!, false);
  assert.deepEqual(ruleTerms(rule('a', { tags: ['pci', 'fast'] }))!.tags, ['fast', 'pci']);
});

test('dropping a tag loosens the rule; adding one tightens it; the same tags change nothing', () => {
  const tagged = rule('stripe', { tags: ['pci'] });
  const [dropped] = diffRules([tagged], [rule('stripe')], []);
  assert.equal(dropped.effect, 'loosens');
  assert.match(dropped.words, /needs a person's approval/);
  const [added] = diffRules([rule('stripe')], [rule('stripe', { tags: ['pci', 'fast'] })], []);
  assert.equal(added.effect, 'tightens');
  const [swapped] = diffRules([tagged], [rule('stripe', { tags: ['fast'] })], []);
  assert.equal(swapped.effect, 'loosens', 'pci dropped');
  assert.deepEqual(diffRules([tagged], [rule('stripe', { tags: ['pci'] })], []), []);
});

test('a check selects the rules with any of the tags it names', () => {
  const rules = [rule('a', { tags: ['pci'] }), rule('b', { tags: ['fast', 'pci'] }), rule('c', { tags: ['fast'] }), rule('d')];
  const scope = parseScope({ tag: 'pci' });
  assert.deepEqual(scopeRules(rules, scope).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(scopeRules(rules, parseScope({ tag: 'pci,fast' })).map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(scopeRules(rules, parseScope({ tag: 'pci', rule: 'b,c' })).map((r) => r.id), ['b'], 'scopes given together all apply');
  assert.equal(scopeWords(scope), 'tag pci');
  assert.equal(scopeWords(parseScope({ tag: ['pci', 'fast'] })), 'tags pci, fast');
});

test('a pipeline stage selects by tag, and says so', () => {
  const { pipeline, problems } = parsePipeline('stages:\n  - id: pci\n    rules: { tag: [pci, payments], strength: block }\n  - id: rest\n');
  assert.deepEqual(problems, []);
  const [pci] = pipeline!.stages;
  assert.deepEqual(pci.rules.tag, ['pci', 'payments']);
  assert.deepEqual(stageScope(pci), { strength: 'block', tag: 'pci,payments' });
  assert.equal(stageWords(pci), 'pci: block-strength rules tagged pci or payments');
  assert.match(parsePipeline('stages:\n  - id: x\n    rules: { label: pci }\n').problems.join(), /selects by suite, engine, strength, id or tag, not label/);
});
