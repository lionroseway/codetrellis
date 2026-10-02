/**
 * Recurring playbooks, on the phone (Phase 32 C4.3a), journey C4.
 *
 * Sam's team runs "Weekly security review" every Monday 09:00. W38 was done,
 * nobody ran W39, and W40 is due. From the phone Sam sees the series as the
 * plans list shows it, starts W40 and is taken to its plan; had Dana already
 * started it, the phone says so and opens hers. A run opens its plan.
 *
 * The desktop's side (`recurring.list`, `recurring.start`) is served here as
 * the RPC answer; tests/e2e/recurring.test.ts checks it against a real
 * backend and a paired phone.
 */
import { test, expect } from '@playwright/test';
import { openScreen, navigations, shot, calls } from './helpers';

const RULE = { id: 'weekly-security-review', title: 'Weekly security review', playbook: 'security-review', every: 'week', carryOver: true, by: 'Sam' };
const run = (period: string, label: string, state: string, planUid: string | null, words: string) => ({ period, label, dueAt: 0, state, planUid, words });
const DUE = {
  rule: RULE,
  words: 'every Mon 09:00 · Europe/London · carries open tasks over · skill: security-review',
  runs: [
    run('2026-W38', 'W38', 'done', 'p-w38', 'W38 ✓ done'),
    run('2026-W39', 'W39', 'missed', null, 'W39 ✗ missed'),
    run('2026-W40', 'W40', 'due', null, 'W40 due since Mon 29 Sep 09:00'),
    run('2026-W41', 'W41', 'next', null, 'W41 next, Mon 6 Oct 09:00'),
  ],
  due: { period: '2026-W40', label: 'W40', since: 0, words: 'Weekly security review is due since Monday 09:00', dismissed: false },
};
const STARTED = {
  ...DUE,
  runs: DUE.runs.map((r) => (r.state === 'due' ? { ...r, state: 'in_progress', planUid: 'p-w40', words: 'W40 ◐ in progress' } : r)),
  due: null,
};
const DAILY = {
  rule: { id: 'daily-deps', title: 'Daily dependency check', playbook: 'deps', every: 'day', carryOver: false, by: 'Dana' },
  words: 'every day 08:30 · Europe/London',
  runs: [run('2026-09-30', '30 Sep', 'done', 'p-d30', '30 Sep ✓ done'), run('2026-10-01', '1 Oct', 'in_progress', 'p-d1', '1 Oct ◐ in progress'), run('2026-10-02', '2 Oct', 'next', null, '2 Oct next, Thu 2 Oct 08:30')],
  due: null,
};

test.describe('Recurring playbooks', () => {
  test('each series in the desktop’s words; the due run starts and opens its plan', async ({ page }) => {
    await openScreen(page, 'recurring', {
      rpc: {
        'recurring.list': { series: [DUE, DAILY] },
        'recurring.start': { planUid: 'p-w40', title: 'Weekly security review — W40', created: true, series: [STARTED, DAILY] },
      },
    });
    const series = page.getByTestId('recurring-series');
    await expect(series).toHaveCount(2);
    const weekly = series.first();
    await expect(weekly.getByTestId('recurring-series-words')).toHaveText(DUE.words);
    await expect(weekly.getByTestId('recurring-run')).toHaveText(['W38 ✓', 'W39 ✗ missed', 'W40 due', 'W41 next']);
    await expect(weekly.getByTestId('recurring-due-words')).toHaveText('Weekly security review is due since Monday 09:00');
    await expect(series.nth(1).getByTestId('recurring-start')).toHaveCount(0);
    await shot(page, 'recurring-due');

    await weekly.getByTestId('recurring-start').click();
    await expect(weekly.getByTestId('recurring-started')).toHaveText('Started Weekly security review — W40');
    await expect(weekly.getByTestId('recurring-run')).toHaveText(['W38 ✓', 'W39 ✗ missed', 'W40 ◐', 'W41 next']);
    await expect(weekly.getByTestId('recurring-due')).toHaveCount(0);
    expect((await calls(page)).filter((c) => c.method === 'recurring.start').map((c) => c.params)).toEqual([{ ruleId: 'weekly-security-review' }]);
    expect(await navigations(page)).toEqual([{ action: 'push', to: '/plan-detail?uid=p-w40' }]);
    await shot(page, 'recurring-started');

    // A run opens its plan; a missed one has none to open.
    await weekly.getByTestId('recurring-run').nth(1).click({ force: true });
    await weekly.getByTestId('recurring-run').first().click();
    expect((await navigations(page)).slice(1)).toEqual([{ action: 'push', to: '/plan-detail?uid=p-w38' }]);
  });

  test('a run a teammate already started is opened, not made again', async ({ page }) => {
    await openScreen(page, 'recurring', {
      rpc: {
        'recurring.list': { series: [DUE] },
        'recurring.start': { planUid: 'p-w40', title: 'Weekly security review — W40', created: false, series: [STARTED] },
      },
    });
    await page.getByTestId('recurring-start').click();
    await expect(page.getByTestId('recurring-started')).toHaveText('Weekly security review — W40 was already started; opening it');
    expect(await navigations(page)).toEqual([{ action: 'push', to: '/plan-detail?uid=p-w40' }]);
  });

  test('nothing recurs yet: where to set one', async ({ page }) => {
    await openScreen(page, 'recurring', { rpc: { 'recurring.list': { series: [] } } });
    await expect(page.getByTestId('recurring-empty')).toContainText('Settings → Recurring playbooks');
    await shot(page, 'recurring-empty');
  });
});
