/**
 * Recurring playbooks in the window (Phase 32 C4.2a, journey C4).
 *
 * Sam's team runs "Daily security check" every day at 00:00. His laptop was
 * closed at midnight, so the Awareness inbox asks: "E2E C4 Daily security
 * check is due since 00:00. Start it?" He chooses "Not this time" and the
 * question goes. In the plans list the series is one row: two days missed,
 * today's run due, and the next. He changes his mind and starts it from the
 * row: the run opens, and the row marks it ◐ in progress.
 *
 * The series is given on the real page (the backend's side, with real rules,
 * runs and dismissals, is tests/e2e/recurring.test.ts); the run is a real plan.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const PREFIX = 'E2E C4';
const TITLE = `${PREFIX} Daily security check`;

function seriesOf(state: { dismissed: boolean; runUid: string | null }) {
  const run = (period: string, label: string, s: string, planUid: string | null, words: string) => ({ period, label, dueAt: 0, state: s, planUid, words });
  return {
    series: [{
      rule: { id: 'daily-security-check', playbook: 'security-review', title: TITLE, every: 'day', on: 1, at: '00:00', timeZone: 'UTC', carryOver: true, skills: [{ name: 'security-review', source: 'skill', required: false }], since: '2026-09-28T00:00:00.000Z', by: 'Sam Lee' },
      words: 'every day 00:00 · skill: security-review',
      runs: [
        run('2026-09-29', '29 Sep', 'missed', null, '29 Sep ✗ missed'),
        run('2026-09-30', '30 Sep', 'missed', null, '30 Sep ✗ missed'),
        state.runUid
          ? run('2026-10-01', '1 Oct', 'in_progress', state.runUid, '1 Oct ◐ in progress')
          : run('2026-10-01', '1 Oct', 'due', null, '1 Oct due since 00:00'),
        run('2026-10-02', '2 Oct', 'next', null, '2 Oct next, Fri 2 Oct 00:00'),
      ],
      due: state.runUid ? null : { period: '2026-10-01', label: '1 Oct', since: 0, words: `${TITLE} is due since 00:00`, dismissed: state.dismissed },
    }],
  };
}

async function serve(page: Page, runUid: string) {
  const state = { dismissed: false, runUid: null as string | null, calls: [] as string[] };
  await page.route((url) => url.pathname.startsWith('/api/recurring'), async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (req.method() === 'GET' && pathname === '/api/recurring') return route.fulfill({ json: seriesOf(state) });
    if (req.method() === 'POST' && pathname.endsWith('/dismiss')) {
      state.calls.push('dismiss');
      state.dismissed = true;
      return route.fulfill({ json: { period: '2026-10-01', label: '1 Oct' } });
    }
    if (req.method() === 'POST' && pathname.endsWith('/start')) {
      state.calls.push('start');
      state.runUid = runUid;
      return route.fulfill({ json: { planUid: runUid, title: `${TITLE} — 1 Oct`, created: true } });
    }
    return route.fallback();
  });
  return state;
}

test.describe('Recurring playbooks in the window', () => {
  test.setTimeout(90_000);
  test.use({ viewport: { width: 1440, height: 900 } });
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PREFIX); });

  test('a run due while the laptop was closed is asked about; the series is one row; started from it, it opens', async ({ page, request }) => {
    const run = await seedPlan(request, { title: `${TITLE} — 1 Oct`, actions: [{ title: 'Review new dependencies' }, { title: 'Check secrets in the diff' }] });
    const state = await serve(page, run.uid);
    await gotoWithProject(page);
    fs.mkdirSync(OUT, { recursive: true });

    // The inbox asks.
    await page.getByRole('button', { name: /^Awareness( \d+)?$/ }).first().click();
    const ask = page.getByTestId('recurring-due-run');
    await expect(ask).toBeVisible({ timeout: 10_000 });
    await expect(ask.getByTestId('recurring-due-words')).toHaveText(`${TITLE} is due since 00:00. Start it?`);
    await expect(ask).toContainText('every day 00:00 · skill: security-review · from the security-review playbook');
    await expect(ask.getByTestId('recurring-due-start')).toHaveText(`Start ${TITLE} — 1 Oct`);
    await ask.screenshot({ path: path.join(OUT, 'recurring-due.png') });

    // Not this time: the question goes.
    await ask.getByTestId('recurring-due-dismiss').click();
    await expect(ask).toHaveCount(0);
    expect(state.calls).toEqual(['dismiss']);

    // The plans list: one row for the series.
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    const row = page.locator('[data-testid="recurring-series"][data-rule-id="daily-security-check"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByTestId('recurring-series-words')).toHaveText('every day 00:00 · skill: security-review');
    await expect(row.getByTestId('recurring-run')).toHaveText(['29 Sep ✗ missed', '30 Sep ✗ missed', '1 Oct due · Start', '2 Oct next']);
    await row.screenshot({ path: path.join(OUT, 'recurring-series.png') });

    // Started from the row after all: the run opens, and the row marks it in progress.
    await row.locator('[data-testid="recurring-run"][data-state="due"]').click();
    expect(state.calls).toEqual(['dismiss', 'start']);
    await expect(row.getByTestId('recurring-run')).toHaveText(['29 Sep ✗ missed', '30 Sep ✗ missed', '1 Oct ◐', '2 Oct next']);
    await expect(page.getByText(`${TITLE} — 1 Oct`).first()).toBeVisible();
    // The run is open in the plan workspace.
    await page.screenshot({ path: path.join(OUT, 'recurring-run-opened.png') });
  });
});
