import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSuite, readRulebook, writeSuite, RULES_DIR } from './rulebook';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';

const project = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rulebook-'));
const put = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

const rule = (id: string, extra: Partial<ArchitectureRule> = {}): ArchitectureRule => ({
  id, from: 'web/', mayNotImport: 'db/', except: [], because: 'web talks to db through the API', since: '2026-10-06T00:00:00.000Z', by: 'Saif', strength: 'block', ...extra,
});

test('a suite file is read with its rules, each knowing its suite', () => {
  const { suite, problems } = parseSuite('payments', [
    'suite: payments',
    'because: Money moves through one place.',
    'rules:',
    '  - id: web-not-payments-db',
    '    from: web/',
    '    mayNotImport: payments/db/',
    '    because: web reads payments through the API',
  ].join('\n'));
  assert.deepEqual(problems, []);
  assert.equal(suite?.because, 'Money moves through one place.');
  assert.deepEqual(suite?.rules.map((r) => [r.id, r.from, r.mayNotImport, r.suite]), [['web-not-payments-db', 'web/', 'payments/db/', 'payments']]);
});

test('a bad rule is left out with why, naming the file and rule; the rest still count', () => {
  const { suite, problems } = parseSuite('ui', [
    'rules:',
    '  - id: ok-rule',
    '    from: web/',
    '    mayNotImport: db/',
    '  - id: Bad Id',
    '    from: /etc/',
    '    mayNotImport: db/',
    '  - id: ok-rule',
    '    from: a/',
    '    mayNotImport: b/',
  ].join('\n'));
  assert.deepEqual(suite?.rules.map((r) => r.id), ['ok-rule']);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^\.codetrellis\/rules\/ui\.yaml, rule "Bad Id": id must be a short slug.*from must be relative to the project/);
  assert.match(problems[1], /rule "ok-rule": the id is used twice in this suite; the first is kept/);
});

test('a file that is not YAML, or not a suite, says so instead of passing silently', () => {
  assert.match(parseSuite('x', 'rules: [unclosed').problems[0], /^\.codetrellis\/rules\/x\.yaml is not valid YAML/);
  assert.match(parseSuite('x', '- just\n- a list').problems[0], /must be a suite/);
  assert.match(parseSuite('x', 'rules: nope').problems[0], /rules must be a list/);
  assert.match(parseSuite('x', 'suite: other\nrules: []').problems[0], /says it is suite "other"; a suite is named by its file/);
});

test('every suite in the folder is read; an id two suites share is kept once, with why', () => {
  const root = project();
  put(root, `${RULES_DIR}/a.yaml`, 'rules:\n  - {id: shared, from: web/, mayNotImport: db/}\n');
  put(root, `${RULES_DIR}/b.yaml`, 'rules:\n  - {id: shared, from: x/, mayNotImport: y/}\n  - {id: own, from: x/, mayNotImport: z/}\n');
  put(root, `${RULES_DIR}/NotASuite.yaml`, 'rules: []\n');
  put(root, `${RULES_DIR}/notes.txt`, 'not a suite');
  const book = readRulebook(root);
  assert.deepEqual(book.suites.map((s) => [s.name, s.rules.map((r) => r.id)]), [['a', ['shared']], ['b', ['own']]]);
  assert.deepEqual(book.problems, ['.codetrellis/rules/b.yaml, rule "shared": the id is already used in suite "a"; that one is kept']);
});

test('no rules folder is an empty rulebook, not an error', () => {
  assert.deepEqual(readRulebook(project()), { suites: [], problems: [] });
});

test('a change on disk is read on the next call (a pull, an edit in a review)', () => {
  const root = project();
  put(root, `${RULES_DIR}/a.yaml`, 'rules:\n  - {id: one, from: web/, mayNotImport: db/}\n');
  assert.deepEqual(readRulebook(root).suites[0].rules.map((r) => r.id), ['one']);
  put(root, `${RULES_DIR}/a.yaml`, 'rules:\n  - {id: one, from: web/, mayNotImport: db/}\n  - {id: two, from: api/, mayNotImport: ui/}\n');
  assert.deepEqual(readRulebook(root).suites[0].rules.map((r) => r.id), ['one', 'two']);
});

