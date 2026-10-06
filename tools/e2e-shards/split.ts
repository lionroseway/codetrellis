/**
 * The browser suite's shards, balanced by weight (Phase 33 follow-up).
 *
 * Playwright's `--shard` cuts the test order into equal runs of tests. The
 * specs that open a page take about 15 s each in CI and the ones that only
 * call the API well under one, and they are not spread evenly: e2e/plan/*
 * is almost all page tests, so one shard ran 185 of them for 25 minutes
 * while the other two were done in 7. Every pull request waited on it.
 *
 * Here each spec file is weighed by its tests (one that takes the `page`
 * fixture 15, any other 1), and whole files are dealt to shards heaviest
 * first, each to the lightest so far. A file stays in one shard, so its
 * `beforeAll` and serial describes run once. The order is fixed, so every
 * shard computes the same split, and every file is in exactly one.
 *
 *   node --import tsx tools/e2e-shards/split.ts chromium 2/3 > shard.txt
 *   npx playwright test --project=chromium --test-list shard.txt
 *
 * It reads the tests from `playwright test --list`, so a new spec is in a
 * shard the day it lands, with no table of timings to go stale.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PAGE_WEIGHT = 15;
export const API_WEIGHT = 1;

/** A test's weight from the line it is declared on: one that takes the page costs a page load. */
export function testWeight(declaration: string): number {
  return /\(\s*\{[^}]*\bpage\b/.test(declaration) ? PAGE_WEIGHT : API_WEIGHT;
}

/** Whole files to `shards` shards, heaviest first, each to the lightest so far; ties to the lower shard. */
export function splitFiles(weights: ReadonlyMap<string, number>, shards: number): string[][] {
  const out = Array.from({ length: shards }, () => ({ files: [] as string[], weight: 0 }));
  const files = [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [file, weight] of files) {
    let lightest = 0;
    for (let i = 1; i < shards; i++) if (out[i].weight < out[lightest].weight) lightest = i;
    out[lightest].files.push(file);
    out[lightest].weight += weight;
  }
  return out.map((s) => s.files.sort());
}

interface ListedSuite { specs?: Array<{ file: string; line: number; tests: Array<{ projectName: string }> }>; suites?: ListedSuite[] }

/** Each file's weight in `project`, from Playwright's own list of its tests; paths relative to the test dir. */
export function weighProject(listing: { config: { rootDir: string }; suites: ListedSuite[] }, project: string, read: (file: string) => string): Map<string, number> {
  const weights = new Map<string, number>();
  const lines = new Map<string, string[]>();
  const walk = (s: ListedSuite) => {
    for (const spec of s.specs ?? []) {
      const runs = spec.tests.filter((t) => t.projectName === project).length;
      if (!runs) continue;
      if (!lines.has(spec.file)) lines.set(spec.file, read(spec.file).split('\n'));
      const declaration = (lines.get(spec.file)!.slice(spec.line - 1, spec.line + 2)).join(' ');
      weights.set(spec.file, (weights.get(spec.file) ?? 0) + runs * testWeight(declaration));
    }
    for (const c of s.suites ?? []) walk(c);
  };
  for (const s of listing.suites) walk(s);
  return weights;
}

function main(): void {
  const [project, which] = process.argv.slice(2);
  const m = /^(\d+)\/(\d+)$/.exec(which ?? '');
  if (!project || !m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) {
    process.stderr.write('usage: split.ts <project> <index>/<shards>\n');
    process.exit(2);
  }
  const [index, shards] = [Number(m[1]), Number(m[2])];
  const json = execFileSync('npx', ['playwright', 'test', `--project=${project}`, '--list', '--reporter=json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  const listing = JSON.parse(json) as { config: { rootDir: string }; suites: ListedSuite[] };
  const testDir = listing.config.rootDir;
  const weights = weighProject(listing, project, (file) => fs.readFileSync(path.join(testDir, file), 'utf8'));
  const split = splitFiles(weights, shards);
  split.forEach((files, i) => process.stderr.write(`shard ${i + 1}/${shards}: ${files.length} files, weight ${files.reduce((n, f) => n + weights.get(f)!, 0)}\n`));
  process.stdout.write(`${split[index - 1].join('\n')}\n`);
}

if (require.main === module) main();
