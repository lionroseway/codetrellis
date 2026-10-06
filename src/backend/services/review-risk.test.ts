import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskOf, riskOrder, rulesHolding, type RiskInputs } from './review-risk';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';

const none: RiskInputs = { dependents: 0, tests: null, rules: [], otherWork: [] };

test('failing tests outrank a block rule, which outranks other work, which outranks dependents; ties go by path', () => {
  const inputs: Record<string, RiskInputs> = {
    'web/many-users.ts': { ...none, dependents: 12 },
    'web/rule.ts': { ...none, rules: [{ id: 'web-not-db', strength: 'block' }] },
    'web/failing.ts': { ...none, tests: 'failing' as never },
    'web/shared.ts': { ...none, otherWork: ['billing-v2'] },
    'web/b-quiet.ts': none,
    'web/a-quiet.ts': none,
  };
  const order = riskOrder(Object.keys(inputs), (f) => inputs[f]);
  assert.deepEqual(order.map((r) => r.path), ['web/failing.ts', 'web/rule.ts', 'web/shared.ts', 'web/many-users.ts', 'web/a-quiet.ts', 'web/b-quiet.ts']);
  // Stable: the same inputs, the same order, whatever order the files came in.
  assert.deepEqual(riskOrder([...Object.keys(inputs)].reverse(), (f) => inputs[f]).map((r) => r.path), order.map((r) => r.path));
});

test('each file says why it is where it is', () => {
  assert.equal(riskOf('a.ts', { dependents: 3, tests: 'stale', rules: [{ id: 'r1', strength: 'warn' }], otherWork: ['billing-v2', 'auth-fix'] }).why,
    'its tests are older than the code · in the scope of r1 (warn) · also changed in billing-v2, auth-fix · imported by 3 files');
  assert.equal(riskOf('a.ts', { ...none, dependents: 12, tests: 'failing' as never }).why, 'imported by 12 files · its tests fail');
  assert.equal(riskOf('a.ts', none).why, 'nothing depends on it, no rule holds it, and no other work touches it');
});

test('a rule holds the files it judges and the ones it protects; a guide holds none', () => {
  const rule = (id: string, strength: ArchitectureRule['strength']): ArchitectureRule => ({ id, from: 'web/', mayNotImport: 'db/', except: [], because: '', since: '', by: '', strength });
  const rules = [rule('a', 'block'), rule('b', 'guide')];
  assert.deepEqual(rulesHolding('web/x.ts', rules), [{ id: 'a', strength: 'block' }]);
  assert.deepEqual(rulesHolding('db/client.ts', rules), [{ id: 'a', strength: 'block' }]);
  assert.deepEqual(rulesHolding('api/x.ts', rules), []);
});