test('writing a suite keeps the file\'s comments and its own words, and reads back the same rules', () => {
  const root = project();
  put(root, `${RULES_DIR}/payments.yaml`, [
    '# Owned by the payments team; see CODEOWNERS.',
    'suite: payments',
    'because: Money moves through one place. # do not loosen without the team',
    'rules: []',
  ].join('\n'));
  writeSuite(root, 'payments', [rule('web-not-db', { suite: 'payments', except: ['db/types.ts'] })]);
  const text = fs.readFileSync(path.join(root, `${RULES_DIR}/payments.yaml`), 'utf-8');
  assert.match(text, /^# Owned by the payments team; see CODEOWNERS\./);
  assert.match(text, /# do not loosen without the team/);
  const [suite] = readRulebook(root).suites;
  assert.equal(suite.because, 'Money moves through one place.');
  assert.deepEqual(suite.rules.map((r) => [r.id, r.except, r.because, r.by, r.suite]), [['web-not-db', ['db/types.ts'], 'web talks to db through the API', 'Saif', 'payments']]);
});

test('a new suite file says what it is, and a bad suite name is refused', () => {
  const root = project();
  writeSuite(root, 'architecture', [rule('a')]);
  const text = fs.readFileSync(path.join(root, `${RULES_DIR}/architecture.yaml`), 'utf-8');
  assert.match(text, /^# Architecture rules, suite "architecture"/);
  assert.match(text, /^suite: architecture$/m);
  assert.throws(() => writeSuite(root, '../escape', []), /is not a suite name/);
});

test('a rules folder that is a link out of the project is not read, and not written through', () => {
  const root = project();
  const outside = project();
  put(outside, 'evil.yaml', 'rules:\n  - {id: planted, from: web/, mayNotImport: db/}\n');
  fs.mkdirSync(path.join(root, '.codetrellis'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, RULES_DIR), 'dir');
  assert.deepEqual(readRulebook(root).suites, []);
  assert.throws(() => writeSuite(root, 'architecture', [rule('a')]));
  assert.equal(fs.existsSync(path.join(outside, 'architecture.yaml')), false, 'nothing written outside the project');
});

test('a rule\'s strength is read; none means block, as it did before strength existed; a wrong one is refused (R4)', () => {
  const { suite, problems } = parseSuite('s', [
    'rules:',
    '  - {id: old, from: web/, mayNotImport: db/}',
    '  - {id: soft, from: web/, mayNotImport: api/, strength: warn}',
    '  - {id: words, from: lib/, mayNotImport: ui/, strength: guide}',
    '  - {id: bad, from: x/, mayNotImport: y/, strength: maybe}',
  ].join('\n'));
  assert.deepEqual(suite?.rules.map((r) => [r.id, r.strength]), [['old', 'block'], ['soft', 'warn'], ['words', 'guide']]);
  assert.match(problems[0], /rule "bad": strength must be block, warn or guide/);
});

test('a suite is written with each rule\'s strength, so it reads back the same', () => {
  const root = project();
  writeSuite(root, 'architecture', [rule('a', { strength: 'warn' }), rule('b', { strength: 'guide' })]);
  assert.match(fs.readFileSync(path.join(root, `${RULES_DIR}/architecture.yaml`), 'utf-8'), /strength: warn/);
  assert.deepEqual(readRulebook(root).suites[0].rules.map((r) => r.strength), ['warn', 'guide']);
});

test('a package rule is written the way a person writes one, and reads back the same (R5)', () => {
  const root = project();
  const stripe: ArchitectureRule = {
    id: 'stripe-via-wrapper', kind: 'package', from: '**', mayNotImport: 'npm:stripe', only: ['src/payments/index.ts'],
    except: [], because: 'The wrapper sets idempotency keys and retries.', since: '2026-10-06T00:00:00.000Z', by: '', strength: 'block', suite: 'payments',
  };
  writeSuite(root, 'payments', [stripe]);
  const text = fs.readFileSync(path.join(root, RULES_DIR, 'payments.yaml'), 'utf-8');
  assert.match(text, /kind: package\n\s+package: npm:stripe\n\s+only:\n\s+- src\/payments\/index.ts/);
  assert.doesNotMatch(text, /mayNotImport|from:/);
  assert.deepEqual(readRulebook(root).suites[0].rules[0], stripe);
});

test('a symbol rule is written the way a person writes one, and reads back the same (R6)', () => {
  const root = project();
  const charge: ArchitectureRule = {
    id: 'charges-via-payments', kind: 'symbol', from: '**', mayNotImport: 'src/payments/charge.ts#createCharge', only: ['src/payments/'],
    except: [], because: 'Charging goes through the payments module.', since: '2026-10-06T00:00:00.000Z', by: '', strength: 'warn', suite: 'payments',
  };
  writeSuite(root, 'payments', [charge]);
  const text = fs.readFileSync(path.join(root, RULES_DIR, 'payments.yaml'), 'utf-8');
  assert.match(text, /kind: symbol\n\s+symbol: src\/payments\/charge.ts#createCharge\n\s+only:\n\s+- src\/payments\//);
  assert.doesNotMatch(text, /mayNotImport|from:|except/);
  assert.deepEqual(readRulebook(root).suites[0].rules[0], charge);
});

test('a call rule is written the way a person writes one, and reads back the same (R7)', () => {
  const root = project();
  const stripeApi: ArchitectureRule = {
    id: 'stripe-api-via-payments', kind: 'calls', from: '**', mayNotImport: 'http:api.stripe.com', only: ['src/payments/'],
    except: [], because: 'One client, with retries and idempotency keys.', since: '2026-10-06T00:00:00.000Z', by: '', strength: 'block', suite: 'payments',
  };
  writeSuite(root, 'payments', [stripeApi]);
  const text = fs.readFileSync(path.join(root, RULES_DIR, 'payments.yaml'), 'utf-8');
  assert.match(text, /kind: calls\n\s+calls: http:api.stripe.com\n\s+only:\n\s+- src\/payments\//);
  assert.deepEqual(readRulebook(root).suites[0].rules[0], stripeApi);
});
