/**
 * Settings → Recurring playbooks, and a run's own line (Phase 32 C4.2b).
 *
 * Sam opens Settings → Recurring playbooks and makes the Bug fix playbook
 * recur as "Weekly triage", every Monday at 09:00 in Europe/London, carrying
 * open tasks over, with the triage skill. It is listed for the team as
 * "every Mon 09:00 · skill: triage · Europe/London · from the bug-fix
 * playbook · carries open tasks over". He opens this week's run: its page
 * says "Weekly triage · W40 run · started by the schedule · 1 task carried
 * from W39" and names the carried task, which opens. He stops the rule.
 *
 * The rule calls are answered on the page (the backend's side, real rules in
 * the committed config, is tests/e2e/recurring.test.ts), so nothing is
 * written into the committed sample app; the run and its task are real.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const PREFIX = 'E2E C4.2b';

test.describe('Settings → Recurring playbooks', () => {
  test.setTimeout(90_000);
  test.use({ viewport: { width: 1440, height: 900 } });
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PREFIX); });

  test('a playbook made to recur is listed for the team, and stopped', async ({ page }) => {
    const rules: Array<Record<string, unknown>> = [];
    const puts: Array<{ id: string; body: Record<string, unknown> }> = [];
    await page.route((url) => url.pathname.startsWith('/api/recurring'), async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === 'GET' && pathname === '/api/recurring') {
        return route.fulfill({ json: { series: rules.map((rule) => ({ rule, words: 'every Mon 09:00 · skill: triage', runs: [], due: null })) } });
      }
      const id = decodeURIComponent(pathname.split('/')[3] ?? '');
      if (req.method() === 'PUT') {
        const body = req.postDataJSON() as Record<string, unknown>;
        puts.push({ id, body });
        rules.push({ ...body, id, since: new Date().toISOString(), by: 'Sam Lee' });
        return route.fulfill({ json: { rule: rules.at(-1) } });
      }
      if (req.method() === 'DELETE') {
        rules.splice(rules.findIndex((r) => r.id === id), 1);
        return route.fulfill({ json: { removed: id } });
      }
      return route.fallback();
    });

    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Recurring playbooks', exact: true }).click();
    const section = dialog.getByTestId('recurring-section');
    await expect(section).toContainText('However many laptops start a period');
    await expect(section.getByTestId('recurring-rule')).toHaveCount(0);

    await section.getByTestId('recurring-playbook').selectOption('bug-fix');
    await section.getByTestId('recurring-title').fill('Weekly triage');
    await section.getByTestId('recurring-every').selectOption('week');
    await section.getByTestId('recurring-on').selectOption('1');
    await section.getByTestId('recurring-at').fill('09:00');
    await section.getByTestId('recurring-zone').fill('Europe/London');
    await section.getByTestId('recurring-skills').fill('triage');
    fs.mkdirSync(OUT, { recursive: true });
    await section.screenshot({ path: path.join(OUT, 'recurring-settings-form.png') });
    await section.getByTestId('recurring-save').click();

    await expect(section.getByTestId('recurring-rule')).toHaveCount(1);
    expect(puts).toEqual([{
      id: 'weekly-triage',
      body: { playbook: 'bug-fix', title: 'Weekly triage', every: 'week', on: 1, at: '09:00', timeZone: 'Europe/London', carryOver: true, skills: [{ name: 'triage', source: 'skill', required: false }] },
    }]);
    await expect(section.getByTestId('recurring-rule-words')).toHaveText('every Mon 09:00 · skill: triage · Europe/London · from the bug-fix playbook · carries open tasks over · set by Sam Lee');
    await expect(section.getByTestId('recurring-title')).toHaveValue('');
    await section.getByTestId('recurring-rules').screenshot({ path: path.join(OUT, 'recurring-settings-rule.png') });

    await section.getByTestId('recurring-rule-stop').click();
    await expect(section.getByTestId('recurring-rule')).toHaveCount(0);
  });

  test('a run\'s page says which series and week it is, who started it, and the task it carried', async ({ page, request }) => {
    const run = await seedPlan(request, { title: `${PREFIX} Weekly triage — W40`, actions: [{ title: 'Triage new bugs' }, { title: 'Rotate the staging keys' }] });
    const carried = run.actionUids[1];
    await page.route((url) => url.pathname === `/api/plans/${run.uid}/recurrence`, (route) => route.fulfill({
      json: {
        recurrence: {
          rule: 'weekly-triage', title: 'Weekly triage', period: '2026-W40', label: 'W40',
          line: 'Weekly triage · W40 run · started by the schedule · 1 task carried from W39',
          words: 'every Mon 09:00 · skill: triage',
          carriedTasks: [{ itemUid: carried, title: 'Rotate the staging keys', from: 'W39' }],
        },
      },
    }));

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.getByText(`${PREFIX} Weekly triage — W40`).first().click();
    const line = page.getByTestId('recurring-run-line');
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect(line.getByTestId('recurring-run-line-words')).toHaveText('Weekly triage · W40 run · started by the schedule · 1 task carried from W39');
    await expect(line).toContainText('every Mon 09:00 · skill: triage');
    await expect(line.getByTestId('recurring-carried-task')).toHaveText('Rotate the staging keys — carried from W39');
    fs.mkdirSync(OUT, { recursive: true });
    await line.screenshot({ path: path.join(OUT, 'recurring-run-line.png') });

    // The carried task opens.
    await line.getByRole('button', { name: 'Rotate the staging keys' }).click();
    await expect(page.getByTestId('recurring-run-line')).toHaveCount(0);
  });
});
