import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { moveRulesFromConfig, removeRule, rulesInConfig, rulesOf, setRule } from './architecture-rules';
import { updateProjectConfig } from './project-config-service';

/** A project whose config.json holds the rules Phase 32 wrote there. */
function project(configRules: Array<Record<string, unknown>> = []): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rules-'));
  if (configRules.length) updateProjectConfig(root, { rules: configRules as never });
  return root;
}
const legacy = (id: string) => ({ id, from: 'web/', mayNotImport: 'db/', except: [], because: 'old way', since: '2026-09-01T00:00:00.000Z', by: 'Sam' });
const suiteIds = (root: string, suite: string): string[] => {
  const file = path.join(root, '.codetrellis', 'rules', `${suite}.yaml`);
  return fs.existsSync(file) ? (yaml.parse(fs.readFileSync(file, 'utf8')).rules ?? []).map((r: { id: string }) => r.id) : [];
};

test('a rule still in config.json counts until it is moved; a suite\'s rule with the same id wins', () => {
  const root = project([legacy('old-only'), legacy('both')]);
  setRule(root, { id: 'both', from: 'api/', mayNotImport: 'ui/' }, 'Saif');
  const rules = rulesOf(root);
  assert.deepEqual(rules.map((r) => [r.id, r.suite ?? 'config']), [['both', 'architecture'], ['old-only', 'config']]);
  assert.equal(rules.find((r) => r.id === 'both')?.from, 'api/');
});

test('setting a rule writes it to a suite file and takes it out of the config', () => {
  const root = project([legacy('web-not-db')]);
  setRule(root, { id: 'web-not-db', from: 'web/', mayNotImport: 'db/', because: 'through the API' }, 'Saif');
  assert.deepEqual(suiteIds(root, 'architecture'), ['web-not-db']);
  assert.deepEqual(rulesInConfig(root), []);
  // It kept when it was first set.
  assert.equal(rulesOf(root)[0].since, '2026-09-01T00:00:00.000Z');
});

test('a rule moved to another suite leaves the old one; stopping it takes it out of the file it is in', () => {
  const root = project();
  setRule(root, { id: 'r1', from: 'web/', mayNotImport: 'db/' }, 'Saif');
  setRule(root, { id: 'r1', suite: 'payments', from: 'web/', mayNotImport: 'db/' }, 'Saif');
  assert.deepEqual([suiteIds(root, 'architecture'), suiteIds(root, 'payments')], [[], ['r1']]);
  // Named again without a suite, it stays where it is.
  setRule(root, { id: 'r1', from: 'web/', mayNotImport: 'api/' }, 'Saif');
  assert.deepEqual(suiteIds(root, 'payments'), ['r1']);
  removeRule(root, 'r1');
  assert.deepEqual(rulesOf(root), []);
  assert.throws(() => setRule(root, { id: 'r2', suite: '../x', from: 'web/', mayNotImport: 'db/' }, 'Saif'), /suite must be a short name/);
});

test('moving from the config is everything there, once, kept as written; a rule a suite already has stays as the suite has it', () => {
  const root = project([legacy('a'), legacy('b')]);
  setRule(root, { id: 'b', from: 'kept/', mayNotImport: 'as-is/' }, 'Saif');
  updateProjectConfig(root, { rules: [legacy('a'), legacy('b')] as never });
  assert.deepEqual(moveRulesFromConfig(root), ['a']);
  assert.deepEqual(suiteIds(root, 'architecture'), ['b', 'a']);
  assert.equal(rulesOf(root).find((r) => r.id === 'b')?.from, 'kept/');
  assert.equal(rulesOf(root).find((r) => r.id === 'a')?.by, 'Sam');
  assert.deepEqual(rulesInConfig(root), []);
  assert.deepEqual(moveRulesFromConfig(root), [], 'nothing left to move');
});
