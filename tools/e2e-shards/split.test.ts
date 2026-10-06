/**
 * The browser shards, balanced by weight: every file in exactly one shard,
 * the same split every time, and page tests weighed as what they cost.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFiles, testWeight, weighProject, PAGE_WEIGHT, API_WEIGHT } from './split';

test('a test that takes the page weighs a page load; one that does not, one', () => {
  assert.equal(testWeight("test('opens the plan', async ({ page }) => {"), PAGE_WEIGHT);
  assert.equal(testWeight("test('seeds', async ({ page, request }) => {"), PAGE_WEIGHT);
  assert.equal(testWeight("test('calls the API', async ({ request }) => {"), API_WEIGHT);
  assert.equal(testWeight("test('pure', async () => {"), API_WEIGHT);
});

test('whole files, heaviest first to the lightest shard: each file once, balanced, the same every time', () => {
  const weights = new Map([['plan/a.spec.ts', 150], ['plan/b.spec.ts', 140], ['plan/c.spec.ts', 130], ['api/d.spec.ts', 5], ['api/e.spec.ts', 4], ['graph/f.spec.ts', 120]]);
  const split = splitFiles(weights, 3);
  assert.deepEqual(split.flat().sort(), [...weights.keys()].sort());
  const load = split.map((files) => files.reduce((n, f) => n + weights.get(f)!, 0));
  assert.ok(Math.max(...load) - Math.min(...load) <= 150, `balanced: ${load}`);
  assert.deepEqual(splitFiles(weights, 3), split);
  // Contiguous slices would have put all of plan/ in one shard.
  assert.ok(split.every((files) => files.filter((f) => f.startsWith('plan/')).length <= 1));
});

test('weighed from Playwright\'s own listing, for one project', () => {
  const listing = {
    config: { rootDir: '/w/e2e' },
    suites: [{
      specs: [
        { file: 'plan/a.spec.ts', line: 1, tests: [{ projectName: 'chromium' }] },
        { file: 'plan/a.spec.ts', line: 2, tests: [{ projectName: 'chromium' }] },
        { file: 'serial/b.spec.ts', line: 1, tests: [{ projectName: 'serial' }] },
      ],
    }],
  };
  const sources: Record<string, string> = {
    'plan/a.spec.ts': "test('ui', async ({ page }) => {});\ntest('api', async ({ request }) => {});",
    'serial/b.spec.ts': "test('ui', async ({ page }) => {});",
  };
  assert.deepEqual([...weighProject(listing, 'chromium', (f) => sources[f])], [['plan/a.spec.ts', PAGE_WEIGHT + API_WEIGHT]]);
});
