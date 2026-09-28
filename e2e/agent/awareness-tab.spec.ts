/**
 * The Awareness tab (Phase 32 A1.8): the journey from a marked chip to an
 * answered overlap.
 *
 * What the backend stores and returns is proven by
 * tests/e2e/awareness-answers.test.ts against real worktrees. This drives
 * the app with fixed answers, kept in step as the person answers, so each
 * state they meet is shown and photographed: the chip, the tab it opens,
 * an answer moving a signal down and taking it back, and the calm states.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import type { AwarenessSignal, Workstream, WorkstreamAgent } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const now = Date.now();
const agent = (sessionId: string, agentType: string): WorkstreamAgent => ({ sessionId, agentType, model: null, source: 'mcp', lastSeen: now - 12_000 });
const ws = (root: string, branch: string, main: boolean, agents: WorkstreamAgent[], files: string[] = []): Workstream => ({
  root, branch, head: '3f9c2e1a7b', main, shape: 'worktree', agents,
  changes: { base: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b', files: files.map((p) => ({ path: p, status: 'modified' as const })), truncated: false },
  idle: agents.length === 0 && files.length === 0,
});

const ROOM: Workstream[] = [
  ws('/work/acme', 'main', true, [agent('s1', 'claude-code')]),
  ws('/work/acme-auth', 'auth-refresh', false, [agent('s2', 'codex')], ['src/auth/session.ts']),
  ws('/work/acme-billing', 'billing-v2', false, [agent('s3', 'claude-code')], ['src/auth/session.ts', 'src/billing/invoice.ts']),
];

const signal = (id: string, over: Partial<AwarenessSignal>): AwarenessSignal => ({
  id, kind: 'collision', severity: 'high', subject: {}, workstreams: ['/work/acme-auth', '/work/acme-billing'], summary: '',
  firstSeen: now - 14 * 60_000, lastSeen: now - 30_000, state: 'open', ...over,
});

const SIGNALS = (): AwarenessSignal[] => [
  signal('c1', {
    subject: { file: 'src/auth/session.ts', symbol: 'refreshToken' },
    summary: '`auth-refresh` and `billing-v2` both change src/auth/session.ts → refreshToken',
  }),
  signal('c2', {
    severity: 'medium', subject: { file: 'src/billing/invoice.ts' }, workstreams: ['/work/acme', '/work/acme-billing'],
    summary: '`main` and `billing-v2` both change src/billing/invoice.ts', firstSeen: now - 4 * 60_000,
  }),
  signal('s1', {
    kind: 'stale-base', severity: 'low', subject: { files: ['src/billing/invoice.ts'] }, workstreams: ['/work/acme-billing'],
    summary: 'main changed src/billing/invoice.ts since `billing-v2` branched, and `billing-v2` changes it too',
  }),
];

/**
 * Serve the room and its signals, and answer as the backend does: the
 * answered signal comes back with its state and who gave it, and later reads
 * return it that way. Returns the answers the app sent.
 */
async function serve(page: Page, room: Workstream[], signals: AwarenessSignal[], opts: { failAnswers?: boolean } = {}) {
  const sent: Array<{ id: string; state: string; project: string | null }> = [];
  await page.route('**/api/workstreams?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(room) }));
  await page.route('**/api/awareness?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signals }) }));
  await page.route('**/api/awareness/*/state?*', async (route) => {
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split('/')[3]);
    const { state } = route.request().postDataJSON() as { state: AwarenessSignal['state'] };
    sent.push({ id, state, project: url.searchParams.get('project') });
    if (opts.failAnswers) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No such open signal in this project.' }) });
      return;
    }
    const i = signals.findIndex((s) => s.id === id);
    signals[i] = state === 'open'
      ? { ...signals[i], state, stateBy: undefined, stateAt: undefined }
      : { ...signals[i], state, stateBy: { actor: 'saif', actorType: 'human', channel: 'desktop' }, stateAt: Date.now() };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(signals[i]) });
  });
  const sessions = room.flatMap((w) => w.agents.map((a) => ({
    sessionId: a.sessionId, agentType: a.agentType, model: a.model, activePlanUid: null,
    connectedAt: now - 600_000, lastSeen: a.lastSeen ?? now, status: 'active', capabilities: [],
    workstreamRoot: w.root, hostTerminalId: null,
  })));
  await page.route('**/api/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) }));
  return sent;
}

const tabButton = (page: Page) => page.getByRole('button', { name: /^Awareness/ });
const tab = (page: Page) => page.getByTestId('awareness-tab');
const card = (page: Page, text: string) => page.getByTestId('awareness-signal').filter({ hasText: text });
/** The bottom panel's own expand button (the inspector has one too). */
const expandPanel = (page: Page) => tabButton(page).locator('..').getByRole('button', { name: 'Expand panel' }).click();
const chip = (page: Page, name: string) => page.getByTestId('workstream-chip').filter({ hasText: name });

