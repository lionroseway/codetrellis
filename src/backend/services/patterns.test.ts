/**
 * Phase 33 B4 — a team's own patterns: what counts as a call, or as any
 * entry, without code.
 *
 * Done when `paymentsClient.charge()` is caught by a calls rule on
 * `api.stripe.com`, and a rule holds `queue:orders.*` (end to end in
 * tests/e2e/own-patterns.test.ts; the parts here).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePatterns, patternCallsites, patternCallsitesFor, patternRootOf, readPatterns } from './patterns';
import { breaks, parseArchitectureRule, ruleStatement } from './architecture-rule';
import { callEntry, callMatches, callProblem, callWords, isCallEntry, isOwnKind } from '../../shared/lib/call-entry';
import { reachWords } from '../../shared/lib/check-words';
import { callChanges } from './review-architecture';

const YAML = [
  'patterns:',
  '  - id: payments-sdk',
  '    find: { match: regex, value: "paymentsClient\\\\.(charge|refund)\\\\(" }',
  '    is: http:api.stripe.com/v1/charges',
  '    method: post',
  '  - id: orders-queue',
  '    in: [services/]',
  '    except: [services/legacy/]',
  '    find: { match: regex, value: "publish\\\\([\'\\"]orders\\\\.(\\\\w+)" }',
  '    is: queue:orders.$1',
  '  - id: flags',
  '    find: isEnabled(',
  '    is: flag:any',
].join('\n');

test('a pattern file reads as a person writes it', () => {
  const { patterns, problems } = parsePatterns('payments.yaml', YAML);
  assert.deepEqual(problems, []);
  assert.deepEqual(patterns.map((p) => [p.id, p.find.match, p.is, p.method ?? null]), [
    ['payments-sdk', 'regex', 'http:api.stripe.com/v1/charges', 'POST'],
    ['orders-queue', 'regex', 'queue:orders.$1', null],
    ['flags', null, 'flag:any', null],
  ]);
});

test('a pattern written wrongly is said, and the others are still read', () => {
  const { patterns, problems } = parsePatterns('bad.yaml', [
    'patterns:',
    '  - id: Bad Id',
    '    find: x',
    '    is: http:x.com',
    '  - id: no-is',
    '    find: x',
    '  - id: runaway',
    '    find: { match: regex, value: "(a+)+" }',
    '    is: queue:x',
    '  - id: group-without-regex',
    '    find: x',
    '    is: queue:$1',
    '  - id: a-package',
    '    find: x',
    '    is: npm:stripe',
    '  - id: fine',
    '    find: x',
    '    is: event:x.happened',
  ].join('\n'));
  assert.deepEqual(patterns.map((p) => p.id), ['fine']);
  assert.equal(problems.length, 5);
  assert.match(problems.join('\n'), /a pattern: id must be a short slug/);
  assert.match(problems.join('\n'), /no-is: is must say what it is/);
  assert.match(problems.join('\n'), /runaway: a regex may not repeat a group/);
  assert.match(problems.join('\n'), /group-without-regex: is may use \$1 only when find is a regex/);
  assert.match(problems.join('\n'), /a-package: is: calls must be http:/);
  assert.deepEqual(parsePatterns('x.yaml', 'nope: 1').problems, ['x.yaml: a pattern file holds patterns: a list']);
});

test('paymentsClient.charge() is a call to Stripe, normalised as an extractor would make it, on its line', () => {
  const { patterns } = parsePatterns('payments.yaml', YAML);
  const found = patternCallsites(patterns, 'web/checkout.ts', 'import { paymentsClient } from "./payments";\n\nexport const pay = () => paymentsClient.charge(100);\n');
  assert.deepEqual(found, [{ kind: 'http_call', protocol: 'http', line: 3, method: 'POST', urlPattern: '/v1/charges', host: 'api.stripe.com', context: 'pattern:payments-sdk' }]);
  assert.equal(callEntry(found[0]), 'http:api.stripe.com/v1/charges');
});

test('a queue publish is an entry of the team\'s own kind, its name from the regex\'s group, only in the files it reads', () => {
  const { patterns } = parsePatterns('payments.yaml', YAML);
  const text = "publish('orders.created', order);\npublish(\"orders.cancelled\", id); publish('orders.created', again);\n";
  const found = patternCallsites(patterns, 'services/billing/out.ts', text);
  assert.deepEqual(found.map((c) => [c.kind, c.urlPattern, c.line, c.context]), [
    ['entry', 'queue:orders.created', 1, 'pattern:orders-queue'],
    ['entry', 'queue:orders.cancelled', 2, 'pattern:orders-queue'],
    ['entry', 'queue:orders.created', 2, 'pattern:orders-queue'],
  ]);
  assert.equal(callEntry(found[0]), 'queue:orders.created');
  assert.deepEqual(patternCallsites(patterns, 'web/out.ts', text), [], 'not in services/');
  assert.deepEqual(patternCallsites(patterns, 'services/legacy/out.ts', text), [], 'except');
  // Literal find, no groups: one entry per match.
  assert.deepEqual(patternCallsites(patterns, 'web/a.ts', "if (isEnabled('x')) go();\n").map((c) => c.urlPattern), ['flag:any']);
});

test('an entry of the team\'s own kind is a call entry a call rule holds; a package or CodeTrellis\'s own fact is not', () => {
  assert.equal(isCallEntry('queue:orders.created'), true);
  assert.equal(isOwnKind('queue:orders.created'), true);
  assert.equal(isOwnKind('http:api.stripe.com'), false);
  for (const no of ['npm:stripe', 'pypi:requests', 'grep:0a1b2c3d:+x', 'file:a.ts:1', 'folder:x', 'src/a.ts', 'src/a.ts#x']) assert.equal(isCallEntry(no), false, no);
  assert.equal(callProblem('queue:orders.created'), null);
  assert.match(callProblem('queue:orders created')!, /one name, with no spaces/);
  assert.equal(callMatches('queue:orders', 'queue:orders.created'), true, 'a name and everything under it');
  assert.equal(callMatches('queue:orders', 'queue:ordersx'), false);
  assert.equal(callMatches('queue:orders', 'event:orders'), false, 'another kind');
  assert.equal(callWords('queue:orders.created'), 'queue:orders.created');
  assert.equal(reachWords('queue:orders.created'), 'reaches queue:orders.created');
});

test('a rule holds queue:orders.*: only billing publishes to an orders queue', () => {
  const { rule, problems } = parseArchitectureRule({ id: 'orders-from-billing', kind: 'calls', calls: 'queue:orders.*', only: ['services/billing/'], strength: 'block' });
  assert.deepEqual(problems, []);
  assert.equal(rule!.match, 'glob');
  assert.equal(ruleStatement(rule!), 'only services/billing/ may reach queue:orders.*');
  assert.equal(breaks(rule!, 'services/web/cancel.ts', 'queue:orders.cancelled'), true);
  assert.equal(breaks(rule!, 'services/billing/out.ts', 'queue:orders.cancelled'), false);
  assert.equal(breaks(rule!, 'services/web/cancel.ts', 'queue:payments.cancelled'), false);
  assert.equal(breaks(rule!, 'services/web/cancel.ts', 'event:orders.cancelled'), false);
  const exact = parseArchitectureRule({ id: 'x', kind: 'calls', calls: 'queue:orders', only: ['a/'] }).rule!;
  assert.equal(breaks(exact, 'b/c.ts', 'queue:orders.created'), true);
});

test('a review says what a change adds of the team\'s own kinds', () => {
  const added = callChanges('services/web/cancel.ts', [], [{ kind: 'entry', protocol: 'entry', line: 4, urlPattern: 'queue:orders.cancelled', context: 'pattern:orders-queue' }]);
  assert.deepEqual(added, [{ file: 'services/web/cancel.ts', line: 4, kind: 'entry', what: 'queue:orders.cancelled', change: 'added' }]);
});

test('a file\'s patterns are found by its place: the nearest .codetrellis/patterns/ above it, re-read when they change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-patterns-'));
  fs.mkdirSync(path.join(root, '.codetrellis', 'patterns'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codetrellis', 'patterns', 'p.yaml'), YAML);
  const file = path.join(root, 'services', 'billing', 'out.ts');
  assert.equal(patternRootOf(file), root);
  assert.equal(patternCallsitesFor(file, "publish('orders.created', o);\n")[0].urlPattern, 'queue:orders.created');
  const first = readPatterns(root).stamp;
  fs.writeFileSync(path.join(root, '.codetrellis', 'patterns', 'p.yaml'), `${YAML}\n  - id: more\n    find: y\n    is: event:y\n`);
  assert.equal(readPatterns(root, Date.now() + 10_000).patterns.length, 4, 'a changed file is read again');
  assert.notEqual(readPatterns(root, Date.now() + 20_000).stamp, first);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-nopatterns-'));
  assert.deepEqual(patternCallsitesFor(path.join(elsewhere, 'a.ts'), "publish('orders.created', o);\n"), []);
});
