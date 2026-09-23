/**
 * Phase 31.3 — the viewer: evidence opened at the place it cites, and sent
 * back from the exact place.
 *
 * An agent records a spreadsheet and cites a cell. The person opens the
 * evidence from the criterion, sees that cell, picks the one that is wrong
 * and sends it back from there. The agent's worklist then points at that
 * cell — no copying, no conversation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API, PROJECT_PATH } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

test.describe('Artefact viewer', () => {
  const RUN = Math.random().toString(36).slice(2, 7);
  const TITLE = `E2E Viewer ${RUN}`;
  const dir = path.join(PROJECT_PATH, '.codetrellis', 'e2e-artefacts', RUN);

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, TITLE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('evidence opens at the cited cell, and goes back from the cell that is wrong', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Q3 totals', body: 'Tie totals to the ledger.' }] });
    const item = plan.actionUids[0];

    // The file exists only after the item does, as a real output would.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'totals.csv'), 'region,total\nEMEA,120\nAPAC,80\nAMER,95\n');
    const rel = path.relative(PROJECT_PATH, path.join(dir, 'totals.csv'));

    const agent = await createMcpClient();
    const recorded = JSON.parse((await agent.callTool('record_artefact', {
      item_uid: item, path: rel, role: 'material', note: 'totals.csv',
    })).content[0].text);
    const criterion = await (await request.post(`${API}/items/${item}/criteria`, {
      data: { text: 'Totals tie to the ledger', kind: 'citation' },
    })).json();
    const submitted = await agent.callTool('submit_criterion', {
      criterion_uid: criterion.uid,
      evidence: [{ attachment_uid: recorded.attachment_uid, locator: { range: 'B2' } }],
      note: 'EMEA total in B2',
    });
    expect(submitted.isError, submitted.content?.[0]?.text).toBeFalsy();
    agent.close();

    await gotoWithProject(page);
    await openPlan(page, TITLE);
    await page.getByTestId('plan-item-tree').getByText('Q3 totals').first().click();

    // Open the evidence where it points.
    await page.getByTestId('evidence-link').first().click();
    const viewer = page.getByTestId('artefact-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-cell="B2"]')).toHaveAttribute('data-cited', 'true');
    await expect(viewer.locator('[data-cell="B2"]')).toHaveText('120');

    // The wrong one is B3. Point at it and send back from there.
    await viewer.locator('[data-cell="B3"]').click();
    const bar = viewer.getByTestId('send-back-bar');
    await expect(bar.getByText('Selected B3')).toBeVisible();
    await bar.getByRole('button', { name: /Send back from here/ }).click();
    await bar.getByPlaceholder(/What isn't right at B3/).fill('APAC excludes the Japan restatement');
    await bar.getByRole('button', { name: 'Send back', exact: true }).click();
    await expect(bar.getByText('↩ Sent back from B3')).toBeVisible();

    // The agent reads the place back, not just the words.
    const worklist = await (await request.get(`${API}/plans/${plan.uid}/worklist`)).json();
    const owed = worklist.entries.find((e: { criterionUid: string }) => e.criterionUid === criterion.uid);
    expect(owed.reason).toBe('sent_back');
    expect(owed.note).toBe('APAC excludes the Japan restatement');
    expect(owed.anchors[0]).toMatchObject({ attachmentUid: recorded.attachment_uid, locator: { range: 'B3' } });

    // And the row says where, too.
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(page.getByTestId('criterion-row').getByText(/APAC excludes the Japan restatement — totals\.csv, B3/)).toBeVisible();
  });

  test('the bytes route serves text with the safety headers and a byte range', async ({ request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Q3 notes', body: 'x' }] });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\nline two\n');
    const agent = await createMcpClient();
    const recorded = JSON.parse((await agent.callTool('record_artefact', {
      item_uid: plan.actionUids[0], path: path.relative(PROJECT_PATH, path.join(dir, 'notes.md')), role: 'output',
    })).content[0].text);
    agent.close();

    const full = await request.get(`${API}/artefacts/${recorded.attachment_uid}/content`);
    expect(full.status()).toBe(200);
    expect(full.headers()['x-content-type-options']).toBe('nosniff');
    expect(full.headers()['cache-control']).toBe('no-store');
    expect(await full.text()).toBe('# Notes\nline two\n');

    const part = await request.get(`${API}/artefacts/${recorded.attachment_uid}/content`, { headers: { Range: 'bytes=2-6' } });
    expect(part.status()).toBe(206);
    expect(await part.text()).toBe('Notes');

    const meta = await (await request.get(`${API}/artefacts/${recorded.attachment_uid}`)).json();
    expect(meta.path).toBe(path.relative(PROJECT_PATH, path.join(dir, 'notes.md')).split(path.sep).join('/'));
    expect(JSON.stringify(meta)).not.toContain(PROJECT_PATH);
  });
});
