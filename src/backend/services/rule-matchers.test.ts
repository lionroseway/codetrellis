/**
 * Phase 33 B1 — matchers: a rule recognises its target exactly, by a glob or
 * by a regex.
 *
 * Done when `http:*.stripe.com` catches `api.stripe.com` and `files.stripe.com`,
 * a regex target holds, and every existing rule reads as before (the rest of
 * the suite, unchanged).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breaks, parseArchitectureRule, ruleStatement, targetMatches } from './architecture-rule';
import { diffRules } from './rule-changes';
import { ruleTerms } from './rule-approvals';
import { globSource, regexProblem, underPattern, wholly } from '../../shared/lib/matcher';

const parse = (raw: Record<string, unknown>) => parseArchitectureRule({ id: 'r', only: ['src/payments/'], strength: 'block', ...raw });

test('a glob over a call host catches every subdomain, and nothing that merely ends alike', () => {
  const { rule, problems } = parse({ kind: 'calls', calls: 'http:*.stripe.com' });
  assert.deepEqual(problems, []);
  assert.equal(rule!.match, 'glob', 'a * means glob without saying so');
  for (const hit of ['http:api.stripe.com/v1/charges', 'http:files.stripe.com', 'http:a.b.stripe.com/x']) {
    assert.equal(breaks(rule!, 'src/web/x.ts', hit), true, hit);
  }
  for (const miss of ['http:stripe.com', 'http:evilstripe.com/v1', 'http:api.stripe.com.evil.net', 'sql:stripe']) {
    assert.equal(breaks(rule!, 'src/web/x.ts', miss), false, miss);
  }
  assert.equal(breaks(rule!, 'src/payments/charge.ts', 'http:api.stripe.com/v1/charges'), false, 'only may');
  assert.equal(ruleStatement(rule!), 'only src/payments/ may call *.stripe.com');
});

test('a glob keeps a call rule\'s shape: a host, then a path it covers everything under', () => {
  const { rule } = parse({ kind: 'calls', calls: { match: 'glob', value: 'http:*.stripe.com/v1/*' } });
  assert.equal(targetMatches(rule!, 'http:api.stripe.com/v1/charges'), true);
  assert.equal(targetMatches(rule!, 'http:api.stripe.com/v1/charges/ch_1/refunds'), true, 'and everything under it');
  assert.equal(targetMatches(rule!, 'http:api.stripe.com/v2/charges'), false);
  const sql = parse({ kind: 'calls', calls: 'sql:payments_*' }).rule!;
  assert.equal(targetMatches(sql, 'sql:payments_refunds'), true);
  assert.equal(targetMatches(sql, 'sql:payments'), false);
});

test('a regex target holds over the whole entry, anchored at both ends', () => {
  const { rule, problems } = parse({ kind: 'calls', calls: { match: 'regex', value: 'http:api\\.(stripe|paypal)\\.com(/.*)?' } });
  assert.deepEqual(problems, []);
  assert.equal(rule!.match, 'regex');
  assert.equal(breaks(rule!, 'src/web/x.ts', 'http:api.paypal.com/v2/orders'), true);
  assert.equal(breaks(rule!, 'src/web/x.ts', 'http:api.stripe.com'), true);
  assert.equal(breaks(rule!, 'src/web/x.ts', 'http:api.square.com/v2'), false);
  assert.equal(breaks(rule!, 'src/web/x.ts', 'http:xapi.stripe.com'), false, 'anchored');
  assert.equal(ruleStatement(rule!), 'only src/payments/ may make a call matching /http:api\\.(stripe|paypal)\\.com(/.*)?/');
});

test('a package glob covers a scope and what is under each of its packages', () => {
  const { rule } = parse({ kind: 'package', package: 'npm:@aws-sdk/*' });
  assert.equal(breaks(rule!, 'src/web/x.ts', 'npm:@aws-sdk/client-s3'), true);
  assert.equal(breaks(rule!, 'src/web/x.ts', 'npm:@aws-sdk/client-s3/dist/x'), true);
  assert.equal(breaks(rule!, 'src/web/x.ts', 'npm:aws-sdk'), false);
  assert.equal(breaks(rule!, 'src/web/x.ts', 'pypi:@aws-sdk/client-s3'), false, 'another ecosystem');
});

test('a symbol glob covers the exports it names, and a namespace import of their file', () => {
  const { rule } = parse({ kind: 'symbol', symbol: 'src/db.ts#raw*' });
  assert.equal(breaks(rule!, 'src/web/x.ts', 'src/db.ts#rawQuery'), true);
  assert.equal(breaks(rule!, 'src/web/x.ts', 'src/db.ts#*'), true, 'the whole module');
  assert.equal(breaks(rule!, 'src/web/x.ts', 'src/db.ts#query'), false);
  assert.equal(breaks(rule!, 'src/db.ts', 'src/db.ts#rawQuery'), false, 'its own file');
});

test('an exact target reads as it always did', () => {
  const { rule } = parse({ kind: 'calls', calls: 'http:api.stripe.com' });
  assert.equal(rule!.match, undefined);
  assert.equal(breaks(rule!, 'src/web/x.ts', 'http:api.stripe.com/v1/charges'), true);
  assert.equal(breaks(rule!, 'src/web/x.ts', 'http:files.stripe.com'), false);
  assert.equal(parse({ kind: 'package', package: 'npm:stripe', match: 'exact' }).rule!.match, undefined);
});

test('a matcher written wrongly is refused with why, and a regex that could run away is refused', () => {
  assert.match(parse({ kind: 'calls', calls: { match: 'fuzzy-ish', value: 'http:x.com' } }).problems.join(), /match must be exact, glob, regex or fuzzy/);
  assert.match(parse({ kind: 'calls', calls: '*.stripe.com' }).problems.join(), /starts the way its entries do, like http:\*\.stripe\.com/);
  assert.match(parse({ kind: 'package', package: { match: 'regex', value: 'npm:(a+)+' } }).problems.join(), /repeat a group that itself repeats/);
  assert.match(parse({ kind: 'package', package: { match: 'regex', value: 'npm:(' } }).problems.join(), /does not compile/);
  assert.match(regexProblem('x'.repeat(201))!, /at most 200/);
  assert.equal(regexProblem('http:api\\.(stripe|paypal)\\.com(/.*)?'), null);
});

test('changing a target\'s matcher, or its pattern, loosens: what a pattern covers is not proven from its text', () => {
  const exact = parse({ kind: 'calls', calls: 'http:api.stripe.com' }).rule!;
  const glob = parse({ kind: 'calls', calls: 'http:*.stripe.com' }).rule!;
  const [c] = diffRules([exact], [glob], []);
  assert.equal(c.effect, 'loosens');
  assert.equal(diffRules([glob], [glob], []).length, 0);
  // Signed terms carry the matcher, and an exact rule's terms are as they were.
  assert.equal(ruleTerms(glob)!.match, 'glob');
  assert.equal('match' in ruleTerms(exact)!, false);
});

test('the glob and regex helpers', () => {
  assert.equal(globSource('src/**/x*.ts'), 'src/(?:.*/)?x[^/]*\\.ts');
  assert.equal(globSource('a**b'), 'a.*b', 'a ** inside a name is any run');
  assert.equal(wholly('glob', 'a/*', 'a/b'), true);
  assert.equal(wholly('glob', 'a/*', 'a/b/c'), false);
  assert.equal(underPattern('glob', 'a/*', 'a/b/c'), true);
  assert.equal(wholly('regex', 'a|b', 'ab'), false, 'anchored around the alternation');
});
