/**
 * No MCP code can make a person's decision (Phase 31 §4.3).
 *
 * `criteria-service` refuses any decision that was not issued by
 * `issueHumanDecision`. This test makes sure the issuer, and the
 * operations that need one, are unreachable from `mcp/`.
 *
 * An import check alone would not be enough: MCP tools reach services
 * through `deps` (`deps.criteriaService.decideCriterion`), not by
 * importing them, so this scans for the NAMES wherever they appear.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BACKEND = path.resolve(import.meta.dirname, '..');
const MCP_DIR = path.join(BACKEND, 'mcp');

/** Names only a person's transport may use. */
const HUMAN_ONLY = [
  'human-decision',
  'issueHumanDecision',
  'decideCriterion',
  'updateCriterion',
  'deleteCriterion',
  'addCriterionAsHuman',
];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

test('nothing under mcp/ names the issuer or a human-only operation', () => {
  const files = walk(MCP_DIR);
  assert.ok(files.length > 20, `expected to scan the MCP sources, found ${files.length} files`);
  const offenders: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return; // a doc comment may mention the rule
      for (const name of HUMAN_ONLY) {
        if (new RegExp(`\\b${name.replace('-', '\\-')}\\b`).test(code)) {
          offenders.push(`${path.relative(BACKEND, file)}:${i + 1}  ${name}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [], `MCP code must not reach a person's decision:\n${offenders.join('\n')}`);
});

test('the guard still guards: the issuer exists and the desktop transport uses it', () => {
  const issuer = fs.readFileSync(path.join(BACKEND, 'services', 'human-decision.ts'), 'utf-8');
  assert.match(issuer, /export function issueHumanDecision/);
  assert.match(issuer, /new WeakSet/);
  const server = fs.readFileSync(path.join(BACKEND, 'server.ts'), 'utf-8');
  assert.match(server, /issueHumanDecision\('desktop'/, 'the REST layer is where a desktop decision is issued');
  const service = fs.readFileSync(path.join(BACKEND, 'services', 'criteria-service.ts'), 'utf-8');
  assert.match(service, /isHumanDecision\(decision\)/, 'the service checks at runtime, not only by type');
});

test('a decision is issued in exactly two places: the desktop REST layer and the phone', () => {
  const approvals = fs.readFileSync(path.join(BACKEND, 'services', 'mobile-approvals.ts'), 'utf-8');
  assert.match(approvals, /issueHumanDecision\('phone'/, 'the peer layer is where a phone decision is issued');
  assert.match(approvals, /getPairedDevice\(peer\.fingerprint\)/, 'from the DTLS identity, not the request');

  const callers = walk(BACKEND)
    .filter((f) => !f.endsWith(path.join('services', 'human-decision.ts')))
    .filter((f) => /\bissueHumanDecision\(/.test(fs.readFileSync(f, 'utf-8')))
    .map((f) => path.relative(BACKEND, f))
    .sort();
  assert.deepEqual(callers, ['server.ts', path.join('services', 'mobile-approvals.ts')]);
});
