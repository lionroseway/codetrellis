/**
 * Phase 33 B2 — grep rules: text that must not, or must, appear in files,
 * scoped by path, with no parser.
 *
 * Done when a `console.log` added to the backend is reported at its line, and
 * an old one already in the file is not (the harness proves that end to end,
 * tests/e2e/grep-rules.test.ts); these tests hold the parts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { breaks, checkEdges, parseArchitectureRule, ruleStatement, breachWords } from './architecture-rule';
import { diffRules } from './rule-changes';
import { ruleTerms } from './rule-approvals';
import { readRulebook, writeSuite } from './rulebook';
import { grepEntries, grepKey, grepLine, isGrepEntry, splitGrep } from '../../shared/lib/grep-entry';
import { findingTitle, reachWords } from '../../shared/lib/check-words';
import { importLine } from '../../shared/lib/import-line';
import { lineMatches } from '../../shared/lib/matcher';

const parse = (raw: Record<string, unknown>) => parseArchitectureRule({ id: 'no-console', kind: 'grep', in: ['src/backend/'], strength: 'warn', ...raw });
const noConsole = () => parse({ mustNot: { match: 'regex', value: 'console\\.(log|debug)\\(' }, except: ['**/*.test.ts'] }).rule!;
const auth = () => parse({ id: 'routes-check-auth', in: 'src/routes/*.ts', must: 'requireAuth' }).rule!;

test('a grep rule reads as a person writes it: the files, and the text they must not or must hold', () => {
  const r = noConsole();
  assert.equal(r.kind, 'grep');
  assert.deepEqual(r.in, ['src/backend/']);
  assert.equal(r.match, 'regex');
  assert.equal(r.must, undefined);
  assert.equal(ruleStatement(r), 'no file in src/backend/ (except **/*.test.ts) may contain a line matching /console\\.(log|debug)\\(/');
  const a = auth();
  assert.equal(a.must, true);
  assert.deepEqual(a.in, ['src/routes/*.ts'], 'one pattern is a list of one');
  assert.equal(ruleStatement(a), 'every file in src/routes/*.ts must contain “requireAuth”');
  const loud = parse({ mustNot: 'TODO*', match: 'glob', ignoreCase: true }).rule!;
  assert.equal(loud.match, 'glob', 'match beside the text, as the suite file writes it');
  assert.equal(ruleStatement(loud), 'no file in src/backend/ may contain a line like “TODO*” (in any case)');
});

test('literal text is literal: a * in it is a *, since code is full of them', () => {
  const r = parse({ mustNot: 'import * as' }).rule!;
  assert.equal(r.match, undefined);
  assert.deepEqual(grepEntries(r, 'import * as fs from "fs";\nimport fs from "fs";\n'), [`grep:${grepKey(r)}:+import * as fs from "fs";`]);
});

test('a grep rule is refused without its files, with both texts or neither, with only, or with a regex that could run away', () => {
  const why = (raw: Record<string, unknown>) => parseArchitectureRule({ id: 'g', kind: 'grep', ...raw }).problems.join(' ');
  assert.match(why({ mustNot: 'x' }), /in must list the files it reads/);
  assert.match(why({ in: ['a/'], mustNot: 'x', must: 'y' }), /mustNot .* or must .*, not both/);
  assert.match(why({ in: ['a/'] }), /mustNot .* or must/);
  assert.match(why({ in: ['a/'], mustNot: '' }), /the text to look for/);
  assert.match(why({ in: ['a/'], mustNot: 'x'.repeat(201) }), /at most 200/);
  assert.match(why({ in: ['a/'], mustNot: { match: 'regex', value: '(a+)+' } }), /repeat a group that itself repeats/);
  assert.match(why({ in: ['a/'], mustNot: { match: 'soundex', value: 'x' } }), /match must be exact, glob, regex or fuzzy/);
  assert.match(why({ in: ['a/'], mustNot: 'x', only: ['b/'] }), /no only/);
  assert.match(why({ in: ['../a/'], mustNot: 'x' }), /climb out/);
  assert.match(why({ in: ['a/'], mustNot: 'x', ignoreCase: 'yes' }), /ignoreCase is true or false/);
});

test('mustNot gives each line that holds it, by its text, once; must gives the file once, only when no line holds it', () => {
  const r = noConsole();
  const text = 'export function a() {\n  console.log("a");\n  console.log("a");\n  console.debug(x)\n  log.info("fine");\n}\n';
  assert.deepEqual(grepEntries(r, text), [`grep:${grepKey(r)}:+console.log("a");`, `grep:${grepKey(r)}:+console.debug(x)`]);
  const a = auth();
  assert.deepEqual(grepEntries(a, 'router.get("/x", requireAuth, h);\n'), []);
  assert.deepEqual(grepEntries(a, 'router.get("/x", h);\n'), [`grep:${grepKey(a)}:-requireAuth`]);
  assert.deepEqual(grepEntries(r, 'console.log(1)\u0000binary'), [], 'a binary file is not read');
  const anyCase = parse({ mustNot: 'todo', ignoreCase: true }).rule!;
  assert.equal(grepEntries(anyCase, '// TODO: later\n').length, 1);
  assert.equal(grepEntries(parse({ mustNot: 'todo' }).rule!, '// TODO: later\n').length, 0);
});

