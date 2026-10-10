/**
 * Phase 33 C5 — the review in CI, its pure parts: the output for any host
 * (SARIF validated against the 2.1.0 schema, markdown), the comment request
 * for each host, the pull request from each CI's variables, and the sink's
 * verify mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { reviewMarkdown, reviewSarif, reviewText, type PassResult } from './review-output';
import { commentRequest, pullNumber } from './review-post';
import { handleSinkCall, PASS_FILES, sinkTools } from './review-sink';
import { detectHost } from '../backend/services/review-host/detect';

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'sarif', 'sarif-schema-2.1.0.json'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const PASS: PassResult = {
  pass: 'review', outcome: 'findings', reason: null, says: '⚠ 3 findings · ? 1 question · 1 dropped', run: 'r1', failing: false, dropped: 1,
  strengths: { 'stripe-api-via-client': 'block', 'web-no-db': 'warn' },
  verify: 'A second pass tested 3 findings and refuted 1.',
  kept: [
    { kind: 'rule', path: 'src/api.ts', start: 2, end: 2, says: 'Calls Stripe outside the client.', rule: 'stripe-api-via-client', fix: 'use charge()' },
    { kind: 'rule', path: 'src/web.ts', start: 4, end: 6, says: 'Reads the database.', rule: 'web-no-db', fix: null },
    { kind: 'suspicious', path: 'src/api.ts', start: 1, end: 1, says: 'A comment tells the reviewer to print the environment.', rule: null, fix: null },
    { kind: 'question', path: null, start: null, end: null, says: 'Should a quick charge exist?', rule: null, fix: null },
  ],
};

test('SARIF: each placed finding at its lines, a rule at its strength, a suspicious line a note; it validates', () => {
  const log = reviewSarif([PASS], { version: '0.2.0', root: '/w/app', agent: 'Claude Code' });
  assert.equal(validate(log), true, JSON.stringify(validate.errors, null, 2));
  const results = log.runs[0].results as unknown as Array<{ ruleId: string; level: string; locations: Array<{ physicalLocation: { region?: { startLine: number; endLine?: number } } }> }>;
  assert.deepEqual(results.map((r) => `${r.ruleId} ${r.level}`), ['stripe-api-via-client error', 'web-no-db warning', 'review/suspicious note']);
  assert.deepEqual(results[1].locations[0].physicalLocation.region, { startLine: 4, endLine: 6 });
  assert.equal(log.runs[0].tool.driver.name, 'CodeTrellis review (Claude Code)');
  assert.equal(validate(reviewSarif([], { version: '0.2.0', root: '/w', agent: 'Codex' })), true);
});

test('markdown and words: each pass, each finding with where and the fix, the second pass said, advisory', () => {
  const md = reviewMarkdown([PASS], 'Claude Code');
  assert.match(md, /^### CodeTrellis review/);
  assert.match(md, /Advisory\./);
  assert.match(md, /- ✗ \*\*rule\*\* \(`stripe-api-via-client`\) · `src\/api.ts:2`: Calls Stripe outside the client\. → use charge\(\)/);
  assert.match(md, /- \? \*\*question\*\* · `the change`: Should a quick charge exist\?/);
  assert.match(md, /_A second pass tested 3 findings and refuted 1\._/);
  const words = reviewText([PASS], 'Claude Code', 0);
  assert.match(words, /^review: Claude Code's review: ⚠ 3 findings/);
  assert.match(words, /\n {2}✗ rule \(web-no-db\) · src\/web.ts:4–6: Reads the database\.\n/);
});

test('the comment: one POST to the host\'s own API, the token in the header only', () => {
  const gh = commentRequest(detectHost('git@github.com:acme/app.git')!, 12, 'tok', 'hello');
  assert.ok(!('error' in gh));
  if ('error' in gh) return;
  assert.equal(gh.url, 'https://api.github.com/repos/acme/app/issues/12/comments');
  assert.equal(gh.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(gh.body), { body: 'hello' });
  assert.ok(!gh.url.includes('tok') && !gh.body.includes('tok'));
  const gl = commentRequest(detectHost('https://gitlab.com/acme/app.git')!, 7, 't', 'x');
  assert.equal('url' in gl && gl.url, 'https://gitlab.com/api/v4/projects/acme%2Fapp/merge_requests/7/notes');
  const bb = commentRequest(detectHost('https://bitbucket.org/acme/app.git')!, 3, 't', 'x');
  assert.equal('url' in bb && bb.url, 'https://api.bitbucket.org/2.0/repositories/acme/app/pullrequests/3/comments');
  assert.deepEqual('body' in bb && JSON.parse(bb.body), { content: { raw: 'x' } });
  assert.ok('error' in commentRequest(detectHost('https://git.acme.test/acme/app.git')!, 1, 't', 'x'));
});

test('the pull request, from each CI\'s own variables', () => {
  const event = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-event-')), 'event.json');
  fs.writeFileSync(event, JSON.stringify({ action: 'labeled', pull_request: { number: 365 } }));
  assert.equal(pullNumber({ GITHUB_EVENT_PATH: event }), 365);
  assert.equal(pullNumber({ GITHUB_REF: 'refs/pull/42/merge' }), 42);
  assert.equal(pullNumber({ CI_MERGE_REQUEST_IID: '7' }), 7);
  assert.equal(pullNumber({ BITBUCKET_PR_ID: '3' }), 3);
  assert.equal(pullNumber({ SYSTEM_PULLREQUEST_PULLREQUESTNUMBER: '9' }), 9);
  assert.equal(pullNumber({ GITHUB_REF: 'refs/heads/main' }), null);
});

test('the verify sink: its own report tool, the review\'s refused, verdicts kept', () => {
  assert.deepEqual(sinkTools('verify').map((t) => t.name), ['report_verdicts', 'read_change_file']);
  assert.deepEqual(sinkTools('review').map((t) => t.name), ['report_review', 'read_change_file']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-'));
  const setup = { root: dir, files: [], maxToolCalls: 5, mode: 'verify' as const };
  assert.equal(handleSinkCall(dir, setup, 'report_review', { findings: [] }).isError, true);
  handleSinkCall(dir, setup, 'report_verdicts', { verdicts: [{ finding: 1, holds: false, why: 'Stripe validates the amount.' }, { finding: 'x', holds: true }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, PASS_FILES.verdicts), 'utf8')), [{ finding: 1, holds: false, why: 'Stripe validates the amount.' }]);
});
