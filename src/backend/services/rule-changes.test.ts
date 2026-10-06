import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffRules } from './rule-changes';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';

const rule = (id: string, extra: Partial<ArchitectureRule> = {}): ArchitectureRule => ({
  id, from: 'web/', mayNotImport: 'db/', except: [], because: 'through the API', since: '2026-10-06T00:00:00.000Z', by: 'Saif', suite: 'architecture', ...extra,
});
const edges = [
  { from: 'web/a.ts', to: 'db/client.ts' },
  { from: 'web/b.ts', to: 'db/types.ts' },
  { from: 'api/c.ts', to: 'db/client.ts' },
];

test('removing a rule loosens it, counting the imports it forbade', () => {
  const [c] = diffRules([rule('web-not-db')], [], edges);
  assert.equal(c.effect, 'loosens');
  assert.equal(c.change, 'removed');
  assert.deepEqual(c.allowed, [{ from: 'web/a.ts', to: 'db/client.ts' }, { from: 'web/b.ts', to: 'db/types.ts' }]);
  assert.equal(c.words, '✗ This change removes the rule “web/ may not import db/” (web-not-db): 2 imports it forbade become allowed. Loosening a rule needs a person\'s approval in the app.');
});

test('a wider exception loosens, even when nothing in the code uses it yet', () => {
  const [c] = diffRules([rule('r')], [rule('r', { except: ['db/new-door.ts'] })], edges);
  assert.equal(c.effect, 'loosens');
  assert.deepEqual(c.allowed, []);
  assert.match(c.words, /^✗ This change loosens the rule r, from “web\/ may not import db\/” to “web\/ may not import db\/ \(except db\/new-door.ts\)”\. Loosening/);
});

test('an exception that lets an existing import through says so', () => {
  const [c] = diffRules([rule('r')], [rule('r', { except: ['db/types.ts'] })], edges);
  assert.deepEqual(c.allowed, [{ from: 'web/b.ts', to: 'db/types.ts' }]);
  assert.match(c.words, /: 1 import it forbade become allowed\./);
});

test('changing a rule\'s paths is loosening unless proven otherwise; a person decides', () => {
  // Wider in fact (all of src/), but not provable from the text alone.
  const [c] = diffRules([rule('r')], [rule('r', { from: 'src/' })], edges);
  assert.equal(c.effect, 'loosens');
});

test('an exception taken away only tightens, and names what already breaks it', () => {
  const [c] = diffRules([rule('r', { except: ['db/types.ts'] })], [rule('r')], edges);
  assert.equal(c.effect, 'tightens');
  assert.deepEqual(c.forbidden, [{ from: 'web/b.ts', to: 'db/types.ts' }]);
  assert.match(c.words, /^⚠ This change tightens the rule r, .*: 1 import already in the code would break it\.$/);
});

test('a new rule tightens, never blocks, and is checked once it is on the base branch', () => {
  const [c] = diffRules([], [rule('api-not-db', { from: 'api/' })], edges);
  assert.equal(c.effect, 'tightens');
  assert.equal(c.change, 'added');
  assert.equal(c.words, '⚠ This change adds the rule “api/ may not import db/” (api-not-db): 1 import already in the code would break it. It is checked once it is on the base branch.');
});

test('a reworded reason is listed; who set it, when, or which suite holds it is no change', () => {
  assert.deepEqual(diffRules([rule('r')], [rule('r', { because: 'clearer words' })], edges).map((c) => [c.effect, c.words]), [['reworded', '· This change rewords why the rule r exists.']]);
  assert.deepEqual(diffRules([rule('r')], [rule('r', { by: 'Sam', since: '2027-01-01T00:00:00.000Z', suite: 'payments' })], edges), []);
});
