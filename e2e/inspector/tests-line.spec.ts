/**
 * A file's tests in the inspector (Phase 32 B8.2).
 *
 * Sam opens `agent.ts` from the Explorer. Under its name the
 * inspector says what its tests last said: "✗ 1 of 3 tests failing", from
 * which test files, with the failing test and why; Show tests lists them
 * all. A file changed after its tests ran says "⚠ tests older than the
 * code" instead.
 *
 * The answer is served (the backend's side, the imports and barrels and the
 * staleness against real files, is tests/e2e/test-grounding.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, pickInExplorer } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const FILE = 'src/shared/types/agent.ts';

const failing = {
  path: FILE, state: 'failing', words: '✗ 1 of 3 tests failing', isTest: false,
  testFiles: ['src/shared/lib/item-status.test.ts', 'src/backend/services/plan-status.test.ts'],
  tests: [
    { label: 'item-status › a task set two ways at once names both', result: 'failed', message: 'expected "blocked" to be "in progress"', testFile: 'src/shared/lib/item-status.test.ts' },
    { label: 'item-status › a section sums its tasks', result: 'passed', message: null, testFile: 'src/shared/lib/item-status.test.ts' },
    { label: 'plan-status › one answer for every surface', result: 'passed', message: null, testFile: 'src/backend/services/plan-status.test.ts' },
  ],
};

test.describe('Inspector: a file\'s tests', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('what its tests last said, the failing one with why, and all of them on asking', async ({ page }) => {
    let answer: unknown = failing;
    await page.route('**/api/tests/grounding?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }));
    await gotoWithProject(page);
    await pickInExplorer(page, FILE);
    const line = page.getByTestId('inspector-tests');
    await expect(line).toHaveAttribute('data-state', 'failing');
    await expect(line.getByTestId('inspector-tests-words')).toHaveText('✗ 1 of 3 tests failing');
    await expect(line).toContainText('from src/shared/lib/item-status.test.ts, src/backend/services/plan-status.test.ts');
    await expect(line.getByTestId('inspector-test-failing')).toHaveText('✕ item-status › a task set two ways at once names both — expected "blocked" to be "in progress"');
    fs.mkdirSync(OUT, { recursive: true });
    await line.screenshot({ path: path.join(OUT, 'inspector-tests-failing.png') });
    await line.getByRole('button', { name: 'Show tests' }).click();
    await expect(line.getByTestId('inspector-tests-list').locator('li')).toHaveCount(3);

    // Another file, changed after its tests ran.
    answer = { ...failing, path: 'src/shared/types/plan.ts', state: 'stale', words: '⚠ tests older than the code: it changed after its 2 tests last ran', tests: failing.tests.slice(1).map((t) => ({ ...t })) };
    await pickInExplorer(page, 'src/shared/types/plan.ts');
    await expect(line).toHaveAttribute('data-state', 'stale');
    await expect(line.getByTestId('inspector-tests-words')).toHaveText('⚠ tests older than the code: it changed after its 2 tests last ran');
    await line.screenshot({ path: path.join(OUT, 'inspector-tests-stale.png') });
  });

  test('a file grounded by a teammate\'s run says whose, at which commit, and that it is unverified (D1.5a)', async ({ page }) => {
    const words = '✓ 2 tests passing, in ci for Build bot\'s run at b7e41c0, unverified';
    await page.route('**/api/tests/grounding?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      path: FILE, state: 'passing', words, isTest: false, testFiles: ['src/shared/lib/item-status.test.ts'],
      tests: [{ label: '2 tests passing', result: 'passed', message: null, testFile: 'src/shared/lib/item-status.test.ts', count: 2 }],
      from: { who: 'ci for Build bot', verified: false, commit: 'b7e41c09d2f5a8836c1e0f4a9b2d7c5e8a1f3d60', at: Date.UTC(2026, 9, 1, 13, 40) },
    }) }));
    await gotoWithProject(page);
    await pickInExplorer(page, FILE);
    const line = page.getByTestId('inspector-tests');
    await expect(line).toHaveAttribute('data-state', 'passing');
    await expect(line.getByTestId('inspector-tests-words')).toHaveText(words);
    fs.mkdirSync(OUT, { recursive: true });
    await line.screenshot({ path: path.join(OUT, 'inspector-tests-teammate.png') });
  });
});
