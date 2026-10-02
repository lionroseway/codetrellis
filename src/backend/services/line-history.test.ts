/**
 * Line history (Phase 32 E4): each line's commit and git author, as GitLens
 * shows it; what CodeTrellis adds, with how it knows (the commit message,
 * a Co-Authored-By trailer, seen, timing, or the git author only); lines
 * not yet committed; refusals.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { agentFromMessage, attributeCommits, isProjectRelativePath, NO_KNOWLEDGE, type Knowledge } from './commit-attribution';
import { hunksOf, lineHistory, LineHistoryError, lineWords, parseBlame } from './line-history';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** refund.ts: line 1 by a person, line 2 by an agent's commit (agent: line), line 3 by Claude Code (trailer). */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-blame-'));
  fs.writeFileSync(path.join(dir, 'refund.ts'), 'export const a = 1;\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Start');
  fs.appendFileSync(path.join(dir, 'refund.ts'), 'export const cents = (x: number) => Math.round(x * 100) / 100;\n');
  git(dir, 'commit', '-qam', 'Round to the cent\n\nagent: codex · model: o5');
  fs.appendFileSync(path.join(dir, 'refund.ts'), 'export const halfEven = true;\n');
  git(dir, 'commit', '-qam', 'Half-even\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>');
  return dir;
}

test('what a commit message says: the agent line, an agent\'s Co-Authored-By trailer, or nothing', () => {
  assert.deepEqual(agentFromMessage('Round\n\nagent: codex · model: o5\n'), { agent: 'codex', how: 'commit message', words: 'codex, from the commit message' });
  assert.deepEqual(agentFromMessage('Half-even\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'), {
    agent: 'claude', how: 'commit message', words: "claude, from the commit's Co-Authored-By trailer (Claude Opus 5.5)",
  });
  // A person as co-author is not an agent.
  assert.equal(agentFromMessage('Pair\n\nCo-Authored-By: Priya Shah <priya@acme.test>\n'), null);
  assert.equal(agentFromMessage('Fix typo\n'), null);
});

test('attribution in order: the message, then seen, then timing in this checkout; the task and plan where the session is known', () => {
  const know: Knowledge = {
    seenBy: () => new Map([['b'.repeat(40), { agentType: 'codex', sessionId: 's-seen', workstreamRoot: '/work/acme' }]]),
    sessionAt: (root, at) => (root === '/repo' && at === 3000 ? { sessionId: 's-time', agentType: 'cursor' } : null),
    taskOf: (id) => (id === 's-time' ? { task: { uid: 't1', title: 'Round refunds' }, plan: { uid: 'p1', title: 'Refunds' } } : null),
  };
  const rows = [
    { sha: 'a'.repeat(40), at: 1000, body: 'x\n\nagent: claude-code\n' },
    { sha: 'b'.repeat(40), at: 2000, body: 'y\n' },
    { sha: 'c'.repeat(40), at: 3000, body: 'z\n' },
    { sha: 'd'.repeat(40), at: 4000, body: 'w\n' },
  ];
  const a = attributeCommits(rows, '/repo', know);
  assert.equal(a.get('a'.repeat(40))?.how, 'commit message');
  assert.deepEqual(a.get('b'.repeat(40)), { agent: 'codex', how: 'seen', sessionId: 's-seen', words: "codex, seen: it landed while CodeTrellis recorded codex's session in acme" });
  assert.deepEqual(a.get('c'.repeat(40)), {
    agent: 'cursor', how: 'timing', sessionId: 's-time',
    words: "probably cursor: committed while cursor's session was open in this checkout",
    task: { uid: 't1', title: 'Round refunds' }, plan: { uid: 'p1', title: 'Refunds' },
  });
  // The git author only: no entry.
  assert.equal(a.has('d'.repeat(40)), false);
  // Read from a ref, not a checkout: no timing.
  assert.equal(attributeCommits(rows, null, know).has('c'.repeat(40)), false);
});

test('each line\'s commit and git author, grouped into runs, with what CodeTrellis adds', () => {
  const dir = repo();
  const h = lineHistory(dir, 'live', 'refund.ts', []);
  assert.equal(h.lineCount, 3);
  assert.deepEqual(h.hunks.map((x) => [x.start, x.end]), [[1, 1], [2, 2], [3, 3]]);
  const [c1, c2, c3] = h.hunks.map((x) => h.commits[x.sha!]);
  assert.deepEqual([c1.subject, c1.author, c1.attribution], ['Start', 'Sam Lee', null]);
  assert.equal(c2.attribution?.words, 'codex, from the commit message');
  assert.equal(c3.attribution?.agent, 'claude');
  assert.equal(h.uncommitted, 0);
  assert.equal(h.command, 'git blame -- refund.ts');
  assert.match(lineWords(h, 2, c2.at + 3 * 86_400_000), /^Line 2: Sam Lee · 3 days ago · “Round to the cent” \([0-9a-f]{7}\); codex, from the commit message\.$/);
  assert.equal(lineWords(h, 9), 'Line 9 is not in refund.ts (it has 3 lines).');
});

test('lines not yet committed say so; a branch reads its own lines', () => {
  const dir = repo();
  fs.appendFileSync(path.join(dir, 'refund.ts'), '// working on it\n');
  const h = lineHistory(dir, 'live', 'refund.ts', []);
  assert.deepEqual(h.hunks[h.hunks.length - 1], { start: 4, end: 4, sha: null });
  assert.equal(h.uncommitted, 1);
  assert.equal(lineWords(h, 4), 'Line 4 is changed in the working copy and not yet committed.');
  const b = lineHistory(dir, 'commit:refs/heads/main', 'refund.ts', []);
  assert.equal(b.lineCount, 3);
  assert.equal(b.command, 'git blame main -- refund.ts');
});

test('parses porcelain: a commit\'s details given once, every line after', () => {
  const sha = 'f'.repeat(40);
  const out = `${sha} 1 1 2\nauthor Sam Lee\nauthor-mail <sam@acme.test>\nauthor-time 1790000000\nsummary Start\nfilename a.ts\n\tone\n${sha} 2 2\n\ttwo\n${'0'.repeat(40)} 3 3 1\nauthor Not Committed Yet\nsummary Version of a.ts from a.ts\n\tthree\n`;
  const p = parseBlame(out);
  assert.deepEqual(p.lines, [sha, sha, '0'.repeat(40)]);
  assert.deepEqual(p.info.get(sha), { author: 'Sam Lee', email: 'sam@acme.test', at: 1790000000000, summary: 'Start' });
  assert.deepEqual(hunksOf(p.lines), [{ start: 1, end: 2, sha }, { start: 3, end: 3, sha: null }]);
});

test('refused: a ref that is an option, a worktree not listed, a file git does not know, a path that climbs out', () => {
  const dir = repo();
  assert.throws(() => lineHistory(dir, 'commit:--output=/tmp/x', 'refund.ts', []), LineHistoryError);
  assert.throws(() => lineHistory(dir, 'workstream:/etc', 'refund.ts', []), LineHistoryError);
  assert.throws(() => lineHistory(dir, 'index', 'refund.ts', []), LineHistoryError);
  assert.throws(() => lineHistory(dir, 'live', 'never.ts', []), LineHistoryError);
  for (const bad of ['../x', '/etc/passwd', '-x', ':(top)x', 'C:\\x', '']) assert.equal(isProjectRelativePath(bad), false, bad);
  assert.equal(isProjectRelativePath('src/a.ts'), true);
  void NO_KNOWLEDGE;
});
