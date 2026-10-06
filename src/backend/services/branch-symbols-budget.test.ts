/**
 * Phase 33 0.1 — a listing parses branches' symbols inside a budget.
 *
 * With twenty branches of forty changed files each on the remote, every
 * file was parsed before the window's first read of awareness answered:
 * 7 s, and over 10 s under load, while the tab said "Checking for
 * overlaps…". Now one listing parses at most INLINE_SYMBOL_FILES of them;
 * the rest are parsed in the background, and the window is told.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-branch-symbols-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const repo = path.join(tmp, 'app');
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: ENV }).trim();

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
  // Three branches of 30 new files each: 90, past one listing's budget.
  for (const b of ['one', 'two', 'three']) {
    git('checkout', '-qb', b, 'main');
    fs.mkdirSync(path.join(repo, b), { recursive: true });
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(repo, b, `f${i}.ts`), `export function ${b}${i}() {}\n`);
    git('add', '-A'); git('commit', '-qm', b);
  }
  git('checkout', '-q', 'main');
  const db = await import('./database');
  await db.initDatabase();
  ws = await import('./workstream-service');
  branches = await import('./branch-workstreams');
});

// The listing starts the folders' watchers; stop them, or the process never ends.
after(async () => { await (await import('./workstream-watch-service')).stopWorkstreamWatchers(); });

test('one listing parses at most its budget; the rest are parsed in the background, and the window is told', async () => {
  const told: string[] = [];
  branches.setBranchWorkstreamsWarmedListener((r) => told.push(r));
  ws.setSymbolParser(fakeParse);
  try {
    const first = await ws.listWorkstreams(repo, { includeIdle: true });
    const listed = first.filter((w) => w.root.startsWith('branch:'));
    assert.equal(listed.length, 3, 'every branch is listed at once');
    // Parsed inline: at most the budget (each new file parses its one version).
    const inline = parsed;
    assert.ok(inline <= ws.INLINE_SYMBOL_FILES, `parsed ${inline} inline`);
    assert.ok(listed.some((w) => w.changes.files.every((f) => !f.symbols)), 'a branch past the budget is listed without its symbols yet');

    await branches.branchWorkstreamsWarmed(repo);
    await ws.branchSymbolsWarmed(repo);
    assert.ok(told.includes(repo), 'the window is told when they are ready');

    parsed = 0;
    const again = await ws.listWorkstreams(repo, { includeIdle: true });
    assert.equal(parsed, 0, 'nothing is parsed twice');
    for (const w of again.filter((x) => x.root.startsWith('branch:'))) {
      assert.ok(w.changes.files.every((f) => f.symbols && f.symbols.length === 1), `${w.root} has every file's symbols`);
    }
  } finally {
    ws.setSymbolParser(null);
  }
});
