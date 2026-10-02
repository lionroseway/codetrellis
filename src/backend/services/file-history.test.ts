/**
 * A file's history on any side (Phase 32 E3): the commits that touched it,
 * following a rename, each with its git author and what CodeTrellis knows;
 * the working copy on top where a side has one; refusals.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { agentOfBody, fileHistory, FileHistoryError, parseFileLog } from './file-history';
import type { Workstream } from '../../shared/types';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir: string, rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

/** round.ts, renamed to refund.ts, edited twice (once by an agent's commit), and an unrelated commit. */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hist-'));
  write(dir, 'src/round.ts', 'export const r = (x: number) => Math.round(x);\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Start');
  git(dir, 'mv', 'src/round.ts', 'src/refund.ts');
  git(dir, 'commit', '-qm', 'Name it for refunds');
  write(dir, 'src/refund.ts', 'export const r = (x: number) => Math.round(x * 100) / 100;\n');
  git(dir, 'commit', '-qam', 'Round to the cent\n\nagent: codex · model: o5');
  write(dir, 'README.md', 'readme\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Readme');
  write(dir, 'src/refund.ts', 'export const r = (x: number) => roundHalfEven(x, 2);\n');
  git(dir, 'commit', '-qam', 'Half-even');
  return dir;
}

test('parses git\'s log: author, time, subject, how the file changed, and a rename\'s two paths', () => {
  const out = '\x1eabc1234def\x1fSam Lee\x1fsam@acme.test\x1f1790000000\x1fRound to the cent\n\nagent: codex\n\x1d\n\nM\tsrc/refund.ts\n'
    + '\x1e1111111aaa\x1fSam Lee\x1fsam@acme.test\x1f1789000000\x1fName it\n\x1d\n\nR100\tsrc/round.ts\tsrc/refund.ts\n';
  const rows = parseFileLog(out);
  assert.deepEqual(rows.map((r) => [r.short, r.subject, r.status, r.path, r.from ?? null, r.at]), [
    ['abc1234', 'Round to the cent', 'modified', 'src/refund.ts', null, 1790000000000],
    ['1111111', 'Name it', 'renamed', 'src/refund.ts', 'src/round.ts', 1789000000000],
  ]);
  assert.equal(agentOfBody(rows[0].body), 'codex');
  assert.equal(agentOfBody('Readme\n'), null);
});

test('this checkout: the working copy on top, then every commit that changed the file, through its rename', () => {
  const dir = repo();
  write(dir, 'src/refund.ts', 'export const r = (x: number) => roundHalfEven(x, 2); // edited\n');
  const h = fileHistory(dir, 'live', 'src/refund.ts', []);
  assert.deepEqual(h.positions.map((p) => [p.kind, p.subject, p.path, p.status]), [
    ['working', null, 'src/refund.ts', null],
    ['commit', 'Half-even', 'src/refund.ts', 'modified'],
    ['commit', 'Round to the cent', 'src/refund.ts', 'modified'],
    ['commit', 'Name it for refunds', 'src/refund.ts', 'renamed'],
    ['commit', 'Start', 'src/round.ts', 'added'],
  ]);
  // Before the rename, the file is read at the path it had then.
  assert.equal(h.positions[3].from, 'src/round.ts');
  assert.equal(git(dir, 'show', `${h.positions[4].sha}:src/round.ts`), 'export const r = (x: number) => Math.round(x);');
  // The git author always; what CodeTrellis knows, with how.
  assert.ok(h.positions.slice(1).every((p) => p.author === 'Sam Lee'));
  assert.deepEqual(h.positions[2].attribution, { agent: 'codex', how: 'commit message', words: 'codex, from the commit message', sessionId: null });
  assert.equal(h.positions[1].attribution, null);
  assert.equal(h.command, 'git log --follow -- src/refund.ts');
  assert.equal(h.truncated, false);
});

test('a commit CodeTrellis saw land while an agent worked is attributed to it, said as seen', () => {
  const dir = repo();
  const head = git(dir, 'rev-parse', 'HEAD');
  const h = fileHistory(dir, 'commit:refs/heads/main', 'src/refund.ts', [], (shas) => {
    assert.ok(shas.includes(head));
    return new Map([[head, { agentType: 'claude-code', sessionId: 's-bill', workstreamRoot: '/work/acme-billing' }]]);
  });
  // A branch has no working copy: commits only.
  assert.equal(h.positions[0].kind, 'commit');
  assert.deepEqual(h.positions[0].attribution, {
    agent: 'claude-code', how: 'seen', sessionId: 's-bill',
    words: 'claude-code, seen: it landed while CodeTrellis recorded claude-code\'s session in acme-billing',
  });
  assert.equal(h.label, 'main');
  assert.equal(h.command, 'git log --follow main -- src/refund.ts');
});

test('another worktree: its working copy on top, then its own commits', () => {
  const dir = repo();
  const wt = `${dir}-wt`;
  git(dir, 'worktree', 'add', '-q', '-b', 'agent-work', wt, 'main');
  write(wt, 'src/refund.ts', 'export const r = (x: number) => roundToCent(x);\n');
  git(wt, 'commit', '-qam', 'Round to cent, again');
  const ws = { root: wt, branch: 'agent-work', head: git(wt, 'rev-parse', 'HEAD'), main: false } as Workstream;
  const h = fileHistory(dir, `workstream:${wt}`, 'src/refund.ts', [ws]);
  assert.deepEqual(h.positions.slice(0, 2).map((p) => [p.kind, p.spec.startsWith('workstream:') || p.spec.startsWith('commit:'), p.subject]), [
    ['working', true, null],
    ['commit', true, 'Round to cent, again'],
  ]);
  assert.equal(h.positions[0].spec, `workstream:${wt}`);
  assert.equal(h.command, 'git log --follow agent-work -- src/refund.ts');
});

test('refused: a ref that is an option, a worktree not listed, a range; a file with no history is empty, not an error', () => {
  const dir = repo();
  assert.throws(() => fileHistory(dir, 'commit:--output=/tmp/x', 'src/refund.ts', []), FileHistoryError);
  assert.throws(() => fileHistory(dir, 'commit:main..HEAD', 'src/refund.ts', []), FileHistoryError);
  assert.throws(() => fileHistory(dir, 'workstream:/etc', 'src/refund.ts', []), FileHistoryError);
  assert.throws(() => fileHistory(dir, 'merge-base:--x...main', 'src/refund.ts', []), FileHistoryError);
  assert.deepEqual(fileHistory(dir, 'commit:HEAD', 'src/never.ts', []).positions, []);
});

test('a project in a subfolder of its repository: paths are its own', () => {
  const dir = repo();
  write(dir, 'packages/api/index.ts', 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'api');
  write(dir, 'packages/api/index.ts', 'b\n');
  git(dir, 'commit', '-qam', 'api b');
  const h = fileHistory(path.join(dir, 'packages', 'api'), 'commit:HEAD', 'index.ts', []);
  assert.deepEqual(h.positions.map((p) => [p.subject, p.path]), [['api b', 'index.ts'], ['api', 'index.ts']]);
});
