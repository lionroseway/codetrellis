/**
 * Throwaway repositories for the journeys that need a shape the sample
 * app does not have.
 *
 * `tests/fixtures/sample-app` is nine languages and a cross-system map,
 * which covers the main loop. It cannot cover the journeys that are
 * *about* the repository: comparing against a commit needs commits, plan
 * conflicts need two branches, `git status` scoping needs a package
 * inside a larger repo, and the comparand picker has to degrade honestly
 * on a directory with no git in it at all.
 *
 * These are built at run time rather than committed, because a fixture
 * repo cannot be committed inside this one — a nested `.git` is either
 * ignored or becomes a submodule, and neither is what a journey wants.
 * Building them takes a few hundred milliseconds and makes the fixture's
 * history explicit in code instead of opaque in a tarball.
 *
 * Everything lands under one temp directory. `cleanupFixtures()` removes
 * it, and the demo calls that however it exits.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeWorkbook, makeDocx, makePdf } from '../src/backend/services/material-reader/fixtures.test-helper';

let root: string | null = null;

function base(): string {
  if (!root) root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-demo-fixtures-'));
  return root;
}

export function cleanupFixtures(): void {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
}

/** Where the fixtures live this run — printed so a failure can be inspected. */
export function fixtureRoot(): string | null {
  return root;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
}

function init(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  git(dir, 'config', 'user.email', 'demo@codetrellis.dev');
  git(dir, 'config', 'user.name', 'CodeTrellis demo');
}

