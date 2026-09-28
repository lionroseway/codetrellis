/**
 * The skills picker (Phase 32 C1.2): a person tells the agent which skills
 * to use for a task, and why, from the project's own skills.
 *
 * The browser suite opens this repository, whose `.claude/skills` holds
 * real skills, so the list searched here is the real index. The task sits
 * under a parent that requires a skill, which shows as inherited.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { gotoWithProject, openPlan, cleanupPlans, API, authHeaders, PROJECT_PATH } from '../helpers/setup';
import type { PlanItem } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E Skills Picker Plan';

async function item(request: APIRequestContext, uid: string): Promise<PlanItem> {
  return (await (await request.get(`${API}/items/${uid}`, { headers: authHeaders() })).json()) as PlanItem;
}

test.describe('Skills picker', () => {
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('a skill picked from the project, with why and where; inherited ones marked; a link is for people; a bad one says why', async ({ page, request }) => {
    const plan = (await (await request.post(`${API}/plans`, { headers: authHeaders(), data: { title: PLAN, projectPath: PROJECT_PATH } })).json()) as { uid: string };
    const parent = (await (await request.post(`${API}/plans/${plan.uid}/items`, { headers: authHeaders(), data: { kind: 'action', title: 'Payments', template: 'action', status: 'pending' } })).json()) as PlanItem;
    const put = await request.put(`${API}/items/${parent.uid}`, { headers: authHeaders(), data: { skills: [{ name: 'typescript', source: 'lang', required: true }] } });
    expect(put.ok(), await put.text()).toBe(true);
    expect((await item(request, parent.uid)).skills).toEqual([{ name: 'typescript', source: 'lang', required: true }]);
    const task = (await (await request.post(`${API}/plans/${plan.uid}/items`, { headers: authHeaders(), data: { kind: 'action', title: 'Currency support', template: 'action', status: 'pending', parentUid: parent.uid } })).json()) as PlanItem;

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    await page.getByText('Currency support').first().click();
    const editor = page.getByTestId('skills-editor');
    // The item view settles after the plan's items load, which can re-render
    // the panel closed: open it until it stays open.
    await expect(async () => {
      if (!(await editor.isVisible())) await page.getByRole('button', { name: /Routing & Execution/i }).click();
      await expect(editor).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    const row = (name: string) => editor.locator(`[data-testid="skill-row"][data-skill="${name}"]`);
    // Inherited from the parent: shown, said to be, not editable here.
    await expect(row('typescript')).toContainText('Required (gates the claim)');
    await expect(row('typescript').getByTestId('skill-inherited')).toHaveText('inherited from Payments');
    await expect(row('typescript').getByTestId('skill-remove')).toHaveCount(0);

    // Search the project's skills by what they do.
    await editor.getByTestId('skill-add-input').fill('pull request');
    const option = editor.getByTestId('skill-option').filter({ hasText: 'codetrellis-pr-review' });
    await expect(option).toContainText('Review a pull request');
    await option.click();
    await expect(row('codetrellis-pr-review').getByTestId('skill-use')).toHaveValue('recommended');
    await expect(row('codetrellis-pr-review')).toContainText('.claude/skills/codetrellis-pr-review');

    // Why, in one line.
    await row('codetrellis-pr-review').getByTestId('skill-edit').click();
    await row('codetrellis-pr-review').getByTestId('skill-why').fill('this task ends in a PR');
    await row('codetrellis-pr-review').getByTestId('skill-save').click();
    await expect(row('codetrellis-pr-review').getByTestId('skill-why-text')).toHaveText('why: this task ends in a PR');

    // A skill typed by name, pointed at a link: marked people only.
    await editor.getByTestId('skill-add-input').fill('house-style');
    await editor.getByTestId('skill-add-input').press('Enter');
    await row('house-style').getByTestId('skill-edit').click();
    await row('house-style').getByTestId('skill-where-kind').selectOption('link');
    await expect(row('house-style')).toContainText('agents are never shown it');
    await row('house-style').getByTestId('skill-where-value').fill('https://wiki.example.com/style');
    await row('house-style').getByTestId('skill-save').click();
    await expect(row('house-style').getByTestId('skill-people-only')).toBeVisible();

    // Own skills add to inherited ones: typescript is still in effect.
    await expect(row('typescript').getByTestId('skill-inherited')).toHaveText('inherited from Payments');

    const stored = await item(request, task.uid);
    expect(stored.skills).toEqual([
      { name: 'codetrellis-pr-review', source: 'skill', required: false, use: 'recommended', why: 'this task ends in a PR', where: { kind: 'repo', path: '.claude/skills/codetrellis-pr-review/SKILL.md' } },
      { name: 'house-style', source: 'skill', required: false, use: 'recommended', where: { kind: 'link', url: 'https://wiki.example.com/style' } },
    ]);

    fs.mkdirSync(OUT, { recursive: true });
    await editor.screenshot({ path: path.join(OUT, 'skills-picker.png') });

    // A link that is not http(s) is refused, and the reason shows; nothing changes.
    await row('house-style').getByTestId('skill-edit').click();
    await row('house-style').getByTestId('skill-where-value').fill('javascript:alert(1)');
    await row('house-style').getByTestId('skill-save').click();
    await expect(editor.getByTestId('skill-error')).toContainText('http(s) URL');
    expect((await item(request, task.uid)).skills?.[1].where).toEqual({ kind: 'link', url: 'https://wiki.example.com/style' });

    // Required gates the claim again.
    await row('codetrellis-pr-review').getByTestId('skill-use').selectOption('required');
    await expect.poll(async () => (await item(request, task.uid)).skills?.[0].required).toBe(true);
  });
});
