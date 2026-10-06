/**
 * The Checks view (Phase 33 G9), beside the rules: Sam runs the payments
 * suite from the app; it finds what the CLI printed, each finding with what
 * to do and a way to the file. CI's run, pulled with task state, is beside
 * his own, marked where it ran; comparing the two says what his change fixed
 * and what is new.
 *
 * The runs are served (the check itself, from the app and the CLI against
 * the same files, is tests/e2e/package-rules.test.ts; runs travelling from
 * CI, shared-check-runs.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const WRAPPER = 'packages/web/src/payments.ts';
const finding = (p: string) => ({ rule: 'stripe-via-wrapper', suite: 'payments', path: p, imports: 'npm:stripe', strength: 'block', failing: true, words: `only ${WRAPPER} may import npm:stripe`, fix: `use ${WRAPPER} instead` });

test.describe('The Checks view', () => {
  test.setTimeout(90_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a check run from the app, CI\'s beside it, each finding with its fix and its file, and the two compared', async ({ page }) => {
    const ci = {
      id: 'b7e41c0912345678-3', mine: false, who: 'ci for Build bot', verified: false, ranIn: 'GitHub Actions', commit: 'b7e41c09d2f5a8836c1e0f4a9b2d7c5e8a1f3d60',
      base: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', scope: null, outcome: { ok: false, files: 4, blocks: 2, warns: 0 }, at: Date.now() - 2 * 3600_000,
      says: [], findings: [finding('packages/web/src/api.ts'), finding('packages/web/src/cart.ts')],
      words: 'ci for Build bot in GitHub Actions at b7e41c0, against a1b2c3d4: ✗ 2 block (unverified: it is not signed)',
    };
    const runs: unknown[] = [ci];
    const posts: unknown[] = [];
    await page.route((url) => url.pathname === '/api/check-runs', async (route) => {
      if (route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        runs.unshift({
          id: 'local-1', mine: true, who: 'you', verified: true, ranIn: 'the app', commit: 'c0ffee0912345678c0ffee0912345678c0ffee09', base: ci.base, scope: 'suite payments',
          outcome: { ok: false, files: 3, blocks: 1, warns: 0 }, at: Date.now(), says: [], findings: [finding('packages/web/src/api.ts'), finding('services/api/app/routes/users.py')].map((f, i) => (i === 1 ? { ...f, imports: 'pypi:stripe' } : f)),
          words: 'you in the app at c0ffee0, against a1b2c3d4, suite payments: ✗ 1 blocks',
        });
        return route.fulfill({ json: { ok: false, run: 'local-1', base: 'origin/main' } });
      }
      return route.fulfill({ json: { runs } });
    });
    await page.route((url) => url.pathname === '/api/rules', (route) => route.fulfill({ json: { rules: [], suites: [{ suite: 'payments', where: '', rules: 1, breaches: 0, debt: 0, status: 'holds', words: '' }] } }));

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    await page.getByTestId('rules-tab-checks').click();
    const view = page.getByTestId('checks-view');
    await expect(view.getByTestId('check-run-row')).toHaveCount(1);
    await expect(view.getByTestId('check-run-where')).toHaveText(['ci for Build bot in GitHub Actions · unverified']);

    // Run the payments suite from the app.
    await view.getByTestId('check-scope').selectOption('payments');
    await view.getByTestId('check-run').click();
    await expect.poll(() => posts).toEqual([{ suite: 'payments' }]);
    await expect(view.getByTestId('check-run-row')).toHaveCount(2);
    const detail = view.getByTestId('check-run-detail');
    await expect(detail.getByTestId('check-run-words')).toHaveText('you in the app at c0ffee0, against a1b2c3d4, suite payments: ✗ 1 blocks');
    const findings = detail.getByTestId('check-finding');
    await expect(findings).toHaveCount(2);
    await expect(findings.first().getByTestId('check-finding-where')).toHaveText('⊘ packages/web/src/api.ts imports npm:stripe');
    await expect(findings.first().getByTestId('check-finding-fix')).toHaveText(`→ use ${WRAPPER} instead`);

    // The filters: CI's runs only.
    await view.getByTestId('check-filter-ci').click();
    await expect(view.getByTestId('check-run-where')).toHaveText(['ci for Build bot in GitHub Actions · unverified']);
    await view.getByTestId('check-filter-all').click();

    // Against CI's run: what the change fixed, and what is new.
    await detail.getByTestId('check-compare-with').selectOption(ci.id);
    await expect(detail.getByTestId('check-comparison-words')).toHaveText('1 new · 1 fixed · 1 unchanged');
    await expect(detail.getByTestId('check-new')).toContainText('services/api/app/routes/users.py → pypi:stripe');
    await expect(detail.getByTestId('check-fixed')).toContainText('packages/web/src/cart.ts → npm:stripe');
    await expect(detail.getByTestId('check-unchanged')).toContainText('packages/web/src/api.ts → npm:stripe');
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'checks-view.png') });

    // A finding's way to its file: the code view, at that file.
    await findings.first().getByTestId('check-finding-code').click();
    await expect(page.getByTestId('rules-view')).toHaveCount(0);
  });
});
