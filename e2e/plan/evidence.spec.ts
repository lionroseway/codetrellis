/**
 * Phase 32 B10.4 — the evidence export, from the plan and from replay.
 *
 * A person exports a plan's evidence from the Brief: one signed page. They
 * verify the saved file: signed here, its entries recompute, this
 * computer's record still holds them. Someone edits a decision inside the
 * page: verifying says it changed and which entry. From replay, the window
 * being watched exports the same way.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, authHeaders, API } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const shot = (name: string) => {
  fs.mkdirSync(path.join('test-results', 'ux-audit'), { recursive: true });
  return path.join('test-results', 'ux-audit', `${name}.png`);
};

test.describe('Evidence export', () => {
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Evidence ${RUN}`;

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
  });

  test('a plan\'s evidence saves as one signed page, verifies, and an edited decision is named', async ({ page, request }, testInfo) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Refund rounding', body: 'Round refunds to the cent.' }] });
    const task = plan.actionUids[0];
    const agent = await createMcpClient();
    try {
      const c = await (await request.post(`${API}/items/${task}/criteria`, { headers: authHeaders(), data: { text: 'Refunds round half-even', kind: 'manual' } })).json();
      const submitted = await agent.callTool('submit_criterion', { criterion_uid: c.uid, evidence: [], note: 'Checked against the ledger' });
      expect(submitted.isError, submitted.content?.[0]?.text).toBeFalsy();
      expect((await request.post(`${API}/criteria/${c.uid}/decide`, { headers: authHeaders(), data: { decision: 'approved' } })).ok()).toBeTruthy();
    } finally {
      await agent.close();
    }

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Brief', exact: true }).click();
    await page.getByTestId('brief-pick').getByRole('button', { name: TITLE }).click();
    const evidence = page.getByTestId('evidence');
    await expect(evidence).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), evidence.getByTestId('evidence-export').click()]);
    expect(download.suggestedFilename()).toBe(`evidence-E2E-Evidence-${RUN}.html`);
    const saved = testInfo.outputPath('evidence.html');
    await download.saveAs(saved);
    const html = fs.readFileSync(saved, 'utf-8');
    expect(html).toContain('Approved “Refunds round half-even”');
    await expect(evidence.getByTestId('evidence-message')).toContainText('It is signed by this computer');

    await evidence.getByTestId('evidence-verify-input').setInputFiles(saved);
    const result = evidence.getByTestId('evidence-verification');
    await expect(result).toHaveAttribute('data-ok', 'true');
    await expect(result).toContainText('This evidence holds.');
    await expect(evidence.getByTestId('evidence-seal')).toHaveAttribute('data-state', 'this-computer');
    await expect(evidence.getByTestId('evidence-chain')).toContainText(/recompute into one unbroken chain\.$/);
    await expect(evidence.getByTestId('evidence-here')).toHaveAttribute('data-state', 'matches');
    await evidence.screenshot({ path: shot('evidence-verified') });

    // The approval turned into a send-back, inside the page's data.
    const forged = testInfo.outputPath('forged.html');
    const edited = html.replace('\\"decision\\":\\"approved\\"', '\\"decision\\":\\"sent_back\\"');
    expect(edited).not.toBe(html);
    fs.writeFileSync(forged, edited);
    await evidence.getByTestId('evidence-verify-input').setInputFiles(forged);
    await expect(result).toHaveAttribute('data-ok', 'false');
    await expect(evidence.getByTestId('evidence-seal')).toHaveAttribute('data-state', 'changed');
    await expect(evidence.getByTestId('evidence-chain')).toContainText(/#\d+ \(criterion decided/);
    await expect(evidence.getByTestId('evidence-chain')).toContainText('its event does not match its digest');
    await expect(evidence.getByTestId('evidence-here')).toContainText('Its signature does not hold');
    await evidence.screenshot({ path: shot('evidence-forged') });
  });

  test('from replay, the window being watched exports the same way', async ({ page }, testInfo) => {
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();
    await page.getByTestId('replay-start').click();
    const bar = page.getByTestId('replay-bar');
    await expect(bar).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), bar.getByTestId('evidence-export').click()]);
    expect(download.suggestedFilename()).toBe('evidence-replay-window.html');
    const saved = testInfo.outputPath('window.html');
    await download.saveAs(saved);
    expect(fs.readFileSync(saved, 'utf-8')).toContain('<h1>Evidence</h1>');
    await bar.getByTestId('evidence-verify-input').setInputFiles(saved);
    await expect(bar.getByTestId('evidence-verification')).toHaveAttribute('data-ok', 'true');
    await bar.screenshot({ path: shot('evidence-replay') });
  });
});
