/**
 * Proof of skill use, as a person sees it (Phase 32 C1.3), and the skills
 * line in a task copied as a prompt.
 *
 * Whether a skill was used comes from the Claude Code watcher, which the
 * browser suite cannot drive (tests/e2e/skill-use.test.ts does, end to end),
 * so the skills in effect are served here with their proof and each state
 * is checked and photographed. The copied prompt is the real one: the task
 * is seeded with a recommended repo skill, an inherited required one, and a
 * link, and the clipboard is read back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { gotoWithProject, openPlan, cleanupPlans, API, authHeaders, PROJECT_PATH } from '../helpers/setup';
import type { PlanItem } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E Skill Use Plan';

async function seed(request: APIRequestContext) {
  const plan = (await (await request.post(`${API}/plans`, { headers: authHeaders(), data: { title: PLAN, projectPath: PROJECT_PATH } })).json()) as { uid: string };
  const parent = (await (await request.post(`${API}/plans/${plan.uid}/items`, { headers: authHeaders(), data: { kind: 'action', title: 'Payments', template: 'action', status: 'pending' } })).json()) as PlanItem;
  await request.put(`${API}/items/${parent.uid}`, { headers: authHeaders(), data: { skills: [{ name: 'typescript', source: 'lang', required: true }] } });
  const task = (await (await request.post(`${API}/plans/${plan.uid}/items`, { headers: authHeaders(), data: { kind: 'action', title: 'Currency support', template: 'action', status: 'pending', parentUid: parent.uid } })).json()) as PlanItem;
  const put = await request.put(`${API}/items/${task.uid}`, {
    headers: authHeaders(),
    data: {
      skills: [
        { name: 'codetrellis-pr-review', source: 'skill', required: false, use: 'recommended', why: 'this task ends in a PR', where: { kind: 'repo', path: '.claude/skills/codetrellis-pr-review' } },
        { name: 'house-style', source: 'skill', required: false, use: 'recommended', where: { kind: 'link', url: 'https://wiki.example.com/style' } },
      ],
    },
  });
  expect(put.ok()).toBe(true);
  return { parent, task };
}

async function openTask(page: import('@playwright/test').Page) {
  await gotoWithProject(page);
  await openPlan(page, PLAN);
  await page.getByText('Currency support').first().click();
}

test.describe('Skill use', () => {
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('each skill says whether it was used: ✓ used, ○ not used, or unknown — never a guess', async ({ page, request }) => {
    const { parent, task } = await seed(request);
    // The skills in effect with their proof, as the watcher would have left them.
    await page.route(`**/api/items/${task.uid}/skills`, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ skills: [
        { skill: { name: 'typescript', source: 'lang', required: true }, fromUid: parent.uid, fromTitle: 'Payments', proof: 'not_used' },
        { skill: { name: 'codetrellis-pr-review', source: 'skill', required: false, use: 'recommended', why: 'this task ends in a PR', where: { kind: 'repo', path: '.claude/skills/codetrellis-pr-review/SKILL.md' } }, fromUid: task.uid, fromTitle: 'Currency support', proof: 'used', proofSource: 'mcp' },
        { skill: { name: 'house-style', source: 'skill', required: false, use: 'recommended', where: { kind: 'link', url: 'https://wiki.example.com/style' } }, fromUid: task.uid, fromTitle: 'Currency support', proof: 'unknown' },
      ] }),
    }));
    await openTask(page);
    const editor = page.getByTestId('skills-editor');
    await expect(async () => {
      if (!(await editor.isVisible())) await page.getByRole('button', { name: /Routing & Execution/i }).click();
      await expect(editor).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    const proof = (name: string) => editor.locator(`[data-testid="skill-row"][data-skill="${name}"] [data-testid="skill-proof"]`);
    await expect(proof('codetrellis-pr-review')).toHaveText('✓ used');
    await expect(proof('typescript')).toHaveText('○ required, not used');
    await expect(proof('house-style')).toHaveText('use unknown');
    await expect(proof('house-style')).toHaveAttribute('title', /Nothing seen: this agent has not read the skill through CodeTrellis/);
    // A8.4: how the use was seen, here a read through get_skill by a client with no session log.
    await expect(proof('codetrellis-pr-review')).toHaveAttribute('title', 'The agent working this task read this skill through CodeTrellis (get_skill)');

    fs.mkdirSync(OUT, { recursive: true });
    await editor.screenshot({ path: path.join(OUT, 'skill-use.png') });
  });

  test('a task copied as a prompt carries the skills line an agent gets, inherited ones included, never the link', async ({ page, request, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seed(request);
    await openTask(page);
    await page.getByRole('button', { name: /Hand off/ }).click();
    await page.getByText('Copy this task').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('# Task: Currency support');
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain(
      'Skills for this task: required: **typescript**; use **codetrellis-pr-review** (`.claude/skills/codetrellis-pr-review/SKILL.md`), because this task ends in a PR; use **house-style**.',
    );
    expect(prompt).not.toContain('wiki.example.com');
  });
});
