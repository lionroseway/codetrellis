/**
 * Phase 33 B3 — fuzzy matching: look-alike names, by a deterministic
 * similarity score with a threshold.
 *
 * Done when `npm:reqeusts` is reported with its score like `npm:requests`,
 * the same way on every run. The plan's illustrative 0.93 became 0.88: one
 * swapped pair in eight letters, by the edit distance BUILDING-BLOCKS.md now
 * names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breaks, lookAlike, lookAlikeFix, parseArchitectureRule, ruleStatement } from './architecture-rule';
import { diffRules } from './rule-changes';
import { ruleTerms } from './rule-approvals';
import { normaliseName, similarity, scoreWords } from '../../shared/lib/fuzzy';
import { grepEntries } from '../../shared/lib/grep-entry';

const parse = (raw: Record<string, unknown>) => parseArchitectureRule({ id: 'r', strength: 'block', ...raw });
const lookalikes = () => parse({ kind: 'package', package: { match: 'fuzzy', value: 'npm:requests' } }).rule!;

test('a name is read the same however it is cased or joined', () => {
  assert.equal(normaliseName('getUserID'), 'get user id');
  assert.equal(normaliseName('react-dom'), normaliseName('reactDom'));
  assert.equal(normaliseName('react_dom'), 'react dom');
  assert.equal(normaliseName('@aws-sdk/client-s3'), 'aws sdk client s3');
  assert.equal(similarity('react-dom', 'reactDom'), 1);
});

test('a score is one less the edits over the longer name, a swap counting one, and the same every time', () => {
  assert.equal(similarity('requests', 'reqeusts'), 0.875, 'one swap in eight');
  assert.equal(scoreWords(similarity('requests', 'reqeusts')), '0.88');
  assert.equal(similarity('requests', 'request'), 0.875, 'one dropped');
  assert.equal(similarity('lodash', 'lodahs'), 1 - 1 / 6);
  assert.equal(similarity('stripe', 'paypal'), 0);
  for (let i = 0; i < 5; i++) assert.equal(similarity('formatMoney', 'formatMony'), similarity('formatMoney', 'formatMony'));
});

test('npm:reqeusts is a look-alike of npm:requests, said with its score; the real one and another ecosystem are not', () => {
  const r = lookalikes();
  assert.equal(r.match, 'fuzzy');
  assert.equal(r.threshold, 0.85, 'the default, written down');
  assert.deepEqual(r.only, [], 'nothing may: only may be empty for a look-alike');
  assert.equal(ruleStatement(r), 'nothing may import a look-alike of npm:requests (0.85 or closer)');
  assert.equal(breaks(r, 'app/client.py', 'npm:reqeusts'), true);
  assert.equal(lookAlike(r, 'npm:reqeusts'), 0.875);
  assert.equal(lookAlikeFix(r, 'npm:reqeusts'), 'npm:reqeusts is 0.88 like npm:requests: did you mean it?');
  assert.equal(breaks(r, 'app/client.py', 'npm:requests'), false, 'the name itself is not a look-alike');
  assert.equal(breaks(r, 'app/client.py', 'pypi:reqeusts'), false, 'another ecosystem');
  assert.equal(breaks(r, 'app/client.py', 'npm:axios'), false);
  assert.equal(breaks({ ...r, threshold: 0.9 }, 'app/client.py', 'npm:reqeusts'), false, 'below a stricter threshold');
});

test('a look-alike export, or call, is matched by its name; only, when said, may', () => {
  const sym = parse({ kind: 'symbol', symbol: { match: 'fuzzy', value: 'src/money.ts#formatMoney', threshold: 0.8 }, only: ['src/legacy/'] }).rule!;
  assert.equal(ruleStatement(sym), 'only src/legacy/ may import a look-alike of formatMoney from src/money.ts (0.80 or closer)');
  assert.equal(breaks(sym, 'src/web/cart.ts', 'src/utils/format.ts#formatMoney'), true, 'a second formatMoney, in another file');
  assert.equal(breaks(sym, 'src/web/cart.ts', 'src/utils/format.ts#formatMony'), true);
  assert.equal(breaks(sym, 'src/web/cart.ts', 'src/money.ts#formatMoney'), false, 'the one itself');
  assert.equal(breaks(sym, 'src/legacy/old.ts', 'src/utils/format.ts#formatMoney'), false, 'only may');
  assert.equal(lookAlikeFix(sym, 'src/utils/format.ts#formatMony'), 'formatMony is 0.92 like formatMoney: did you mean it?');
  const host = parse({ kind: 'calls', calls: { match: 'fuzzy', value: 'http:api.stripe.com' } }).rule!;
  assert.equal(ruleStatement(host), 'nothing may make a call like api.stripe.com (0.85 or closer)');
  assert.equal(breaks(host, 'src/a.ts', 'http:api.strlpe.com/v1/charges'), true, 'a look-alike host, any path');
  assert.equal(breaks(host, 'src/a.ts', 'http:api.stripe.com/v1/charges'), false, 'the host itself');
});

test('a fuzzy grep rule reads whole words like the text, and never the text itself', () => {
  const r = parse({ kind: 'grep', in: ['src/'], mustNot: { match: 'fuzzy', value: 'requireAuth' } }).rule!;
  assert.equal(ruleStatement(r), 'no file in src/ may contain a word like “requireAuth” (0.85 or closer) but not it');
  assert.equal(grepEntries(r, 'router.get("/", requireAuht, h);\n').length, 1);
  assert.equal(grepEntries(r, 'router.get("/", requireAuth, h);\n').length, 0);
  assert.equal(grepEntries(r, 'const unrequiredAuthor = 1;\n').length, 0, 'a word, not part of one');
  assert.match(parse({ kind: 'grep', in: ['src/'], must: { match: 'fuzzy', value: 'requireAuth' } }).problems.join(), /fuzzy is for mustNot/);
  assert.match(parse({ kind: 'grep', in: ['src/'], mustNot: { match: 'fuzzy', value: 'console.log(' } }).problems.join(), /a word like one name/);
});

test('a threshold is for fuzzy alone, above 0.5 and below 1', () => {
  assert.match(parse({ kind: 'package', package: 'npm:requests', threshold: 0.9, only: ['a/'] }).problems.join(), /threshold is only for match: fuzzy/);
  assert.match(parse({ kind: 'package', package: { match: 'fuzzy', value: 'npm:requests', threshold: 1 } }).problems.join(), /above 0.5 and below 1/);
  assert.match(parse({ kind: 'package', package: { match: 'fuzzy', value: 'requests' } }).problems.join(), /an ecosystem and a name/);
  assert.match(parse({ kind: 'package', package: 'npm:requests' }).problems.join(), /only must list/, 'an exact rule still names who may');
});

test('a lower threshold tightens, a higher one loosens; the terms carry it', () => {
  const r = lookalikes();
  assert.equal(diffRules([r], [{ ...r, threshold: 0.8 }], [])[0].effect, 'tightens');
  assert.equal(diffRules([r], [{ ...r, threshold: 0.9 }], [])[0].effect, 'loosens');
  assert.equal(ruleTerms(r)!.threshold, 0.85);
  assert.equal(ruleTerms(r)!.match, 'fuzzy');
});