test.describe('Awareness tab', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('from a marked chip to the tab: the digest, what needs you, both sides of each overlap', async ({ page }) => {
    await serve(page, ROOM, SIGNALS());
    await gotoWithProject(page);

    // The tab says how many need you before anyone opens it.
    await expect(tabButton(page)).toHaveText('Awareness2');
    await expect(chip(page, 'auth-refresh')).toHaveAttribute('data-severity', 'high');

    // The chip's details list the overlap and lead to where it is answered.
    await chip(page, 'auth-refresh').click();
    await page.getByTestId('workstream-review-awareness').click();
    await expect(page.getByTestId('workstream-popover')).toHaveCount(0);
    await expect(tab(page)).toBeVisible();

    await expect(page.getByTestId('awareness-digest')).toContainText('3 workstreams active · 2 need you · 1 low-priority note');
    const needsYou = page.getByTestId('awareness-needs-you').getByTestId('awareness-signal');
    await expect(needsYou).toHaveCount(2);
    await expect(needsYou.first()).toHaveAttribute('data-severity', 'high');
    await expect(needsYou.first()).toContainText('Same function');
    await expect(needsYou.first().getByTestId('awareness-sides')).toContainText('auth-refresh');
    await expect(needsYou.first().getByTestId('awareness-sides')).toContainText('billing-v2');
    await expect(needsYou.first().getByTestId('awareness-sides')).toContainText('src/auth/session.ts · refreshToken');
    await expect(needsYou.nth(1)).toContainText('Same file');

    // A stale base is a low-priority note, collapsed until asked for.
    const low = page.getByTestId('awareness-low');
    await expect(low).toContainText('Low priority 1');
    await expect(low.getByTestId('awareness-signal')).toHaveCount(0);
    await low.getByRole('button', { name: /Low priority/ }).click();
    await expect(low.getByTestId('awareness-signal')).toContainText('Behind main');
    await expect(low.getByTestId('awareness-sides')).toContainText('billing-v2');
    await expect(low.getByTestId('awareness-sides')).toContainText('main');
    await expect(low.getByTestId('awareness-signal').getByRole('button')).toHaveText(['Acknowledge', 'Dismiss']);

    await expandPanel(page);
    await shot(page, 'awareness-tab');
  });

  test('acknowledging moves an overlap to Seen, says who and when, and quiets the chip', async ({ page }) => {
    const sent = await serve(page, ROOM, SIGNALS());
    await gotoWithProject(page);
    await tabButton(page).click();

    await card(page, 'refreshToken').getByRole('button', { name: 'Acknowledge' }).click();
    expect(sent).toEqual([{ id: 'c1', state: 'acknowledged', project: expect.any(String) }]);

    const seen = page.getByTestId('awareness-seen').getByTestId('awareness-signal');
    await expect(seen).toHaveCount(1);
    await expect(seen).toHaveAttribute('data-state', 'acknowledged');
    await expect(seen.getByTestId('awareness-answered')).toHaveText('Acknowledged by you · just now');
    await expect(page.getByTestId('awareness-needs-you').getByTestId('awareness-signal')).toHaveCount(1);
    await expect(tabButton(page)).toHaveText('Awareness1');
    await expect(page.getByTestId('awareness-digest')).toContainText('1 needs you');

    // The strip follows once it next reads: auth-refresh's only overlap was answered.
    await page.evaluate(() => window.dispatchEvent(new Event('awareness-changed')));
    await expect(chip(page, 'auth-refresh')).not.toHaveAttribute('data-severity', /.+/);
    await chip(page, 'auth-refresh').click();
    await expect(page.getByTestId('workstream-signal')).toHaveAttribute('data-state', 'acknowledged');
    await expect(page.getByTestId('workstream-signal')).toContainText('· seen');
    await page.keyboard.press('Escape');

    await expandPanel(page);
    await shot(page, 'awareness-acknowledged');
  });

  test('marked intended, it is set aside; reopened, it needs you again', async ({ page }) => {
    const sent = await serve(page, ROOM, SIGNALS());
    await gotoWithProject(page);
    await tabButton(page).click();

    await card(page, 'invoice.ts').first().getByRole('button', { name: 'Intended' }).click();
    const aside = page.getByTestId('awareness-set-aside');
    await expect(aside).toContainText('Set aside 1');
    await aside.getByRole('button', { name: /Set aside/ }).click();
    const set = aside.getByTestId('awareness-signal');
    await expect(set).toHaveAttribute('data-state', 'intended');
    await expect(set.getByTestId('awareness-answered')).toContainText('Marked intended by you');
    // Only one answer is left to give: take it back.
    await expect(set.getByRole('button')).toHaveText(['Reopen']);

    await set.getByRole('button', { name: 'Reopen' }).click();
    await expect(aside).toHaveCount(0);
    await expect(page.getByTestId('awareness-needs-you').getByTestId('awareness-signal')).toHaveCount(2);
    expect(sent.map((a) => `${a.id} ${a.state}`)).toEqual(['c2 intended', 'c2 open']);
  });

  test('an answer the backend refuses says so, and nothing moves', async ({ page }) => {
    await serve(page, ROOM, SIGNALS(), { failAnswers: true });
    await gotoWithProject(page);
    await tabButton(page).click();
    await card(page, 'refreshToken').getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('Could not update the signal')).toBeVisible();
    await expect(page.getByText('No such open signal in this project.')).toBeVisible();
    await expect(page.getByTestId('awareness-needs-you').getByTestId('awareness-signal')).toHaveCount(2);
  });

  test('a contract change: what changed, before and after, who imports it, and in which direction (A2.3)', async ({ page }) => {
    const contract = signal('k1', {
      kind: 'contract', severity: 'high', workstreams: ['/work/acme-auth', '/work/acme-billing'],
      subject: {
        file: 'src/billing/invoice.ts', symbol: 'createInvoice', by: '/work/acme-billing', change: 'signature',
        signature: { before: '(opts: InvoiceOpts): Invoice', after: '(opts: InvoiceOpts, currency: string): Invoice' },
        importers: ['src/auth/session.ts', 'src/auth/checkout.ts'],
      },
      summary: '`billing-v2` changed createInvoice in src/billing/invoice.ts: (opts: InvoiceOpts): Invoice → (opts: InvoiceOpts, currency: string): Invoice. `auth-refresh` imports it in 2 files',
    });
    const removed = signal('k2', {
      kind: 'contract', severity: 'high', workstreams: ['/work/acme', '/work/acme-billing'],
      subject: { file: 'src/billing/invoice.ts', symbol: 'formatTotal', by: '/work/acme-billing', change: 'removed', importers: ['src/billing/receipt.ts'] },
      summary: '`billing-v2` removed formatTotal from src/billing/invoice.ts. `main` imports it in 1 file',
    });
    const sent = await serve(page, ROOM, [contract, removed]);
    await gotoWithProject(page);
    await tabButton(page).click();

    const c = card(page, 'createInvoice');
    await expect(c).toHaveAttribute('data-severity', 'high');
    await expect(c).toContainText('Changed signature');
    // The side that changed it first, then the side whose work imports it.
    await expect(c.getByTestId('awareness-sides').locator('span.font-mono').first()).toHaveText('billing-v2');
    await expect(c.getByTestId('awareness-sides')).toContainText('auth-refresh');
    await expect(c.getByLabel('imported by')).toBeVisible();
    await expect(c.getByTestId('contract-before')).toHaveText('createInvoice(opts: InvoiceOpts): Invoice');
    await expect(c.getByTestId('contract-after')).toHaveText('createInvoice(opts: InvoiceOpts, currency: string): Invoice');
    await expect(c.getByTestId('awareness-contract')).toContainText('Imported by src/auth/session.ts, src/auth/checkout.ts');
    await expect(c.getByRole('button')).toHaveText(['Acknowledge', 'Intended', 'Dismiss']);

    const r = card(page, 'formatTotal');
    await expect(r).toContainText('Removed export');
    await expect(r.getByTestId('awareness-contract')).toContainText('Imported by src/billing/receipt.ts');

    await expandPanel(page);
    await shot(page, 'awareness-contract');

    // Intended: the change is meant, and the importing side will follow.
    await c.getByRole('button', { name: 'Intended' }).click();
    expect(sent).toEqual([{ id: 'k1', state: 'intended', project: expect.any(String) }]);
    await expect(page.getByTestId('awareness-set-aside')).toContainText('Set aside 1');
  });

  test('calm states: parallel work with nothing to answer, and no parallel work at all', async ({ page }) => {
    await serve(page, ROOM, []);
    await gotoWithProject(page);
    await tabButton(page).click();
    await expect(tabButton(page)).toHaveText('Awareness');
    await expect(page.getByTestId('awareness-digest')).toContainText('3 workstreams active · nothing needs you');
    await expect(page.getByTestId('awareness-digest')).toContainText('New overlaps appear here as they happen');
    await expect(page.getByTestId('awareness-signal')).toHaveCount(0);
    await shot(page, 'awareness-calm');

    await page.unroute('**/api/workstreams?*');
    await page.route('**/api/workstreams?*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ws('/work/acme', 'main', true, [])]) }));
    await page.evaluate(() => window.dispatchEvent(new Event('workstreams-changed')));
    await expect(page.getByTestId('awareness-digest')).toContainText('No parallel work right now');
    await expect(page.getByTestId('awareness-digest')).toContainText('worktrees, clones or branches');
    await shot(page, 'awareness-empty');
  });
});
