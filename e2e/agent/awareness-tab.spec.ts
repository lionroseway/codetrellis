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
  // The tab's count also counts calls waiting at a breakpoint (B4.3); none here, whatever other specs left on the shared backend.
  await page.route('**/api/breakpoint-hits', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: [] }) }));
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
    // The commits each workstream made are extra: a slow read of them never holds back the count.
    await page.route('**/api/workstreams/commits?*', async (route) => {
      await new Promise((r) => setTimeout(r, 30_000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ commits: {} }) }).catch(() => {});
    });
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
    await expect(low.getByTestId('awareness-signal').getByTestId('awareness-actions').getByRole('button')).toHaveText(['Acknowledge', 'Dismiss']);

    await expandPanel(page);
    await shot(page, 'awareness-tab');
  });

  test('acknowledging moves an overlap to Seen, says who and when, and quiets the chip', async ({ page }) => {
    const sent = await serve(page, ROOM, SIGNALS());
    await gotoWithProject(page);
    await tabButton(page).click();

    await card(page, 'refreshToken').getByRole('button', { name: 'Acknowledge' }).click();
    await expect.poll(() => sent).toEqual([{ id: 'c1', state: 'acknowledged', project: expect.any(String) }]);

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
    await expect(set.getByTestId('awareness-actions').getByRole('button')).toHaveText(['Reopen']);

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
    await expect(c.getByTestId('awareness-actions').getByRole('button')).toHaveText(['Acknowledge', 'Intended', 'Dismiss']);

    const r = card(page, 'formatTotal');
    await expect(r).toContainText('Removed export');
    await expect(r.getByTestId('awareness-contract')).toContainText('Imported by src/billing/receipt.ts');

    await expandPanel(page);
    await shot(page, 'awareness-contract');

    // Intended: the change is meant, and the importing side will follow.
    await c.getByRole('button', { name: 'Intended' }).click();
    await expect.poll(() => sent).toEqual([{ id: 'k1', state: 'intended', project: expect.any(String) }]);
    await expect(page.getByTestId('awareness-set-aside')).toContainText('Set aside 1');
  });

  test('drift: a workstream editing outside its claimed item, the files named, and it can be intended (A2.5)', async ({ page }) => {
    const drift = signal('d1', {
      kind: 'drift', severity: 'medium', workstreams: ['/work/acme-billing'],
      subject: { files: ['config/shared.ts', 'src/auth/session.ts'], items: ['item-1'] },
      summary: '`billing-v2` changes 2 files outside the scope its claimed item gives it: config/shared.ts, src/auth/session.ts',
    });
    const sent = await serve(page, ROOM, [drift]);
    await gotoWithProject(page);
    await tabButton(page).click();

    const d = card(page, 'outside the scope');
    await expect(d).toHaveAttribute('data-severity', 'medium');
    await expect(d).toContainText('Outside its scope');
    await expect(d.getByTestId('awareness-sides')).toHaveText('billing-v2');
    await expect(d.getByTestId('awareness-drift')).toContainText('Outside the scope of its claimed item:');
    await expect(d.getByTestId('awareness-drift')).toContainText('config/shared.ts');
    await expect(d.getByTestId('awareness-drift')).toContainText('src/auth/session.ts');
    await expect(d.getByTestId('awareness-actions').getByRole('button')).toHaveText(['Acknowledge', 'Intended', 'Dismiss']);
    await expandPanel(page);
    await shot(page, 'awareness-drift');

    await d.getByRole('button', { name: 'Intended' }).click();
    await expect.poll(() => sent).toEqual([{ id: 'd1', state: 'intended', project: expect.any(String) }]);
  });

  test('a rule: the imports that break it, the rule and why, and the way to change it (A7.2)', async ({ page }) => {
    const rule = signal('r1', {
      kind: 'rule', severity: 'high', workstreams: ['/work/acme-billing'],
      subject: {
        files: ['web/reports.ts'],
        rule: { id: 'web-not-db', words: 'web/ may not import db/', because: 'web talks to db through the API' },
        edges: [{ from: 'web/reports.ts', to: 'db/client.ts' }],
      },
      summary: '`billing-v2` now imports db/ from web/ (web/reports.ts → db/client.ts), which the rule “web/ may not import db/” forbids: web talks to db through the API',
    });
    const sent = await serve(page, ROOM, [rule]);
    await gotoWithProject(page);
    await tabButton(page).click();

    const r = card(page, 'which the rule');
    await expect(r).toHaveAttribute('data-severity', 'high');
    await expect(r).toContainText('Breaks a rule');
    await expect(r.getByTestId('awareness-sides')).toHaveText('billing-v2');
    await expect(r.getByTestId('awareness-rule-words')).toHaveText('The rule “web/ may not import db/”, because web talks to db through the API:');
    await expect(r.getByTestId('awareness-rule-edge')).toHaveText(['web/reports.ts db/client.ts']);
    await expect(r.getByTestId('awareness-actions').getByRole('button')).toHaveText(['Acknowledge', 'Intended', 'Dismiss']);
    await expandPanel(page);
    await shot(page, 'awareness-rule');

    // If the import is right, the rule is what changes: the card opens it in Settings.
    await r.getByTestId('awareness-rule-change').click();
    await expect(page.getByTestId('rules-section')).toBeVisible();
    await page.keyboard.press('Escape');

    await r.getByRole('button', { name: 'Intended' }).click();
    await expect.poll(() => sent).toEqual([{ id: 'r1', state: 'intended', project: expect.any(String) }]);
  });

  test('who was told, and what each agent said, sit beside the person\'s answer (A2.6)', async ({ page }) => {
    const told = signal('t1', {
      kind: 'contract', severity: 'high', workstreams: ['/work/acme-auth', '/work/acme-billing'],
      subject: {
        file: 'src/billing/invoice.ts', symbol: 'createInvoice', by: '/work/acme-billing', change: 'signature',
        signature: { before: '(opts: InvoiceOpts): Invoice', after: '(opts: InvoiceOpts, currency: string): Invoice' },
        importers: ['src/auth/checkout.ts'],
      },
      summary: '`billing-v2` changed createInvoice in src/billing/invoice.ts: (opts: InvoiceOpts): Invoice → (opts: InvoiceOpts, currency: string): Invoice. `auth-refresh` imports it in 1 file',
      // Early in their minute, as the others in this file are: "ago" rounds
      // down, and loading the page takes seconds. The last told was at 170 s,
      // which read "3 min ago" once the load passed 10 s (#194, Browser 1/3).
      told: [
        { sessionId: 's2', agentType: 'codex', toldAt: Date.now() - 135_000, note: 'Seen. I will pass currency: "GBP" until billing-v2 merges.', notedAt: Date.now() - 120_000 },
        { sessionId: 's3', agentType: 'claude-code', toldAt: Date.now() - 130_000 },
      ],
    });
    await serve(page, ROOM, [told]);
    await gotoWithProject(page);
    await tabButton(page).click();

    const c = card(page, 'createInvoice');
    const box = c.getByTestId('awareness-told');
    await expect(box).toContainText('Told codex and claude-code · 2 min ago');
    await expect(c.getByTestId('awareness-agent-note')).toHaveText('“Seen. I will pass currency: "GBP" until billing-v2 merges.” — codex · 2 min ago');
    // The agent's note is not the person's answer: it is still open, and theirs to give.
    await expect(c).toHaveAttribute('data-state', 'open');
    await expect(c.getByTestId('awareness-answered')).toHaveCount(0);
    await expect(c.getByTestId('awareness-actions').getByRole('button')).toHaveText(['Acknowledge', 'Intended', 'Dismiss']);
    await expandPanel(page);
    await shot(page, 'awareness-told');
  });

  test('the digest: a line per pair of workstreams, what is waiting on you, and what is new since you last looked (A3.1)', async ({ page }) => {
    const earlier = Date.now() - 20 * 60_000;
    await page.addInitScript((at) => window.localStorage.setItem('codetrellis.awareness.lastViewed', String(at)), earlier);
    const many: AwarenessSignal[] = [
      signal('g1', { subject: { file: 'src/auth/session.ts', symbol: 'refreshToken' }, firstSeen: Date.now() - 5 * 60_000 }),
      signal('g2', { subject: { file: 'src/auth/session.ts', symbol: 'renew' }, firstSeen: Date.now() - 5 * 60_000 }),
      signal('g3', { severity: 'medium', subject: { file: 'src/auth/types.ts' }, firstSeen: Date.now() - 60 * 60_000 }),
      signal('k1', {
        kind: 'contract', workstreams: ['/work/acme', '/work/acme-billing'],
        subject: { file: 'src/billing/invoice.ts', symbol: 'createInvoice', by: '/work/acme-billing', change: 'signature', importers: ['src/app.ts'] },
        told: [{ sessionId: 's1', agentType: 'claude-code', toldAt: Date.now() - 60_000 }],
        // Newest of the two high groups, so it leads.
        firstSeen: Date.now() - 2 * 60_000, lastSeen: Date.now() - 5_000,
      }),
      signal('d1', { kind: 'drift', severity: 'medium', workstreams: ['/work/acme-auth'], subject: { files: ['config/shared.ts'] }, firstSeen: Date.now() - 90 * 60_000 }),
    ];
    await serve(page, ROOM, many);
    await gotoWithProject(page);
    await tabButton(page).click();

    const lines = page.getByTestId('awareness-digest-line');
    await expect(lines).toHaveCount(3);
    // Five signals, three lines: the two worktrees overlapping in three places are one.
    await expect(lines.nth(0)).toContainText('billing-v2 changed createInvoice\'s signature; main imports it');
    await expect(lines.nth(0)).toContainText('Agents told.');
    await expect(lines.nth(0)).toContainText('Waiting on you: keep the old signature, or update the callers?');
    await expect(lines.nth(1)).toContainText('auth-refresh and billing-v2 both change 3 things: src/auth/session.ts → refreshToken, src/auth/session.ts → renew and 1 more');
    await expect(lines.nth(1)).not.toContainText('Agents told.');
    await expect(lines.nth(2)).toContainText('auth-refresh changes 1 file outside its scope: config/shared.ts');
    await expect(page.getByTestId('awareness-new-since')).toContainText('3 new since you last looked');
    await expandPanel(page);
    await shot(page, 'awareness-digest');
  });

  test('an answered overlap that changed shape is back, and says why (A3.2)', async ({ page }) => {
    const back = signal('b1', {
      severity: 'medium', subject: { file: 'src/auth/session.ts' },
      summary: '`auth-refresh` and `billing-v2` both change src/auth/session.ts',
      reopened: { from: 'intended', at: Date.now() - 60_000 },
    });
    await serve(page, ROOM, [back]);
    await gotoWithProject(page);
    await tabButton(page).click();
    const c = card(page, 'both change src/auth/session.ts');
    // Back where it needs the person, not under "Set aside".
    await expect(page.getByTestId('awareness-needs-you').getByTestId('awareness-signal')).toHaveCount(1);
    await expect(c.getByTestId('awareness-reopened')).toHaveText('Back: it changed since you marked it intended · 1 min ago');
    await expect(c.getByTestId('awareness-actions').getByRole('button')).toHaveText(['Acknowledge', 'Intended', 'Dismiss']);
    await expandPanel(page);
    await shot(page, 'awareness-reopened');
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
