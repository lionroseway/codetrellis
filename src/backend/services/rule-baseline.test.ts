import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { baselineOf, baselineYaml, parseBaseline, ratchet } from './rule-baseline';
import { isSuiteName } from './rulebook';

const rule = (id: string, extra: Partial<ArchitectureRule> = {}): ArchitectureRule => ({
  id, from: 'web/', mayNotImport: 'db/', except: [], because: '', since: '2026-10-06T00:00:00.000Z', by: 'Sam', strength: 'block', ...extra,
});
const old = [{ from: 'web/legacy/a.ts', to: 'db/client.ts' }, { from: 'web/legacy/b.ts', to: 'db/client.ts' }];
const base = baselineOf([rule('web-not-db')], old);

test('the baseline is each rule\'s breaches now, written and read back the same; a guide has none', () => {
  const b = baselineOf([rule('web-not-db'), rule('words', { strength: 'guide' })], old);
  assert.deepEqual([...b.keys()], ['web-not-db']);
  assert.deepEqual(parseBaseline(baselineYaml(b)), b);
  assert.match(baselineYaml(b), /^# CodeTrellis: imports that already broke each rule/);
  assert.equal(isSuiteName('baseline'), false, 'the baseline file is not a suite');
});

test('adding a breach fails: the whole tree is judged against the base\'s baseline', () => {
  const now = [...old, { from: 'web/new.ts', to: 'db/client.ts' }];
  assert.deepEqual(ratchet(base, base, [rule('web-not-db')], now).map((f) => [f.kind, f.from]), [['breach', 'web/new.ts']]);
});

test('fixing one passes and says the count fell, so it can be locked in', () => {
  const [f] = ratchet(base, base, [rule('web-not-db')], old.slice(0, 1));
  assert.equal(f.kind, 'fell');
  assert.equal(f.words, '↓ web-not-db: 1 breach left, down from 2 in the baseline. Run `codetrellis rules baseline` to lock in the lower count.');
});

test('raising the baseline fails; a rule new to it may start with what breaks it now', () => {
  const raised = parseBaseline(baselineYaml(baselineOf([rule('web-not-db')], [...old, { from: 'web/new.ts', to: 'db/client.ts' }])));
  const grew = ratchet(base, raised, [rule('web-not-db')], [...old, { from: 'web/new.ts', to: 'db/client.ts' }]).filter((f) => f.kind === 'grew');
  assert.deepEqual(grew.map((f) => f.words), ['✗ This change adds 1 entry to the baseline of web-not-db (web/new.ts > db/client.ts); a baseline may only shrink.']);
  const newRule = baselineOf([rule('web-not-db'), rule('api-not-ui', { from: 'api/', mayNotImport: 'ui/' })], [...old, { from: 'api/x.ts', to: 'ui/y.ts' }]);
  assert.deepEqual(ratchet(base, newRule, [rule('web-not-db')], old), []);
});

test('no baseline on the base: nothing is judged against it', () => {
  assert.deepEqual(ratchet(null, null, [rule('web-not-db')], [...old, { from: 'web/new.ts', to: 'db/client.ts' }]), []);
  assert.deepEqual(parseBaseline('not: [yaml'), new Map());
});