test('a rule judges its own files and its own entries: not an excepted file, not another rule\'s line', () => {
  const r = noConsole();
  const [entry] = grepEntries(r, 'console.log(1)\n');
  assert.equal(breaks(r, 'src/backend/server.ts', entry), true);
  assert.equal(breaks(r, 'src/backend/server.test.ts', entry), false, 'except');
  assert.equal(breaks(r, 'src/frontend/app.ts', entry), false, 'not in');
  const other = parse({ mustNot: 'console.log' }).rule!;
  assert.equal(breaks(other, 'src/backend/server.ts', entry), false, 'another rule\'s terms, another key');
  // An imports rule never reads a grep entry as a file, even a pattern that covers everything.
  assert.equal(breaks({ id: 'x', from: '**', mayNotImport: '**', except: [], because: '', since: '', by: '', strength: 'block' }, 'src/backend/server.ts', entry), false);
  assert.deepEqual(checkEdges([{ ...r, strength: 'guide' }], [{ from: 'src/backend/server.ts', to: entry }]), [], 'a guide checks nothing');
});

test('a finding says what the line holds, on that line; a missing text is about the whole file', () => {
  const r = noConsole();
  const text = 'import x from "y";\n\nexport const f = () => {\n    console.log("debug");\n};\n';
  const [entry] = grepEntries(r, text);
  assert.equal(isGrepEntry(entry), true);
  assert.deepEqual(splitGrep(entry), { key: grepKey(r), found: true, text: 'console.log("debug");' });
  assert.equal(reachWords(entry), 'contains “console.log("debug");”');
  assert.equal(importLine(text, entry), 4);
  assert.equal(grepLine(text, entry), 4);
  assert.equal(findingTitle({ path: 'src/backend/a.ts', imports: entry, line: 4 }), 'src/backend/a.ts:4 contains “console.log("debug");”');
  const [missing] = grepEntries(auth(), 'export const x = 1;\n');
  assert.equal(reachWords(missing), 'never contains “requireAuth”');
  assert.equal(importLine('export const x = 1;\n', missing), 1);
  assert.equal(breachWords(r, { from: 'src/backend/a.ts', to: entry }), 'src/backend/a.ts contains “console.log("debug");”, which the rule “no file in src/backend/ may contain a line matching /console\\.(log|debug)\\(/” forbids');
});

test('the suite file keeps a grep rule as it was written, and reads it back the same', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-grep-'));
  writeSuite(root, 'hygiene', [{ ...noConsole(), suite: 'hygiene', because: 'The backend logs through services/logger.' }, { ...auth(), suite: 'hygiene' }]);
  const yaml = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'hygiene.yaml'), 'utf-8');
  assert.match(yaml, /kind: grep/);
  assert.match(yaml, /mustNot: console\\\.\(log\|debug\)\\\(/);
  assert.match(yaml, /match: regex/);
  assert.match(yaml, /must: requireAuth/);
  assert.match(yaml, /in:\n\s+- src\/backend\//);
  const book = readRulebook(root);
  assert.deepEqual(book.problems, []);
  const [a, b] = book.suites[0].rules;
  assert.equal(ruleStatement(a), ruleStatement(noConsole()));
  assert.equal(grepKey(a), grepKey(noConsole()));
  assert.equal(b.must, true);
});

test('changing what a grep rule reads, or turning must into mustNot, loosens; fewer exceptions tighten', () => {
  const r = noConsole();
  const edges = [{ from: 'src/backend/server.ts', to: grepEntries(r, 'console.log(1)\n')[0] }];
  assert.equal(diffRules([r], [{ ...r, in: ['src/backend/services/'] }], edges)[0].effect, 'loosens');
  assert.equal(diffRules([r], [{ ...r, mayNotImport: 'console\\.log\\(' }], edges)[0].effect, 'loosens');
  assert.equal(diffRules([r], [{ ...r, ignoreCase: true }], edges)[0].effect, 'loosens');
  assert.equal(diffRules([auth()], [{ ...auth(), must: undefined }], [])[0].effect, 'loosens');
  assert.equal(diffRules([r], [{ ...r, except: [] }], edges)[0].effect, 'tightens');
  assert.equal(diffRules([r], [r], edges).length, 0);
  // A rule removed says how many lines it forbade.
  assert.match(diffRules([r], [], edges)[0].words, /1 line it forbade/);
  // Signed terms carry what it reads and how.
  assert.deepEqual(ruleTerms(auth()), { from: '**', mayNotImport: 'requireAuth', except: [], strength: 'warn', kind: 'grep', in: ['src/routes/*.ts'], must: true });
});

test('a line is read for the text anywhere in it: exact, a glob\'s * across anything, a regex searched', () => {
  assert.equal(lineMatches(null, 'console.log(', '  console.log("x")'), true);
  assert.equal(lineMatches('glob', 'http://*.internal', 'fetch("http://billing.internal/x")'), true, 'a * crosses / in a line');
  assert.equal(lineMatches('regex', '^\\s*debugger;?$', '  debugger;'), true);
  assert.equal(lineMatches('regex', 'x', 'y'.repeat(3000) + 'x'), false, 'past 2000 characters is not read');
});
