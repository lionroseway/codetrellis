/**
 * Settings → Architecture rules (Phase 32 A7.1).
 *
 * Sam's team keeps the web app off the database. He writes "web/ may not
 * import db/, except db/types.ts, because web talks to db through the API".
 * It is listed for the team, and says that one import already breaks it,
 * which opens to show it: web/legacy/report.ts → db/client.ts. He stops it.
 *
 * The rule calls are answered on the page (the backend's side, real rules in
 * the committed config and the real graph, is tests/e2e/architecture-rules
 * .test.ts), so nothing is written into the repository the suite runs on.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');

test.describe('Settings → Architecture rules', () => {
  test.setTimeout(90_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a rule written for the team says what already breaks it, and is stopped', async ({ page }) => {
    const rules: Array<Record<string, unknown>> = [];
    const puts: Array<{ id: string; body: Record<string, unknown> }> = [];
    await page.route((url) => url.pathname.startsWith('/api/rules'), async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === 'GET' && pathname === '/api/rules') {
        return route.fulfill({
          json: {
            rules: rules.map((rule) => ({
              rule,
              words: `${rule.from} may not import ${rule.mayNotImport}${(rule.except as string[]).length ? ` (except ${(rule.except as string[]).join(', ')})` : ''}: ${rule.because}`,
              breaches: [{ rule: rule.id, from: 'web/legacy/report.ts', to: 'db/client.ts' }],
              breachWords: '1 import breaks this today',
            })),
          },
        });
      }
      const id = decodeURIComponent(pathname.split('/')[3] ?? '');
      if (req.method() === 'PUT') {
        const body = req.postDataJSON() as Record<string, unknown>;
        puts.push({ id, body });
        rules.push({ ...body, id, since: new Date().toISOString(), by: 'Sam Lee' });
        return route.fulfill({ json: { rule: rules.at(-1) } });
      }
      if (req.method() === 'DELETE') {
        rules.splice(rules.findIndex((r) => r.id === id), 1);
        return route.fulfill({ json: { removed: id } });
      }
      return route.fallback();
    });

    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Architecture rules', exact: true }).click();
    const section = dialog.getByTestId('rules-section');
    await expect(section).toContainText('imports that break a rule today are listed here, not hidden');
    await expect(section.getByTestId('rule')).toHaveCount(0);

    await section.getByTestId('rule-from').fill('web/');
    await section.getByTestId('rule-may-not-import').fill('db/');
    await section.getByTestId('rule-except').fill('db/types.ts');
    await section.getByTestId('rule-because').fill('web talks to db through the API');
    fs.mkdirSync(OUT, { recursive: true });
    await section.screenshot({ path: path.join(OUT, 'rules-settings-form.png') });
    await section.getByTestId('rule-save').click();

    await expect(section.getByTestId('rule')).toHaveCount(1);
    expect(puts).toEqual([{ id: 'web-not-db', body: { from: 'web/', mayNotImport: 'db/', because: 'web talks to db through the API', except: ['db/types.ts'] } }]);
    await expect(section.getByTestId('rule-words')).toHaveText('web/ may not import db/ (except db/types.ts): web talks to db through the API');
    // Written, it opens on what already breaks it.
    await expect(section.getByTestId('rule-breach-words')).toHaveText('1 import breaks this today');
    await expect(section.getByTestId('rule-breach')).toHaveText(['web/legacy/report.ts → db/client.ts']);
    await expect(section.getByTestId('rule-from')).toHaveValue('');
    await section.getByTestId('rules-list').screenshot({ path: path.join(OUT, 'rules-settings-rule.png') });

    await section.getByTestId('rule-stop').click();
    await expect(section.getByTestId('rule')).toHaveCount(0);
  });

  test('a rule the backend refuses says why', async ({ page }) => {
    await page.route((url) => url.pathname.startsWith('/api/rules'), (route) => (
      route.request().method() === 'GET'
        ? route.fulfill({ json: { rules: [] } })
        : route.fulfill({ status: 400, json: { error: 'from may not climb out of the project' } })
    ));
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Architecture rules', exact: true }).click();
    const section = dialog.getByTestId('rules-section');
    await section.getByTestId('rule-from').fill('../web/');
    await section.getByTestId('rule-may-not-import').fill('db/');
    await section.getByTestId('rule-save').click();
    await expect(section.getByTestId('rule-error')).toHaveText('from may not climb out of the project');
  });
});
