/**
 * Source control with no plan (Phase 32 E1): what changed, by where, each
 * group with the two points to diff, on real repositories, including the
 * three ways the code view used to show no diff where the graph showed
 * changes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseNameStatus, parsePorcelain, sourceControl } from './source-control';
import { readFileAt } from './snapshot-compare-service';
import type { Workstream } from '../../shared/types';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8' }).trim();

function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sc-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Start');
  return dir;
}

test('porcelain: staged, unstaged, untracked and a staged rename, relative to a subfolder', () => {
  const out = ['M  api/a.ts', ' M api/b.ts', 'MM api/c.ts', '?? api/new.ts', 'R  api/to.ts', 'api/from.ts', 'A  api/d.ts', ''].join('\0');
  const r = parsePorcelain(out, 'api/');
  assert.deepEqual(r.staged, [
    { path: 'a.ts', status: 'modified' }, { path: 'c.ts', status: 'modified' },
    { path: 'to.ts', status: 'renamed', from: 'from.ts' }, { path: 'd.ts', status: 'added' },
  ]);
  assert.deepEqual(r.changes, [{ path: 'b.ts', status: 'modified' }, { path: 'c.ts', status: 'modified' }]);
  assert.deepEqual(r.untracked, [{ path: 'new.ts', status: 'untracked' }]);
  assert.deepEqual(parseNameStatus(['M', 'x.ts', 'R087', 'old.ts', 'new.ts', 'D', 'gone.ts', ''].join('\0'), ''), [
    { path: 'x.ts', status: 'modified' }, { path: 'new.ts', status: 'renamed', from: 'old.ts' }, { path: 'gone.ts', status: 'deleted' },
  ]);
});

test('nothing changed: says so, with the last commit', () => {
  const dir = repo({ 'a.ts': 'export const a = 1;\n' });
  const sc = sourceControl(dir, git(dir, 'rev-parse', 'HEAD'), []);
  assert.equal(sc.git, true);
  assert.equal(sc.branch, 'main');
  assert.deepEqual(sc.groups, []);
  assert.match(sc.words, /^Nothing has changed: this checkout matches its last commit \([0-9a-f]{7} “Start”\), and no other worktree or branch has work in progress\.$/);
});

test('this checkout: staged, unstaged and untracked, each with the two sides that show its diff', () => {
  const dir = repo({ 'a.ts': 'a1\n', 'b.ts': 'b1\n' });
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a2\n');
  git(dir, 'add', 'a.ts');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a3\n');
  fs.writeFileSync(path.join(dir, 'new.ts'), 'n\n');
  const sc = sourceControl(dir, null, []);
  assert.deepEqual(sc.groups.map((g) => [g.kind, g.before, g.after, g.files.map((f) => `${f.status} ${f.path}`)]), [
    ['staged', 'commit:HEAD', 'index', ['modified a.ts']],
    ['changes', 'index', 'live', ['modified a.ts']],
    ['untracked', 'none', 'live', ['untracked new.ts']],
  ]);
  // Read two ways: a plain title for anyone, git's own word and command beside it.
  assert.deepEqual(sc.groups.map((g) => [g.title, g.git.term, g.git.command]), [
    ['Ready to commit', 'staged', 'git diff --cached'],
    ['Changed, not staged', 'unstaged', 'git diff'],
    ['New files', 'untracked', 'git status --untracked-files'],
  ]);
  // Each side reads what it says.
  assert.equal(readFileAt('commit:HEAD', dir, 'a.ts').content, 'a1\n');
  assert.equal(readFileAt('index', dir, 'a.ts').content, 'a2\n');
  assert.equal(readFileAt('live', dir, 'a.ts').content, 'a3\n');
  assert.equal(readFileAt('none', dir, 'new.ts').content, null);
  assert.equal(sc.words, '2 files changed in this checkout.');
});

test('the defect, case A: an agent committed its edit; the working tree is clean, and the commits since the baseline are listed', () => {
  const dir = repo({ 'refund.ts': 'round(x)\n' });
  const baseline = git(dir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'refund.ts'), 'roundHalfEven(x)\n');
  git(dir, 'commit', '-qam', 'Round half-even');
  const sc = sourceControl(dir, baseline, []);
  const g = sc.groups.find((x) => x.kind === 'since-opened')!;
  assert.deepEqual([g.before, g.after, g.files], [`commit:${baseline}`, 'commit:HEAD', [{ path: 'refund.ts', status: 'modified' }]]);
  assert.equal(g.words, `1 commit since ${baseline.slice(0, 7)}, when the graph's baseline was taken`);
  assert.deepEqual(g.git, { term: null, command: `git diff ${baseline.slice(0, 7)}..HEAD` });
  assert.notEqual(readFileAt(g.before, dir, 'refund.ts').content, readFileAt(g.after, dir, 'refund.ts').content);
  assert.equal(sc.words, '1 file committed since you opened it.');
});

test('the defect, case B: an agent works in another worktree; its files are listed against where it left main', () => {
  const dir = repo({ 'refund.ts': 'round(x)\n' });
  const base = git(dir, 'rev-parse', 'HEAD');
  const ws: Workstream = {
    root: `${dir}-billing`, branch: 'billing-v2', head: base, main: false, shape: 'worktree', idle: false,
    agents: [{ sessionId: 's1', agentType: 'codex', model: null, source: 'mcp', lastSeen: Date.now() }],
    changes: { base, files: [{ path: 'refund.ts', status: 'modified' }], truncated: false },
  } as Workstream;
  const own = { ...ws, root: dir, branch: 'main', main: true, changes: { base, files: [{ path: 'x', status: 'modified' as const }], truncated: false } } as Workstream;
  const sc = sourceControl(dir, base, [own, ws]);
  // Its own checkout is not listed as "other work".
  assert.deepEqual(sc.groups.map((g) => [g.kind, g.title, g.before, g.after]), [['workstream', 'billing-v2', `commit:${base}`, `workstream:${dir}-billing`]]);
  assert.equal(sc.groups[0].words, 'A worktree with 1 changed file since it left main, worked on by codex');
  assert.deepEqual(sc.groups[0].workstream, { id: `${dir}-billing`, branch: 'billing-v2', agents: ['codex'] });
  assert.deepEqual(sc.groups[0].labels, { before: `Where it left main (${base.slice(0, 7)})`, after: 'billing-v2' });
  assert.deepEqual(sc.groups[0].git, { term: 'worktree', command: `git -C ${dir}-billing diff ${base.slice(0, 7)}` });
});

test('the defect, case C: a project in a subfolder of its repository reads its files at a commit, and lists only its own changes', () => {
  const dir = repo({ 'packages/api/index.ts': 'export const a = 1;\n', 'packages/web/app.ts': 'w\n' });
  const sub = path.join(dir, 'packages', 'api');
  fs.appendFileSync(path.join(sub, 'index.ts'), 'export const b = 2;\n');
  fs.appendFileSync(path.join(dir, 'packages/web/app.ts'), 'w2\n');
  assert.equal(readFileAt('commit:HEAD', sub, 'index.ts').content, 'export const a = 1;\n');
  const sc = sourceControl(sub, null, []);
  assert.deepEqual(sc.groups.map((g) => [g.kind, g.files.map((f) => f.path)]), [['changes', ['index.ts']]]);
});

test('not a git repository: said, not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sc-nogit-'));
  const sc = sourceControl(dir, null, []);
  assert.equal(sc.git, false);
  assert.equal(sc.words, 'This folder is not a git repository, so there is nothing to compare it with.');
});
