/**
 * The Rules view (Phase 32 A7.1 in Settings; its own workspace since Phase 33 G7).
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

test.describe('The Rules view', () => {
  test.setTimeout(90_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a rule written for the team says what already breaks it, and is stopped', async ({ page }) => {
    const rules: Array<Record<string, unknown>> = [];
    const puts: Array<{ id: string; body: Record<string, unknown> }> = [];
    const deletes: Array<string | null> = [];
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
      // R3: the preview, before anything is written.
      if (req.method() === 'POST' && pathname.endsWith('/preview')) {
        const body = req.postDataJSON() as Record<string, unknown>;
        return route.fulfill({ json: body.remove
          ? { change: { effect: 'loosens', allowed: [{ from: 'web/legacy/report.ts', to: 'db/client.ts' }] }, words: `✗ This change removes the rule “web/ may not import db/” (${id}): 1 import it forbade become allowed. Loosening a rule needs a person's approval in the app.`, needsConfirm: true }
          : { change: { effect: 'tightens', allowed: [] }, words: '⚠ This change adds the rule', needsConfirm: false } });
      }
      if (req.method() === 'PUT') {
        const body = req.postDataJSON() as Record<string, unknown>;
        puts.push({ id, body });
        rules.push({ ...body, id, since: new Date().toISOString(), by: 'Sam Lee' });
        return route.fulfill({ json: { rule: rules.at(-1) } });
      }
      if (req.method() === 'DELETE') {
        deletes.push(new URL(req.url()).searchParams.get('confirm'));
        rules.splice(rules.findIndex((r) => r.id === id), 1);
        return route.fulfill({ json: { removed: id } });
      }
      return route.fallback();
    });

    await gotoWithProject(page);
    // Phase 33 G7: rules have a view of their own, opened from the top bar.
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const dialog = page.getByTestId('rules-view');
    const section = dialog.getByTestId('rules-section');
    await expect(dialog).toContainText('a pull request shows any change to them');
    await expect(section.getByTestId('rule')).toHaveCount(0);

    await section.getByTestId('rule-from').fill('web/');
    await section.getByTestId('rule-may-not-import').fill('db/');
    await section.getByTestId('rule-except').fill('db/types.ts');
    await section.getByTestId('rule-because').fill('web talks to db through the API');
    // R4: a new rule starts at warn; this one is made to block.
    await expect(section.getByTestId('rule-strength-warn')).toBeChecked();
    await section.getByTestId('rule-strength-block').check();
    fs.mkdirSync(OUT, { recursive: true });
    await section.screenshot({ path: path.join(OUT, 'rules-settings-form.png') });
    await section.getByTestId('rule-save').click();

    await expect(section.getByTestId('rule')).toHaveCount(1);
    expect(puts).toEqual([{ id: 'web-not-db', body: { from: 'web/', mayNotImport: 'db/', because: 'web talks to db through the API', except: ['db/types.ts'], strength: 'block' } }]);
    await expect(section.getByTestId('rule-strength')).toHaveText('■ block');
    await expect(section.getByTestId('rule-words')).toHaveText('web/ may not import db/ (except db/types.ts): web talks to db through the API');
    // Written, it opens on what already breaks it.
    await expect(section.getByTestId('rule-breach-words')).toHaveText('1 import breaks this today');
    await expect(section.getByTestId('rule-breach')).toHaveText(['web/legacy/report.ts → db/client.ts']);
    await expect(section.getByTestId('rule-from')).toHaveValue('');
    await section.getByTestId('rules-list').screenshot({ path: path.join(OUT, 'rules-settings-rule.png') });

    // R3: stopping it loosens it, so the app shows what that allows and waits.
    await section.getByTestId('rule-stop').click();
    const panel = section.getByTestId('rule-confirm-panel');
    await expect(panel.getByTestId('rule-confirm-words')).toHaveText('✗ This change removes the rule “web/ may not import db/” (web-not-db): 1 import it forbade become allowed. Loosening a rule needs a person\'s approval in the app.');
    await panel.screenshot({ path: path.join(OUT, 'rules-settings-confirm-stop.png') });
    await panel.getByTestId('rule-cancel').click();
    await expect(panel).toHaveCount(0);
    await expect(section.getByTestId('rule')).toHaveCount(1);
    expect(deletes).toEqual([]);
    await section.getByTestId('rule-stop').click();
    await section.getByTestId('rule-confirm').click();
    await expect(section.getByTestId('rule')).toHaveCount(0);
    expect(deletes).toEqual(['1']);
  });

  test('a rule the backend refuses says why', async ({ page }) => {
    await page.route((url) => url.pathname.startsWith('/api/rules'), (route) => (
      route.request().method() === 'GET'
        ? route.fulfill({ json: { rules: [] } })
        : route.fulfill({ status: 400, json: { error: 'from may not climb out of the project' } })
    ));
    await gotoWithProject(page);
    // Phase 33 G7: rules have a view of their own, opened from the top bar.
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const dialog = page.getByTestId('rules-view');
    const section = dialog.getByTestId('rules-section');
    await section.getByTestId('rule-from').fill('../web/');
    await section.getByTestId('rule-may-not-import').fill('db/');
    await section.getByTestId('rule-save').click();
    await expect(section.getByTestId('rule-error')).toHaveText('from may not climb out of the project');
  });
});

test.describe('The Rules view: what agents propose (Phase 33 R3)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a proposed loosening shows what it allows, and is accepted only once confirmed', async ({ page }) => {
    const words = '✗ This change removes the rule “web/ may not import db/” (web-not-db): 1 import it forbade become allowed. Loosening a rule needs a person\'s approval in the app.';
    let open = true;
    const decisions: unknown[] = [];
    await page.route((url) => url.pathname.startsWith('/api/rules'), async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === 'GET' && pathname === '/api/rules') return route.fulfill({ json: { rules: [] } });
      if (req.method() === 'GET' && pathname === '/api/rules/proposals') {
        return route.fulfill({ json: { proposals: open ? [{ uid: 'p1', ruleId: 'web-not-db', status: 'open', why: 'The report needs the DB client.', author: 'claude-code', createdAt: Date.now(), now: { words, needsConfirm: true } }] : [] } });
      }
      if (req.method() === 'POST' && pathname === '/api/rules/proposals/p1/decide') {
        decisions.push(req.postDataJSON());
        open = false;
        return route.fulfill({ json: { proposal: { uid: 'p1', status: 'accepted' } } });
      }
      return route.fallback();
    });
    await gotoWithProject(page);
    // Phase 33 G7: rules have a view of their own, opened from the top bar.
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const dialog = page.getByTestId('rules-view');
    const box = dialog.getByTestId('rule-proposals');
    await expect(box.getByTestId('rule-proposal-words')).toHaveText(words);
    await expect(box).toContainText('claude-code: “The report needs the DB client.”');
    await box.getByTestId('rule-proposal-accept').click();
    expect(decisions).toEqual([]);
    await expect(box.getByTestId('rule-confirm')).toHaveText('Accept it, signed as you');
    fs.mkdirSync(OUT, { recursive: true });
    await box.screenshot({ path: path.join(OUT, 'rules-settings-proposal.png') });
    await box.getByTestId('rule-confirm').click();
    await expect(dialog.getByTestId('rule-proposals')).toHaveCount(0);
    expect(decisions).toEqual([{ decision: 'accept', confirm: true }]);
  });
});

test.describe('The Rules view: suites, a package rule, and the history (Phase 33 G7)', () => {
  test.setTimeout(90_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the owner makes the Stripe rule, sees what it does, and finds it in the history; Settings points here', async ({ page }) => {
    const stripe = {
      id: 'stripe-only-src-payments-index-ts', kind: 'package', from: '**', mayNotImport: 'npm:stripe', only: ['src/payments/index.ts'], except: [],
      because: 'the wrapper sets idempotency keys and retries', strength: 'block', suite: 'payments', since: '2026-10-06T12:00:00.000Z', by: 'Sam Lee',
    };
    const web = { id: 'web-not-db', from: 'web/', mayNotImport: 'db/', except: [], because: 'web talks to db through the API', strength: 'warn', suite: 'architecture', since: '2026-10-01T09:00:00.000Z', by: 'Sam Lee' };
    let made = false;
    const puts: Array<Record<string, unknown>> = [];
    const previews: Array<Record<string, unknown>> = [];
    await page.route((url) => url.pathname.startsWith('/api/rules'), async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === 'GET' && pathname === '/api/rules') {
        const rules = [
          { rule: web, where: '.codetrellis/rules/architecture.yaml', words: 'web/ may not import db/: web talks to db through the API', breaches: [], breachWords: 'Nothing breaks this today', debt: 3 },
          ...(made ? [{ rule: stripe, where: '.codetrellis/rules/payments.yaml', words: 'only src/payments/index.ts may import npm:stripe: the wrapper sets idempotency keys and retries', breaches: [{ rule: stripe.id, from: 'src/checkout/pay.ts', to: 'npm:stripe' }], breachWords: '1 import breaks this today', debt: 0 }] : []),
        ];
        const suites = [
          { suite: 'architecture', where: '.codetrellis/rules/architecture.yaml', rules: 1, breaches: 0, debt: 3, status: 'holds', words: '1 rule · nothing breaks them today · 3 old breaches in the baseline' },
          ...(made ? [{ suite: 'payments', where: '.codetrellis/rules/payments.yaml', rules: 1, breaches: 1, debt: 0, status: 'breaks', words: '1 rule · 1 import breaks them today' }] : []),
        ];
        return route.fulfill({ json: { rules, suites, inConfig: 0, problems: [] } });
      }
      if (req.method() === 'GET' && pathname === '/api/rules/proposals') return route.fulfill({ json: { proposals: [] } });
      if (req.method() === 'GET' && pathname === '/api/rules/history') {
        return route.fulfill({ json: { history: made ? [{ at: Date.UTC(2026, 9, 6, 12), ruleId: stripe.id, change: 'set', by: 'Sam Lee', words: 'Sam Lee set the rule “only src/payments/index.ts may import npm:stripe” (payments)' }] : [] } });
      }
      if (req.method() === 'POST' && pathname.endsWith('/preview')) {
        previews.push(req.postDataJSON() as Record<string, unknown>);
        return route.fulfill({ json: { change: { effect: 'tightens', allowed: [] }, words: '⚠ This change adds the rule “only src/payments/index.ts may import npm:stripe”: 1 import already in the code would break it.', needsConfirm: false } });
      }
      if (req.method() === 'PUT') {
        puts.push({ id: decodeURIComponent(pathname.split('/')[3]), ...(req.postDataJSON() as Record<string, unknown>) });
        made = true;
        return route.fulfill({ json: { rule: stripe } });
      }
      return route.fallback();
    });

    await gotoWithProject(page);
    // Settings keeps only switches: its section says where rules went, and opens it.
    await page.locator('button[title*="Settings"]').click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Architecture rules', exact: true }).click();
    await expect(settings.getByTestId('rules-settings')).toContainText('Rules are made and changed there.');
    await settings.getByTestId('rules-open-view').click();
    await expect(settings).toHaveCount(0);

    const view = page.getByTestId('rules-view');
    await expect(view).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rules', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const suites = view.getByTestId('rules-suite');
    await expect(suites).toHaveCount(1);
    await expect(suites.first().getByTestId('rules-suite-status')).toHaveText('holds');
    await expect(suites.first().getByTestId('rules-suite-words')).toHaveText('1 rule · nothing breaks them today · 3 old breaches in the baseline');
    await expect(view.getByTestId('rule-debt')).toHaveText(' · 3 old breaches in the baseline');
    await expect(view.getByTestId('rules-history')).toContainText('No change to the rules has been made in this app yet.');

    // The Stripe rule: who alone may import the package.
    await view.getByTestId('rule-kind-package').check();
    await expect(view.getByTestId('rule-from')).toHaveCount(0);
    await view.getByTestId('rule-package').fill('npm:stripe');
    await view.getByTestId('rule-only').fill('src/payments/index.ts');
    await view.getByTestId('rule-because').fill('the wrapper sets idempotency keys and retries');
    await view.getByTestId('rule-suite').fill('payments');
    await view.getByTestId('rule-strength-block').check();
    await view.getByTestId('rule-save').click();

    // The preview is asked for after the click returns: wait for it.
    await expect.poll(() => previews).toEqual([{ kind: 'package', package: 'npm:stripe', only: ['src/payments/index.ts'], because: 'the wrapper sets idempotency keys and retries', strength: 'block', suite: 'payments' }]);
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ id: 'stripe-only-src-payments-index-ts', kind: 'package', package: 'npm:stripe', only: ['src/payments/index.ts'], because: 'the wrapper sets idempotency keys and retries', strength: 'block', suite: 'payments' });

    // Its suite now breaks, with what breaks it; the history names the change.
    await expect(suites).toHaveCount(2);
    const payments = suites.filter({ hasText: 'payments' });
    await expect(payments.getByTestId('rules-suite-status')).toHaveText('breaks');
    await payments.click();
    const shown = view.getByTestId('rule');
    await expect(shown).toHaveCount(1);
    await expect(shown.getByTestId('rule-words')).toHaveText('only src/payments/index.ts may import npm:stripe: the wrapper sets idempotency keys and retries');
    // Just made, it opens on what breaks it.
    await expect(shown.getByTestId('rule-breach-words')).toHaveText('1 import breaks this today');
    await expect(shown.getByTestId('rule-breach')).toHaveText(['src/checkout/pay.ts → npm:stripe']);
    await expect(view.getByTestId('rules-history-entry')).toContainText(['Sam Lee set the rule “only src/payments/index.ts may import npm:stripe” (payments)']);
    await view.getByTestId('rules-suite-all').click();
    await expect(view.getByTestId('rule')).toHaveCount(2);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'rules-view.png') });

    await view.getByTestId('rules-view-close').click();
    await expect(view).toHaveCount(0);
  });
});

test.describe('The Rules view: an export (Phase 33 R6)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the owner keeps createCharge to the payments module: the form sends the export and who may import it', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    const previews: Array<Record<string, unknown>> = [];
    await page.route((url) => url.pathname.startsWith('/api/rules'), async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === 'GET' && pathname === '/api/rules') return route.fulfill({ json: { rules: [], suites: [], inConfig: 0, problems: [] } });
      if (req.method() === 'GET' && pathname === '/api/rules/proposals') return route.fulfill({ json: { proposals: [] } });
      if (req.method() === 'GET' && pathname === '/api/rules/history') return route.fulfill({ json: { history: [] } });
      if (req.method() === 'POST' && pathname.endsWith('/preview')) {
        previews.push(req.postDataJSON() as Record<string, unknown>);
        return route.fulfill({ json: { change: { effect: 'tightens', allowed: [] }, words: '⚠ This change adds the rule “only src/payments/ may import createCharge from src/payments/charge.ts”: 1 import already in the code would break it.', needsConfirm: false } });
      }
      if (req.method() === 'PUT') {
        puts.push({ id: decodeURIComponent(pathname.split('/')[3]), ...(req.postDataJSON() as Record<string, unknown>) });
        return route.fulfill({ json: { rule: {} } });
      }
      return route.fallback();
    });

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const view = page.getByTestId('rules-view');
    await view.getByTestId('rule-kind-symbol').check();
    await expect(view.getByTestId('rule-package')).toHaveCount(0);
    await expect(view.getByTestId('rule-form')).toContainText('Importing it through a barrel (an index file that passes it on) counts too.');
    await expect(view.getByTestId('rule-save')).toBeDisabled();
    await view.getByTestId('rule-symbol').fill('src/payments/charge.ts#createCharge');
    await view.getByTestId('rule-only').fill('src/payments/');
    await view.getByTestId('rule-because').fill('Charging sets idempotency keys');
    await view.getByTestId('rule-save').click();
    await expect.poll(() => puts).toEqual([{
      id: 'createcharge-only-src-payments', kind: 'symbol', symbol: 'src/payments/charge.ts#createCharge', only: ['src/payments/'],
      because: 'Charging sets idempotency keys', strength: 'warn',
    }]);
    expect(previews[0]).toMatchObject({ kind: 'symbol', symbol: 'src/payments/charge.ts#createCharge' });
  });

  test('the owner keeps calls to Stripe to the client (Phase 33 R7): the form sends the call and who may make it', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    await page.route((url) => url.pathname.startsWith('/api/rules'), async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === 'GET' && pathname === '/api/rules') return route.fulfill({ json: { rules: [], suites: [], inConfig: 0, problems: [] } });
      if (req.method() === 'GET' && pathname === '/api/rules/proposals') return route.fulfill({ json: { proposals: [] } });
      if (req.method() === 'GET' && pathname === '/api/rules/history') return route.fulfill({ json: { history: [] } });
      if (req.method() === 'POST' && pathname.endsWith('/preview')) {
        return route.fulfill({ json: { change: { effect: 'tightens', allowed: [] }, words: '⚠ This change adds the rule “only src/payments/ may call api.stripe.com”.', needsConfirm: false } });
      }
      if (req.method() === 'PUT') {
        puts.push({ id: decodeURIComponent(pathname.split('/')[3]), ...(req.postDataJSON() as Record<string, unknown>) });
        return route.fulfill({ json: { rule: {} } });
      }
      return route.fallback();
    });

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const view = page.getByTestId('rules-view');
    await view.getByTestId('rule-kind-calls').check();
    await expect(view.getByTestId('rule-form')).toContainText('A call is http: and a host or a path');
    await view.getByTestId('rule-calls').fill('stripe');
    await view.getByTestId('rule-only').fill('src/payments/');
    await expect(view.getByTestId('rule-save')).toBeDisabled();
    await view.getByTestId('rule-calls').fill('http:api.stripe.com');
    await view.getByTestId('rule-save').click();
    await expect.poll(() => puts).toEqual([{
      id: 'api-stripe-com-only-src-payments', kind: 'calls', calls: 'http:api.stripe.com', only: ['src/payments/'], because: '', strength: 'warn',
    }]);
  });

  test('the owner writes the services convention (Phase 33 R8): a folder, its names, one export, and the guide shown on the rule', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    let made = false;
    const guide = 'One service per file, named for its domain; pure helpers go in lib/.';
    const rule = {
      id: 'src-backend-services-files', kind: 'folder', from: 'src/backend/services/', mayNotImport: '', files: ['*-service.ts'], exports: 'one', guide,
      except: [], because: '', strength: 'warn', suite: 'architecture', since: '2026-10-06T12:00:00.000Z', by: 'Sam Lee',
    };
    await page.route((url) => url.pathname.startsWith('/api/rules'), async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === 'GET' && pathname === '/api/rules') {
        return route.fulfill({ json: { rules: made ? [{ rule, where: '.codetrellis/rules/architecture.yaml', words: 'files in src/backend/services/ are named *-service.ts and export one thing each', breaches: [], breachWords: 'Nothing breaks this today', debt: 0 }] : [], suites: [], inConfig: 0, problems: [] } });
      }
      if (req.method() === 'GET' && pathname === '/api/rules/proposals') return route.fulfill({ json: { proposals: [] } });
      if (req.method() === 'GET' && pathname === '/api/rules/history') return route.fulfill({ json: { history: [] } });
      if (req.method() === 'POST' && pathname.endsWith('/preview')) return route.fulfill({ json: { change: { effect: 'tightens', allowed: [] }, words: '⚠ This change adds the rule.', needsConfirm: false } });
      if (req.method() === 'PUT') {
        puts.push({ id: decodeURIComponent(pathname.split('/')[3]), ...(req.postDataJSON() as Record<string, unknown>) });
        made = true;
        return route.fulfill({ json: { rule } });
      }
      return route.fallback();
    });

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const view = page.getByTestId('rules-view');
    await view.getByTestId('rule-kind-folder').check();
    await view.getByTestId('rule-folder').fill('src/backend/services/');
    await expect(view.getByTestId('rule-save')).toBeDisabled();
    await view.getByTestId('rule-files').fill('*-service.ts');
    await view.getByTestId('rule-one-export').check();
    await view.getByTestId('rule-guide-input').fill(guide);
    await view.getByTestId('rule-save').click();
    await expect.poll(() => puts).toEqual([{
      id: 'src-backend-services-files', kind: 'folder', folder: 'src/backend/services/', files: ['*-service.ts'], exports: 'one', guide, because: '', strength: 'warn',
    }]);
    await expect(view.getByTestId('rule-guide')).toHaveText(guide);
    await expect(view.getByTestId('rule-words')).toHaveText('files in src/backend/services/ are named *-service.ts and export one thing each');
  });

  test('the owner keeps console.log out of the backend (Phase 33 B2): files, the text read as a regex, and what breaks it today', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    let made = false;
    const words = 'no file in src/backend/ (except **/*.test.ts) may contain a line matching /console\\.(log|debug)\\(/: The backend logs through services/logger, which redacts.';
    const rule = {
      id: 'no-console-log-debug', kind: 'grep', from: '**', mayNotImport: 'console\\.(log|debug)\\(', match: 'regex', in: ['src/backend/'],
      except: ['**/*.test.ts'], because: 'The backend logs through services/logger, which redacts.', strength: 'warn', suite: 'architecture', since: '2026-10-07T12:00:00.000Z', by: 'Sam Lee',
    };
    await page.route((url) => url.pathname.startsWith('/api/rules'), async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === 'GET' && pathname === '/api/rules') {
        return route.fulfill({ json: { rules: made ? [{ rule, where: '.codetrellis/rules/architecture.yaml', words, breaches: [{ rule: rule.id, from: 'src/backend/server.ts', to: 'grep:0a1b2c3d:+console.log(\'listening\', port);' }], breachWords: '1 line breaks this today', debt: 0 }] : [], suites: [], inConfig: 0, problems: [] } });
      }
      if (req.method() === 'GET' && pathname === '/api/rules/proposals') return route.fulfill({ json: { proposals: [] } });
      if (req.method() === 'GET' && pathname === '/api/rules/history') return route.fulfill({ json: { history: [] } });
      if (req.method() === 'POST' && pathname.endsWith('/preview')) return route.fulfill({ json: { change: { effect: 'tightens', allowed: [] }, words: '⚠ This change adds the rule.', needsConfirm: false } });
      if (req.method() === 'PUT') {
        puts.push({ id: decodeURIComponent(pathname.split('/')[3]), ...(req.postDataJSON() as Record<string, unknown>) });
        made = true;
        return route.fulfill({ json: { rule } });
      }
      return route.fallback();
    });

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const view = page.getByTestId('rules-view');
    await view.getByTestId('rule-kind-grep').check();
    await expect(view.getByTestId('rule-form')).toContainText('read line by line, in any language');
    await view.getByTestId('rule-grep-in').fill('src/backend/');
    await expect(view.getByTestId('rule-save')).toBeDisabled();
    await view.getByTestId('rule-except').fill('**/*.test.ts');
    await view.getByTestId('rule-grep-text').fill('console\\.(log|debug)\\(');
    await view.getByTestId('rule-grep-match').selectOption('regex');
    await view.getByTestId('rule-because').fill('The backend logs through services/logger, which redacts.');
    fs.mkdirSync(OUT, { recursive: true });
    await view.getByTestId('rule-form').screenshot({ path: path.join(OUT, 'rules-grep-form.png') });
    await view.getByTestId('rule-save').click();
    await expect.poll(() => puts).toEqual([{
      id: 'no-console-log-debug', kind: 'grep', in: ['src/backend/'], except: ['**/*.test.ts'], mustNot: 'console\\.(log|debug)\\(', match: 'regex',
      because: 'The backend logs through services/logger, which redacts.', strength: 'warn',
    }]);
    await expect(view.getByTestId('rule-words')).toHaveText(words);
    await expect(view.getByText('1 line breaks this today')).toBeVisible();
  });

  test('the owner writes a rule in words, for an agent review to judge (Phase 33 B5)', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    let made = false;
    const said = 'Code that moves money records it through services/ledger, never by writing balances directly.';
    const rule = { id: 'code-that-moves-money-records', kind: 'agent', from: '**', mayNotImport: said, in: ['src/'], except: [], because: '', strength: 'warn', suite: 'architecture', since: '2026-10-07T12:00:00.000Z', by: 'Sam Lee' };
    await page.route((url) => url.pathname.startsWith('/api/rules'), async (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === 'GET' && pathname === '/api/rules') {
        return route.fulfill({ json: { rules: made ? [{ rule, where: '.codetrellis/rules/architecture.yaml', words: `in src/: ${said}`, breaches: null, breachWords: 'Judged by an agent review, against its words: no code checks it, and with no review it is a guide', debt: 0 }] : [], suites: [], inConfig: 0, problems: [] } });
      }
      if (req.method() === 'GET' && pathname === '/api/rules/proposals') return route.fulfill({ json: { proposals: [] } });
      if (req.method() === 'GET' && pathname === '/api/rules/history') return route.fulfill({ json: { history: [] } });
      if (req.method() === 'POST' && pathname.endsWith('/preview')) return route.fulfill({ json: { change: { effect: 'tightens', allowed: [] }, words: '⚠ This change adds the rule.', needsConfirm: false } });
      if (req.method() === 'PUT') {
        puts.push({ id: decodeURIComponent(pathname.split('/')[3]), ...(req.postDataJSON() as Record<string, unknown>) });
        made = true;
        return route.fulfill({ json: { rule } });
      }
      return route.fallback();
    });

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const view = page.getByTestId('rules-view');
    await view.getByTestId('rule-kind-agent').check();
    await expect(view.getByTestId('rule-form')).toContainText('No code checks it: an agent review judges each change against these words');
    await view.getByTestId('rule-agent-in').fill('src/');
    await expect(view.getByTestId('rule-save')).toBeDisabled();
    await view.getByTestId('rule-agent-words').fill(said);
    await view.getByTestId('rule-save').click();
    await expect.poll(() => puts).toEqual([{ id: 'code-that-moves-money-records', engine: 'agent', rule: said, in: ['src/'], because: '', strength: 'warn' }]);
    await expect(view.getByTestId('rule-words')).toHaveText(`in src/: ${said}`);
    await expect(view.getByText('Judged by an agent review, against its words')).toBeVisible();
  });

  test('the pipeline in the Rules view: its stages in order, and a dropped stage approved by the person, signed (Phase 33 B6)', async ({ page }) => {
    const stages = ['fast: deterministic rules', 'review: agent rules, after fast, grounded by fast'];
    const dropped = '✗ This change removes the stage fuzzy from the pipeline (“fuzzy: fuzzy rules, beside the stage before”). Loosening a rule needs a person\'s approval in the app.';
    let approvals = 0;
    await page.route((url) => url.pathname.startsWith('/api/pipeline'), async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        approvals += 1;
        return route.fulfill({ json: { signed: [{ stage: 'fuzzy', file: '.codetrellis/rules/approvals/pipeline.fuzzy-0a1b2c3d4e5f.yaml', how: 'device' }], view: { where: '.codetrellis/pipeline.yaml', pipeline: { stages: [] }, problems: [], words: stages, pending: [] } } });
      }
      return route.fulfill({ json: { where: '.codetrellis/pipeline.yaml', pipeline: { stages: [] }, problems: [], words: stages, pending: [{ stage: 'fuzzy', words: dropped }] } });
    });
    await page.route((url) => url.pathname.startsWith('/api/rules'), (route) => route.fulfill({ json: route.request().url().includes('proposals') ? { proposals: [] } : route.request().url().includes('history') ? { history: [] } : { rules: [], suites: [], inConfig: 0, problems: [] } }));

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    const panel = page.getByTestId('pipeline-panel');
    await expect(panel.getByTestId('pipeline-stage')).toHaveText(stages);
    await expect(panel.getByTestId('pipeline-pending-words')).toHaveText(dropped);
    fs.mkdirSync(OUT, { recursive: true });
    await panel.screenshot({ path: path.join(OUT, 'rules-pipeline.png') });
    await panel.getByTestId('pipeline-approve').click();
    await expect(panel.getByTestId('pipeline-pending')).toHaveCount(0);
    expect(approvals).toBe(1);
  });
});
