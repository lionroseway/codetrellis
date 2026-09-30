/**
 * Phase 32 A6.4 — other work affected, as a person sees it (JOURNEYS M6).
 *
 * Two Claude Desktop sessions work two tasks of one brief, "Q3 report" and
 * "Board pack", from one sales export. The report cites a line of it. The
 * export is replaced. The Board pack's Brief says, in words, that the file
 * changed since the report cited it and that this task uses it too; the Q3
 * report's says the same from its side. Awareness holds the same signal,
 * titled "Changed material", with each task's sentence and no graph
 * buttons, since a spreadsheet is not code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, PROJECT_PATH, API, authHeaders } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const OUT = path.join('test-results', 'ux-audit');

async function shot(target: Page | Locator, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => setTimeout(r, 300));
  await target.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('Other work affected', () => {
  test.setTimeout(150_000);
  test.use({ viewport: { width: 1440, height: 900 } });
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Other work ${RUN}`;
  const dir = path.join(PROJECT_PATH, '.codetrellis', 'e2e-other-work', RUN);
  const rel = path.relative(PROJECT_PATH, path.join(dir, 'sales.csv')).split(path.sep).join('/');

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a shared file changes: each task\'s Brief says so from its side, and Awareness holds it once', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Q3 report' }, { title: 'Board pack' }] });
    const [report, pack] = plan.actionUids;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sales.csv'), 'region,q3\nEMEA,120\nAPAC,80\n');

    const agents = { report: await createMcpClient(), pack: await createMcpClient() };
    try {
      const material: Record<string, string> = {};
      for (const [who, uid] of [['report', report], ['pack', pack]] as const) {
        expect((await agents[who].callTool('get_brief', { item_uid: uid })).isError).toBeFalsy();
        const recorded = JSON.parse((await agents[who].callTool('record_artefact', { item_uid: uid, path: rel, role: 'material' })).content[0].text);
        material[who] = recorded.attachment_uid;
        expect((await agents[who].callTool('read_material', { attachment_uid: material[who] })).isError).toBeFalsy();
      }
      // The report cites the line it uses.
      const c = JSON.parse((await agents.report.callTool('add_criterion', { item_uid: report, text: 'EMEA matches the export', kind: 'citation' })).content[0].text);
      const sub = await agents.report.callTool('submit_criterion', { criterion_uid: c.uid, evidence: [{ attachment_uid: material.report, locator: { lines: 2 } }], note: 'line 2' });
      expect(sub.isError).toBeFalsy();

      await gotoWithProject(page);
      await page.getByRole('button', { name: 'Brief', exact: true }).click();
      await page.getByTestId('brief-pick').getByRole('button', { name: TITLE }).click();
      const brief = page.getByTestId('brief-workspace');
      await brief.getByTestId('brief-tasks').getByRole('button', { name: /Board pack/ }).click();
      // Nothing touches it yet, so nothing shows.
      await expect(brief.getByTestId('brief-materials')).toContainText('sales.csv');
      await expect(brief.getByTestId('brief-other-work')).toHaveCount(0);

      // The export is replaced.
      fs.writeFileSync(path.join(dir, 'sales.csv'), 'region,q3\nEMEA,131\nAPAC,80\n');
      const row = brief.getByTestId('brief-other-work-row');
      await expect(row).toHaveCount(1, { timeout: 20_000 });
      await expect(row).toHaveAttribute('data-severity', 'medium');
      await expect(row).toContainText('Changed material');
      // The person's Brief names the file; its path is on hover.
      await expect(row).toContainText('sales.csv changed since “Q3 report” cited line 2. This task uses it too.');
      await expect(row.locator('p')).toHaveAttribute('title', rel);
      await shot(brief.getByTestId('brief-task'), 'brief-other-work');

      // From the report's side.
      await brief.getByTestId('brief-tasks').getByRole('button', { name: /Q3 report/ }).click();
      await expect(brief.getByTestId('brief-other-work-row')).toContainText('sales.csv changed since this task cited line 2. “Board pack” uses it too.');

      // The agent's brief says the same.
      const agentBrief = JSON.parse((await agents.pack.callTool('get_brief', { item_uid: pack })).content[0].text);
      expect(agentBrief.affected_by_other_work).toEqual([expect.objectContaining({
        kind: 'Changed material', severity: 'medium', says: `${rel} changed since “Q3 report” cited line 2. This task uses it too.`, other_tasks: ['Q3 report'],
      })]);

      // Awareness holds it once, as a material: each task's sentence, no graph buttons.
      await page.getByRole('button', { name: 'Brief', exact: true }).click();
      await page.getByRole('button', { name: /^Awareness/ }).click();
      const card = page.getByTestId('awareness-signal').filter({ hasText: rel });
      await expect(card).toHaveCount(1, { timeout: 20_000 });
      await expect(card).toContainText('Changed material');
      await expect(card.getByTestId('awareness-sides')).toContainText('Board pack');
      await expect(card.getByTestId('awareness-sides')).toContainText('Q3 report');
      await expect(card.getByTestId('awareness-material')).toContainText('Q3 report cites line 2 of');
      await expect(card.getByTestId('awareness-material')).toContainText('Board pack uses');
      await expect(card.getByTestId('signal-show-on-graph')).toHaveCount(0);
      await shot(card, 'awareness-material-card');

      // The sign-off pack says what touched each task and how it ended (A6.5).
      await card.getByRole('button', { name: 'Acknowledge' }).click();
      await expect(card).toHaveAttribute('data-state', 'acknowledged');
      const res = await request.get(`${API}/plans/${plan.uid}/signoff-pack.html`, { headers: authHeaders() });
      expect(res.ok()).toBeTruthy();
      const packPage = await page.context().newPage();
      await packPage.setContent(await res.text());
      const section = packPage.locator('h2', { hasText: 'Other work that touched these tasks' });
      await expect(section).toBeVisible();
      const table = section.locator('xpath=following-sibling::table[1]');
      await expect(table).toContainText('Board pack');
      await expect(table).toContainText('sales.csv changed since “Q3 report” cited line 2. This task uses it too.');
      // The browser reaches the app over plain HTTP, so the answer is recorded
      // as unverified, and the pack says so rather than claiming a person.
      await expect(table).toContainText('Acknowledged by someone through the local API, not verified as the person.');
      await section.scrollIntoViewIfNeeded();
      await shot(table, 'signoff-pack-signals');
      await packPage.close();
    } finally {
      agents.report.close();
      agents.pack.close();
    }
  });
});
