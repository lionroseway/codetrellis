/**
 * Phase 33 follow-up — one listing for callers who ask together, and
 * worktrees' symbols inside a budget.
 *
 * On a checkout with 50 worktrees the window's six asks as it opened each ran
 * the whole pass at once, and every changed file of every worktree (8,000 of
 * them) was parsed before the first answered: minutes, while the graph's own
 * request queued behind them. Callers asking together now share one listing,
 * and a listing parses at most INLINE_SYMBOL_FILES of the worktrees' files;
 * the rest are parsed in the background, and the window is told.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-listing-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const repo = path.join(tmp, 'app');
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: ENV }).trim();
const TREES = ['one', 'two', 'three'];

let ws: typeof import('./workstream-service');
let branches: typeof import('./branch-workstreams');
let parsed = 0;
const fakeParse = (_file: string, content: string) => {
  parsed++;
  return [...content.matchAll(/export function (\w+)/g)].map((m, i) => ({ name: m[1], kind: 'function', startLine: i + 1, endLine: i + 1, modifiers: [], children: [] })) as never;
};

before(async () => {
  fs.mkdirSync(repo, { recursive: true });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), '# app\n');
  git('add', '-A'); git('commit', '-qm', 'main');
  // Three worktrees with 30 new files each, uncommitted: 90, past one listing's budget.
  for (const t of TREES) {
    const dir = path.join(tmp, t);
    git('worktree', 'add', '-q', '-b', t, dir);
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(dir, `${t}${i}.ts`), `export function ${t}${i}() {}\n`);
  }
  const db = await import('./database');
  await db.initDatabase();
  ws = await import('./workstream-service');
  branches = await import('./branch-workstreams');
});

// The listing starts the folders' watchers; stop them, or the process never ends.
after(async () => { await (await import('./workstream-watch-service')).stopWorkstreamWatchers(); });

test('callers who ask together share one listing; a fresh one gets its own', async () => {
  const [a, b] = await Promise.all([ws.listWorkstreams(repo, { includeIdle: true }), ws.listWorkstreams(repo)]);
  assert.ok(a.length >= TREES.length + 1, 'the main checkout and the three worktrees');
  const one = a.find((w) => w.branch === 'one')!;
  assert.equal(b.find((w) => w.branch === 'one'), one, 'the same answer, not a second pass');
  assert.ok(b.every((w) => !w.idle), 'each caller still gets its own filter');
  const fresh = await ws.listWorkstreams(repo, { includeIdle: true, fresh: true });
  assert.notEqual(fresh.find((w) => w.branch === 'one'), one, 'fresh promises an answer begun after it asked');
});

test('one listing parses at most its budget of the worktrees\' files; the rest in the background, and the window is told', async () => {
  const told: string[] = [];
  branches.setBranchWorkstreamsWarmedListener((r) => told.push(r));
  ws.setSymbolParser(fakeParse);
  parsed = 0;
  try {
    const first = await ws.listWorkstreams(repo, { includeIdle: true, fresh: true });
    const trees = first.filter((w) => TREES.includes(w.branch ?? ''));
    assert.equal(trees.length, TREES.length, 'every worktree is listed at once');
    assert.ok(parsed <= ws.INLINE_SYMBOL_FILES, `parsed ${parsed} inline`);
    assert.ok(trees.some((w) => w.changes.files.every((f) => !f.symbols)), 'a worktree past the budget is listed without its symbols yet');

    await ws.branchSymbolsWarmed(repo);
    assert.ok(told.includes(repo), 'the window is told when they are ready');

    parsed = 0;
    const again = await ws.listWorkstreams(repo, { includeIdle: true, fresh: true });
    assert.equal(parsed, 0, 'nothing is parsed twice');
    for (const w of again.filter((x) => TREES.includes(x.branch ?? ''))) {
      assert.equal(w.changes.files.length, 30);
      assert.ok(w.changes.files.every((f) => f.symbols && f.symbols.length === 1), `${w.branch} has every file's symbols`);
    }
  } finally {
    ws.setSymbolParser(null);
    branches.setBranchWorkstreamsWarmedListener(() => {});
  }
});
