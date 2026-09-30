/**
 * Phase 32 B7.5b — a guarded plan document changed on disk, in the inbox
 * (JOURNEYS I1).
 *
 * A legacy plan's "Credit note format" document is guarded with a spec
 * breakpoint. Its file is edited on disk: "Waiting on you" says it changed
 * on disk, shows the app's version (kept) beside the file's, and offers
 * "Apply the file" or "Keep the app's version", with no note for an agent
 * because none is waiting. Applying it updates the document.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { API, PROJECT_PATH, authHeaders, cleanupPlans, gotoWithProject } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const BODY = '# Credit note format\n\nA credit note is JSON.\n\n## Fields\n\n- amount\n';
const NOTE = 'Invoices go to the tax office; ask me first.';

async function shot(target: Page | ReturnType<Page['getByTestId']>, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => setTimeout(r, 300));
  await target.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('A guarded plan document', () => {
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => { await cleanupPlans(request, 'E2E Disk guard'); });

  test('changed on disk: held in the inbox with both versions; applying it takes the file\'s', async ({ page, request }) => {
    const plan = (await (await request.post(`${API}/plans`, { headers: authHeaders(), data: { title: 'E2E Disk guard Invoicing', projectPath: PROJECT_PATH } })).json()) as { uid: string };
    const doc = (await (await request.post(`${API}/plans/${plan.uid}/docs`, { headers: authHeaders(), data: { docType: 'custom', title: 'Credit note format', body: BODY } })).json()) as { uid: string };
    const exported = (await (await request.post(`${API}/plans/${plan.uid}/export?path=${encodeURIComponent(PROJECT_PATH)}`, { headers: authHeaders() })).json()) as { files: string[] };
    const file = exported.files.find((f) => f.includes(`${path.sep}docs${path.sep}`) && fs.readFileSync(f, 'utf-8').includes(`uid: ${doc.uid}`))!;
    // Linking schedules one more export of the plan; let it land before editing.
    let last = '';
    await expect.poll(() => { const now = String(fs.statSync(file).mtimeMs); const still = now === last; last = now; return still; }, { timeout: 10_000, intervals: [700] }).toBe(true);
    const bp = await request.post(`${API}/breakpoints`, { headers: authHeaders(), data: { kind: 'spec', docUid: doc.uid, note: NOTE } });
    expect(bp.ok()).toBeTruthy();
    const bpId = ((await bp.json()) as { breakpoint: { id: string } }).breakpoint.id;

    try {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('- amount\n', '- amount\n- currency\n'));
      await expect.poll(async () => {
        const hits = ((await (await request.get(`${API}/breakpoint-hits`, { headers: authHeaders() })).json()) as { hits: Array<{ action: string; itemUid: string }> }).hits;
        return hits.some((x) => x.action === 'disk' && x.itemUid === doc.uid);
      }, { timeout: 15_000 }).toBe(true);

      await gotoWithProject(page);
      const tab = page.getByRole('button', { name: /^Awareness( \d+)?$/ });
      await expect(page.getByRole('button', { name: /^Awareness \d+$/ })).toBeVisible({ timeout: 15_000 });
      await tab.click();
      await tab.locator('..').getByRole('button', { name: 'Expand panel' }).click();
      const card = page.getByTestId('breakpoint-waiting').filter({ hasText: 'Credit note format' });
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card).toContainText('“Credit note format” changed on disk');
      await expect(card.getByTestId('breakpoint-why')).toContainText('the app kept its own version until you decide');
      await expect(card).toContainText(NOTE);
      const diff = card.getByTestId('disk-change');
      await expect(diff).toContainText('In the app (kept)');
      await expect(diff).toContainText('On disk');
      await expect(diff).toContainText('- currency');
      await expect(card.getByRole('button', { name: 'Apply the file' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Keep the app\'s version' })).toBeVisible();
      await expect(card.getByRole('button', { name: /steer|with a note/i })).toHaveCount(0);
      await expect(card.getByLabel('A note the agent will read')).toHaveCount(0);
      await shot(card, 'plan-doc-changed-on-disk');

      await card.getByRole('button', { name: 'Apply the file' }).click();
      await expect(card).toHaveCount(0, { timeout: 10_000 });
      await tab.locator('..').getByRole('button', { name: 'Collapse panel' }).click();
      const now = (await (await request.get(`${API}/plan-docs/${doc.uid}`, { headers: authHeaders() })).json()) as { body: string };
      expect(now.body).toBe(`${BODY}- currency\n`);
    } finally {
      await request.delete(`${API}/breakpoints/${bpId}`, { headers: authHeaders() });
    }
  });
});
