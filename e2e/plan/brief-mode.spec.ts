/**
 * Phase 31.5 — the Brief, as a person sees it.
 *
 * A plan read as a piece of work: its tasks, the task's goal, the guide,
 * the materials, what good looks like, and what Claude is doing — in the
 * Brief's words, with the graph not mounted. An agent can put the brief
 * and a cited file on screen, and ui_ready says which file is showing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, authHeaders, API, PROJECT_PATH } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

test.describe('Brief mode', () => {
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Brief mode ${RUN}`;
  const dir = path.join(PROJECT_PATH, '.codetrellis', 'e2e-brief-mode', RUN);

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a plan read as tasks, materials and what good looks like — and an agent can show a cited file', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Q3 regional summary', body: 'Summarise Q3 revenue by region for the board.' }] });
    const task = plan.actionUids[0];
    const page1 = await request.post(`${API}/plans/${plan.uid}/items`, {
      headers: authHeaders(),
      data: { kind: 'object', title: 'Reporting guide', template: 'page', body: 'Short sentences. Cite every figure.' },
    });
    expect(page1.ok()).toBeTruthy();

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'q3-sales.csv'), 'region,q3\nEMEA,120\nAPAC,80\n');
    const agent = await createMcpClient();
    let material: { attachment_uid: string };
    try {
      material = JSON.parse((await agent.callTool('record_artefact', {
        item_uid: task, path: path.relative(PROJECT_PATH, path.join(dir, 'q3-sales.csv')), role: 'material',
      })).content[0].text);
      await request.post(`${API}/items/${task}/criteria`, { headers: authHeaders(), data: { text: 'Covers all four regions', kind: 'manual' } });

      await gotoWithProject(page);
      await page.getByRole('button', { name: 'Brief', exact: true }).click();
      await page.getByTestId('brief-pick').getByRole('button', { name: TITLE }).click();

      const brief = page.getByTestId('brief-workspace');
      await expect(brief).toBeVisible();
      // The graph is not mounted behind it, as in code mode.
      await expect(page.locator('.react-flow')).toHaveCount(0);
      await expect(brief.getByTestId('brief-tasks')).toContainText('Q3 regional summary');
      await expect(brief.getByTestId('brief-task')).toContainText('Summarise Q3 revenue by region for the board.');
      await brief.getByTestId('brief-guide').getByRole('button', { name: /Reporting guide/ }).click();
      await expect(brief.getByTestId('brief-guide')).toContainText('Cite every figure.');
      await expect(brief.getByTestId('brief-materials')).toContainText('q3-sales.csv');
      // What good looks like, in the Brief's words, glyph and word together.
      const criteria = brief.getByTestId('criteria-block');
      await expect(criteria).toContainText('What good looks like');
      await expect(criteria.getByTestId('criterion-row')).toContainText('○');
      await expect(criteria.getByTestId('criterion-row')).toContainText('not yet');

      // The agent reads the material; the Brief says so in words, naming the file.
      await agent.callTool('read_material', { attachment_uid: material.attachment_uid, locator: { lines: '2-3' } });
      await expect(brief.getByTestId('brief-activity')).toContainText(/Read q3-sales\.csv — lines 2–3/);

      // Opening a material from the task shows it.
      await brief.getByTestId('brief-materials').getByRole('button', { name: /q3-sales\.csv/ }).click();
      await expect(page.getByTestId('artefact-viewer')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('artefact-viewer')).toHaveCount(0);

      // An agent that says "look at the figure I cited" can put it on screen,
      // and ui_ready says which file and place are showing.
      const nav = await agent.callTool('navigate_to', { target: 'artefact', attachment_uid: material.attachment_uid, locator: { lines: '2' } });
      expect(nav.isError, nav.content?.[0]?.text).toBeFalsy();
      await expect(page.getByTestId('artefact-viewer')).toHaveAttribute('data-artefact', material.attachment_uid);
      const ready = JSON.parse((await agent.callTool('ui_ready', {})).content[0].text);
      expect(ready.workspaceMode).toBe('brief');
      expect(ready.openArtefact).toEqual({ uid: material.attachment_uid, name: expect.stringContaining('q3-sales.csv'), locator: { lines: '2' } });
    } finally {
      agent.close();
    }
  });
});
