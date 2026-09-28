/**
 * Reading a workstream's own commits (Phase 32 B2.2): the log format parsed
 * into commits, a merge told apart, and the agent named in the message.
 * Which commits each lane gets, from real git, is tests/e2e/lane-marks.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommits } from './workstream-commits';

const RS = '\x1e';
const US = '\x1f';
const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const record = (sha: string, parents: string, at: string, author: string, subject: string, body = '') =>
  [sha, parents, at, author, subject, body].join(US) + RS;

test('commits in order, a merge by its parents, and the agent from an `agent:` line', () => {
  const raw = [
    record(a, `${b} ${c}`, '2026-09-28T10:00:05Z', 'Sam', 'Merge auth-side'),
    `\n${record(b, c, '2026-09-28T10:00:00Z', 'Sam', 'Tighten email check', 'Why.\n\nagent: codex · model: x\n')}`,
  ].join('');
  assert.deepEqual(parseCommits(raw), [
    { sha: a, at: Date.parse('2026-09-28T10:00:05Z'), author: 'Sam', subject: 'Merge auth-side', merge: true, agent: null },
    { sha: b, at: Date.parse('2026-09-28T10:00:00Z'), author: 'Sam', subject: 'Tighten email check', merge: false, agent: 'codex' },
  ]);
});

test('anything that is not a commit record is left out', () => {
  assert.deepEqual(parseCommits(''), []);
  assert.deepEqual(parseCommits(`not a sha${US}x${US}y${RS}`), []);
});
