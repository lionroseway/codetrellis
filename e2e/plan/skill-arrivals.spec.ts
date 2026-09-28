/**
 * A skill that arrived in a pulled plan file, as a person meets it (Phase 32
 * C1.4): the plan's readiness list says it is waiting and who added it, the
 * task's skills say agents are not told it yet, and Accept clears both.
 *
 * Making a real arrival means committing a plan file as someone else, which
 * tests/e2e/skill-arrivals.test.ts does against a throwaway repository. This
 * suite's project is the repository itself, so the arrival is served here
 * and the journey through the screens is what is checked and photographed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, openPlan, cleanupPlans, API, authHeaders, PROJECT_PATH } from '../helpers/setup';
import type { PlanItem } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E Skill Arrivals Plan';

test.describe('Skills arriving in a plan file', () => {
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('the readiness list and the task say it is waiting, from whom; Accept clears both', async ({ page, request }) => {
    const plan = (await (await request.post(`${API}/plans`, { headers: authHeaders(), data: { title: PLAN, description: 'Add GBP.', projectPath: PROJECT_PATH } })).json()) as { uid: string };
    const task = (await (await request.post(`${API}/plans/${plan.uid}/items`, { headers: authHeaders(), data: { kind: 'action', title: 'Currency support', template: 'action', status: 'pending' } })).json()) as PlanItem;
    const skill = { name: 'codetrellis-pr-review', source: 'skill', required: false, use: 'recommended', why: 'our review steps', where: { kind: 'repo', path: '.claude/skills/codetrellis-pr-review/SKILL.md' } };
    await request.put(`${API}/items/${task.uid}`, { headers: authHeaders(), data: { skills: [skill] } });

    // The arrival, as the import would have recorded it, until Accept.
    let waiting = true;
    const arrival = { itemUid: task.uid, itemTitle: 'Currency support', skill: skill.name, addedBy: 'Priya', commit: '3f9c2e1', arrivedAt: Date.now() };
    await page.route(`**/api/plans/${plan.uid}/skill-arrivals`, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ arrivals: waiting ? [arrival] : [] }),
    }));
    await page.route(`**/api/items/${task.uid}/skills`, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ skills: [{ skill, fromUid: task.uid, fromTitle: 'Currency support', proof: null, pending: waiting ? arrival : null }] }),
    }));
    let accepted: unknown = null;
    await page.route(`**/api/items/${task.uid}/skill-arrivals/accept`, async (route) => {
      accepted = route.request().postDataJSON();
      waiting = false;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: skill.name }) });
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN);

    // The readiness list: a step to do before hand-off, saying what and from whom.
    const ring = page.getByRole('button', { name: /to do before hand-off/ });
    await ring.click();
    const step = page.getByText('Skills from plan files accepted');
    await expect(step).toBeVisible();
    await expect(page.getByText(/codetrellis-pr-review on "Currency support" \(added by Priya in 3f9c2e1\)/)).toBeVisible();
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'skill-arrivals-readiness.png') });
    // Closed with its own button: Escape would minimise the whole workspace.
    await ring.click();

    // The task: the skill says it is waiting, and agents are not told it yet.
    await page.getByText('Currency support').first().click();
    const editor = page.getByTestId('skills-editor');
    await expect(async () => {
      if (!(await editor.isVisible())) await page.getByRole('button', { name: /Routing & Execution/i }).click();
      await expect(editor).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    const pending = editor.locator('[data-testid="skill-row"][data-skill="codetrellis-pr-review"] [data-testid="skill-pending"]');
    await expect(pending).toContainText('From the plan file, added by Priya in 3f9c2e1');
    await expect(pending).toContainText('Agents are not told it until you accept it');
    await editor.screenshot({ path: path.join(OUT, 'skill-arrivals-task.png') });

    // Accept: the skill is accepted, and the waiting line goes.
    await pending.getByTestId('skill-accept').click();
    await expect.poll(() => accepted).toEqual({ skill: 'codetrellis-pr-review' });
    await expect(editor.getByTestId('skill-pending')).toHaveCount(0);
  });
});