function write(dir: string, rel: string, body: string | Buffer): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function commit(dir: string, message: string): string {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', message);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

export interface HistoryFixture {
  path: string;
  /** Oldest first — what the comparand picker should be able to offer. */
  commits: { sha: string; message: string }[];
}

/**
 * A repo with genuine history: three commits, then uncommitted work on
 * top of the last one.
 *
 * This is the fixture for "come back to a plan a day later". Reviewing
 * against the working tree and reviewing against the second commit are
 * different questions, and a fixture with one commit cannot tell them
 * apart.
 */
export function repoWithHistory(): HistoryFixture {
  const dir = path.join(base(), 'with-history');
  init(dir);
  const commits: { sha: string; message: string }[] = [];

  write(dir, 'src/money.go', 'package money\n\nfunc Add(a, b int64) int64 { return a + b }\n');
  write(dir, 'src/report.py', 'def total(rows):\n    return sum(rows)\n');
  commits.push({ sha: commit(dir, 'Initial ledger'), message: 'Initial ledger' });

  write(dir, 'src/money.go', 'package money\n\n// Round half-up.\nfunc Add(a, b int64) int64 { return a + b }\n');
  commits.push({ sha: commit(dir, 'Document the rounding rule'), message: 'Document the rounding rule' });

  write(dir, 'src/notify.rb', "def notify(amount)\n  puts amount\nend\n");
  commits.push({ sha: commit(dir, "Someone else's notifier"), message: "Someone else's notifier" });

  // Uncommitted, so "against the working tree" and "against HEAD~1" differ.
  write(dir, 'src/report.py', 'def total(rows):\n    return round(sum(rows), 2)\n');

  return { path: dir, commits };
}

/**
 * A package inside a larger repo.
 *
 * The project the user opens is `packages/checkout`; the repo root is two
 * levels up and has its own churn. This is the shape that broke `git
 * status` in the sidebar, where the parent repo's modified files were
 * listed against the opened package.
 */
export function monorepoPackage(): { repo: string; project: string } {
  const repo = path.join(base(), 'monorepo');
  init(repo);
  write(repo, 'packages/checkout/index.ts', 'export const checkout = () => 1;\n');
  write(repo, 'packages/billing/index.ts', 'export const bill = () => 2;\n');
  write(repo, 'tools/build.js', 'console.log("build");\n');
  commit(repo, 'Two packages and a tool');

  // Churn OUTSIDE the opened package. None of this belongs to checkout.
  write(repo, 'packages/billing/index.ts', 'export const bill = () => 3;\n');
  write(repo, 'tools/build.js', 'console.log("build v2");\n');

  return { repo, project: path.join(repo, 'packages', 'checkout') };
}

/** A plain directory. No git, no history, nothing to compare against. */
export function noGitDirectory(): string {
  const dir = path.join(base(), 'no-git');
  fs.mkdirSync(dir, { recursive: true });
  write(dir, 'app.ts', 'export const app = () => "hello";\n');
  return dir;
}

export interface BriefFixture {
  path: string;
  /** Project-relative, as record_artefact takes them. */
  workbook: string;
  guide: string;
  /** Where the agent writes its output — absent until it does. */
  output: string;
  /** The figure the agent cites, and where it lives. */
  cited: { sheet: string; range: string; value: number };
  /** The cell next to it — Q2, not Q3 — which the agent cites first, wrongly. */
  misread: { range: string; value: number };
}

/**
 * Work that is not code: a folder with a spreadsheet and a PDF guide in
 * it, and no git. The Brief has to hold up with nothing to diff — the
 * evidence is files and places in them, and a change to the data is what
 * makes an approval stale.
 *
 * Real files, built by the same helper the reader's own tests use, so a
 * locator the demo cites is checked against a workbook the product parses
 * rather than one a script only claims to have written.
 */
export function briefFolder(): BriefFixture {
  const dir = path.join(base(), 'q3-regional-review');
  fs.mkdirSync(dir, { recursive: true });
  const fixture: BriefFixture = {
    path: dir,
    workbook: 'data/q3-regional.xlsx',
    guide: 'guide/how-we-write-the-review.pdf',
    output: 'out/q3-analysis.docx',
    cited: { sheet: 'Regional', range: 'C3', value: 342 },
    misread: { range: 'B3', value: 318 },
  };
  write(dir, fixture.workbook, regionalWorkbook(fixture.cited.value));
  write(dir, fixture.guide, makePdf([
    'How we write the regional review',
    'Every figure cites its sheet and cell, e.g. Regional!C3.',
    'The report owner signs it off before it goes to the board.',
  ]));
  return fixture;
}

/** The workbook, with EMEA's Q3 figure (Regional!C3) set to `emeaQ3`. */
export function regionalWorkbook(emeaQ3: number): Buffer {
  return makeWorkbook({
    Regional: [
      ['Region', 'Q2', 'Q3'],
      ['Americas', 410, 452],
      ['EMEA', 318, emeaQ3],
      ['APAC', 205, 231],
    ],
    Notes: [['Source: finance ledger export, 1 October']],
  });
}

/** The agent's output: a short Word document that states and cites the figure. */
export function analysisDocx(figure: number, citation: string): Buffer {
  return makeDocx([
    '# Q3 regional analysis',
    `EMEA grew to ${figure} in Q3 (${citation}).`,
    'Every figure here cites the sheet and cell it came from.',
  ]);
}

/** `git init` and nothing committed — a real state on day one of a project. */
export function repoWithNoCommits(): string {
  const dir = path.join(base(), 'no-commits');
  init(dir);
  write(dir, 'app.ts', 'export const app = () => "hello";\n');
  return dir;
}

export interface ConflictFixture {
  path: string;
  /** The manifest path both branches edited. */
  manifest: string;
}

/**
 * Two branches that edited the same plan manifest, merged to conflict.
 *
 * Plans are git-backed under `.codetrellis/plans/`, which means two
 * people planning on two branches produce an ordinary merge conflict in
 * YAML. Resolving that by hand-editing conflict markers is exactly what
 * the conflict surface exists to avoid, so the journey needs a repo left
 * sitting in a conflicted state.
 */
export function repoWithPlanConflict(): ConflictFixture {
  const dir = path.join(base(), 'plan-conflict');
  init(dir);
  const manifest = '.codetrellis/plans/rounding/plan.yaml';

  write(dir, 'src/money.go', 'package money\n');
  write(dir, manifest, ['uid: pln_demo', 'title: Consistent rounding', 'status: active', 'owner: alice', ''].join('\n'));
  commit(dir, 'Plan the rounding work');

  git(dir, 'checkout', '-q', '-b', 'theirs');
  write(dir, manifest, ['uid: pln_demo', 'title: Consistent rounding everywhere', 'status: active', 'owner: bob', ''].join('\n'));
  commit(dir, 'Bob widens the scope');

  git(dir, 'checkout', '-q', 'main');
  write(dir, manifest, ['uid: pln_demo', 'title: Consistent rounding', 'status: review', 'owner: alice', ''].join('\n'));
  commit(dir, 'Alice sends it for review');

  try {
    git(dir, 'merge', '--no-edit', 'theirs');
  } catch {
    // Expected: the merge conflicts, and leaving it conflicted is the
    // entire point of the fixture.
  }

  return { path: dir, manifest };
}
