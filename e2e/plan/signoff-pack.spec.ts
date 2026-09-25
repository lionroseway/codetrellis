/**
 * Phase 31 §13 — the sign-off pack, from the Brief.
 *
 * Save the pack as a page, then verify that saved file: every file it
 * vouches for still matches; edit one and verify again, and the pack says
 * which changed. The file is what a person would keep or send on — so it
 * is the file, not the app's state, that is checked.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, authHeaders, API, PROJECT_PATH } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

test.describe('Sign-off pack', () => {
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Signoff pack ${RUN}`;
  const dir = path.join(PROJECT_PATH, '.codetrellis', 'e2e-signoff-pack', RUN);

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a saved pack verifies, and says which file changed after it was signed', async ({ page, request }, testInfo) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Q3 regional summary', body: 'Summarise Q3.' }] });
    const task = plan.actionUids[0];
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'summary.csv');
    fs.writeFileSync(file, 'region,q3\nEMEA,120\n');

    const agent = await createMcpClient();
    try {
      const output = JSON.parse((await agent.callTool('record_artefact', {
        item_uid: task, path: path.relative(PROJECT_PATH, file), role: 'output',
      })).content[0].text) as { attachment_uid: string };
      const c = await (await request.post(`${API}/items/${task}/criteria`, {
        headers: authHeaders(), data: { text: 'EMEA figure matches the ledger', kind: 'manual' },
      })).json();
      const submitted = await agent.callTool('submit_criterion', {
        criterion_uid: c.uid, evidence: [{ attachment_uid: output.attachment_uid, locator: { lines: '2' } }], note: 'EMEA on line 2',
      });
      expect(submitted.isError, submitted.content?.[0]?.text).toBeFalsy();
      const decided = await request.post(`${API}/criteria/${c.uid}/decide`, { headers: authHeaders(), data: { decision: 'approved' } });
      expect(decided.ok()).toBeTruthy();
    } finally {
      await agent.close();
    }

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Brief', exact: true }).click();
    await page.getByTestId('brief-pick').getByRole('button', { name: TITLE }).click();
    const pack = page.getByTestId('signoff-pack');
    await expect(pack).toBeVisible();

    // Save it as the page — the file a person keeps.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      pack.getByRole('button', { name: 'Save as page' }).click(),
    ]);
    const saved = testInfo.outputPath('pack.html');
    await download.saveAs(saved);
    const html = fs.readFileSync(saved, 'utf-8');
    expect(html).toContain('EMEA figure matches the ledger');
    expect(html).toContain('summary.csv');

    // Verify that file: everything it vouches for still matches.
    await pack.getByTestId('signoff-pack-verify-input').setInputFiles(saved);
    await expect(pack.getByTestId('signoff-pack-verification')).toContainText('1 of 1 file still match');

    // Someone edits the file after it was signed; the same pack now says so.
    fs.writeFileSync(file, 'region,q3\nEMEA,126\n');
    await pack.getByTestId('signoff-pack-verify-input').setInputFiles(saved);
    const result = pack.getByTestId('signoff-pack-verification');
    await expect(result).toContainText('0 of 1 file still match, 1 changed');
    await expect(result).toContainText('changed since');
  });
});
