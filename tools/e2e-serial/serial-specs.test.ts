/**
 * Every browser spec that works in the sample app runs in the `serial`
 * project, with the backend to itself: listed in FIXTURE_SPECS, or in
 * SERIAL_SPECS for a reason of its own.
 *
 * The backend holds one project at a time. A spec opening the sample app
 * beside one opening this repository swaps the project under both; the
 * list in playwright.config.ts says so, and plan-by-hand was missing from
 * it for weeks, failing now and then on PRs that had nothing to do with it
 * (#147, #158). Twelve more were missing when this was written. Nothing
 * else notices a spec left off: it passes, until it does not.
 *
 * "Works in the sample app" is read from the source: a project path, or a
 * plan's, that is the helpers' FIXTURE_PATH or a constant the spec points at
 * tests/fixtures/sample-app. Marketing specs are not run in the suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { FIXTURE_SPECS, SERIAL_SPECS } from '../../playwright.config';

const root = path.resolve(__dirname, '..', '..');
const e2e = path.join(root, 'e2e');

function specs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return specs(p);
    return d.name.endsWith('.spec.ts') ? [path.relative(root, p).split(path.sep).join('/')] : [];
  });
}

/** Whether a spec uses the sample app as its project, or a plan's. */
export function usesSampleApp(source: string): boolean {
  const names = new Set(['FIXTURE_PATH']);
  for (const m of source.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=[^;\n]*sample-app/g)) names.add(m[1]);
  const name = [...names].join('|');
  return new RegExp(`projectPath:\\s*(${name})\\b|openProject\\(\\s*(${name})\\b|scanProject\\(\\s*(${name})\\b`).test(source);
}

const listed = (spec: string, globs: readonly string[]) => globs.some((g) => minimatch(spec, g));

test('the detector reads a spec as using the sample app only when it does', () => {
  assert.equal(usesSampleApp(`await gotoWithProject(page, { projectPath: FIXTURE_PATH });`), true);
  assert.equal(usesSampleApp(`const PROJECT = path.resolve(process.cwd(), 'tests/fixtures/sample-app');\nawait gotoWithProject(page, { projectPath: PROJECT });`), true);
  assert.equal(usesSampleApp(`await seedPlan(request, { title: T, projectPath: FIXTURE_PATH });`), true);
  assert.equal(usesSampleApp(`await gotoWithProject(page);`), false);
  assert.equal(usesSampleApp(`const FILE = 'tests/fixtures/sample-app/money.go'; // read only`), false);
});

test('every spec that works in the sample app runs with the backend to itself', () => {
  const unlisted = specs(e2e)
    .filter((s) => !s.startsWith('e2e/marketing/'))
    .filter((s) => usesSampleApp(fs.readFileSync(path.join(root, s), 'utf8')))
    .filter((s) => !listed(s, SERIAL_SPECS));
  assert.deepEqual(unlisted, [], `Add these to FIXTURE_SPECS in playwright.config.ts:\n${unlisted.map((s) => `  '**/${s.slice('e2e/'.length)}',`).join('\n')}`);
});

test('every listed fixture spec is serial, and every listed path exists', () => {
  for (const g of FIXTURE_SPECS) assert.ok(SERIAL_SPECS.includes(g), `${g} is in FIXTURE_SPECS but not SERIAL_SPECS`);
  const all = specs(e2e);
  for (const g of SERIAL_SPECS) assert.ok(all.some((s) => minimatch(s, g)), `${g} matches no spec`);
});
