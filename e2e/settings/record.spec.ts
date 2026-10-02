/**
 * Settings → Data → The record (Phase 32 B10.1).
 *
 * Sam opens Data and reads, in one sentence, whether everything CodeTrellis
 * kept about the agents' work and the team's decisions still matches the
 * chain it was written into: against the real backend, intact. Then the
 * answer for a database someone changed (answered on the page; the real
 * tampering is tests/e2e/record.test.ts): which entries, what happened to
 * each, and asking again.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');

async function openData(page: Page) {
  await gotoWithProject(page);
  await page.locator('button[title*="Settings"]').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Data', exact: true }).click();
  return dialog.getByTestId('record-section');
}

test.describe('Settings → Data → The record', () => {
  test.setTimeout(90_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the real record walks intact, with its latest entry', async ({ page }) => {
    const section = await openData(page);
    await expect(section.getByTestId('record-words')).toHaveAttribute('data-ok', 'true');
    await expect(section.getByTestId('record-words')).toHaveText(/^(Intact: [\d,]+ entr(y|ies) since \d{4}-\d{2}-\d{2} match the chain|Nothing is in the record yet)/);
    await expect(section.getByTestId('record-problems')).toHaveCount(0);
    fs.mkdirSync(OUT, { recursive: true });
    await section.screenshot({ path: path.join(OUT, 'record-intact.png') });
  });

  test('a changed record names each entry and what happened to it; asked again, it walks again', async ({ page }) => {
    let walks = 0;
    await page.route('**/api/record', (route) => {
      walks++;
      return route.fulfill({ json: {
        ok: false, entries: 1204, since: Date.UTC(2026, 8, 18), trimmedThrough: 0,
        head: { seq: 1204, hash: '3f9a2c7d1e5b'.padEnd(64, '0') },
        problems: [
          { seq: 512, eventId: 'mcp-tool-1', kind: 'changed', at: Date.UTC(2026, 8, 20, 14, 2), type: 'tool_call', agentType: 'codex' },
          { seq: 513, eventId: 'app-9', kind: 'removed', at: null, type: null, agentType: null },
        ],
        words: 'Changed after it was written: 2 of 1,204 entries since 2026-09-18. #512 (tool call by codex, 2026-09-20): its content changed after it was written; #513: it was removed.',
      } });
    });
    const section = await openData(page);
    await expect(section.getByTestId('record-words')).toHaveAttribute('data-ok', 'false');
    await expect(section.getByTestId('record-words')).toContainText('#512 (tool call by codex, 2026-09-20): its content changed after it was written');
    await expect(section.getByTestId('record-problem')).toHaveCount(2);
    await expect(section.getByTestId('record-problem').first()).toContainText('#512 · content changed · tool call by codex');
    await expect(section.getByTestId('record-problem').nth(1)).toHaveText('#513 · removed');
    await expect(section.getByTestId('record-head')).toHaveText('Latest entry #1204 · 3f9a2c7d1e5b…');
    await section.screenshot({ path: path.join(OUT, 'record-changed.png') });

    const before = walks;
    await section.getByTestId('record-verify').click();
    await expect.poll(() => walks).toBe(before + 1);
  });
});
