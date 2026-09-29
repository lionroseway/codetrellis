/**
 * "Message the agents" (Phase 32 A4.1), journey C2's reply from the desktop.
 *
 * billing-v2 changed a function checkout-fix imports. Sam opens the warning
 * in the Awareness tab, writes to the agents, and sends; the message sits
 * under the warning, first unread ("each agent in this work reads it on its
 * next step"), then read by the agents once they have made a call.
 *
 * The delivery itself (once per agent, only in the two workstreams, and the
 * steer on the plan) is proven against a real backend by
 * tests/e2e/awareness-replies.test.ts. Here the answers are served, so each
 * state Sam meets is shown and photographed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import type { AwarenessSignal, SignalReply, Workstream, WorkstreamAgent } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const now = Date.now();
const agent = (sessionId: string, agentType: string): WorkstreamAgent => ({ sessionId, agentType, model: null, source: 'mcp', lastSeen: now - 12_000 });
const ws = (root: string, branch: string, agents: WorkstreamAgent[], files: string[]): Workstream => ({
  root, branch, head: '3f9c2e1a7b', main: false, shape: 'worktree', agents,
  changes: { base: '9a8b7c6d5e', files: files.map((p) => ({ path: p, status: 'modified' as const })), truncated: false }, idle: false,
});
const ROOM: Workstream[] = [
  ws('/work/acme-billing', 'billing-v2', [agent('s-bill', 'claude-code')], ['src/billing/invoice.ts']),
  ws('/work/acme-checkout', 'checkout-fix', [agent('s-check', 'codex')], ['src/checkout/submit.ts']),
];
const CONTRACT: AwarenessSignal = {
  id: 'k1', kind: 'contract', severity: 'high',
  subject: {
    file: 'src/billing/invoice.ts', symbol: 'createInvoice', by: '/work/acme-billing', change: 'signature',
    signature: { before: '(order: Order): Invoice', after: '(order: Order, currency: string): Invoice' }, importers: ['src/checkout/submit.ts'],
  },
  workstreams: ['/work/acme-billing', '/work/acme-checkout'],
  summary: '`billing-v2` changed createInvoice in src/billing/invoice.ts: (order: Order): Invoice → (order: Order, currency: string): Invoice. `checkout-fix` imports it in 1 file',
  firstSeen: now - 9 * 60_000, lastSeen: now - 20_000, state: 'open',
};
const WORDS = 'Keep the old signature until checkout-fix has moved its callers.';

async function serve(page: Page) {
  const replies: SignalReply[] = [];
  const sent: Array<{ id: string; message: string; project: string | null }> = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/breakpoint-hits', (r) => r.fulfill(json({ hits: [] })));
  await page.route('**/api/workstreams?*', (r) => r.fulfill(json(ROOM)));
  await page.route('**/api/awareness?*', (r) => r.fulfill(json({ signals: [{ ...CONTRACT, ...(replies.length ? { replies } : {}) }] })));
  await page.route('**/api/awareness/*/reply?*', async (r) => {
    const url = new URL(r.request().url());
    const { message } = r.request().postDataJSON() as { message: string };
    sent.push({ id: decodeURIComponent(url.pathname.split('/')[3]), message, project: url.searchParams.get('project') });
    const reply: SignalReply = { id: replies.length + 1, message: message.trim(), by: { actor: 'sam', actorType: 'human', channel: 'desktop' }, at: Date.now(), readBy: [] };
    replies.push(reply);
    await r.fulfill(json({ ...reply, signalId: CONTRACT.id, steers: ['e1'] }, 201));
  });
  return {
    sent,
    /** The agents make a call: the backend would now say they read it. */
    read: () => { for (const r of replies) r.readBy = [{ sessionId: 's-check', agentType: 'codex', readAt: Date.now() }, { sessionId: 's-bill', agentType: 'claude-code', readAt: Date.now() }]; },
  };
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('Message the agents about a warning', () => {
  test('write to both agents from the warning, see it waiting, then read', async ({ page }) => {
    const backend = await serve(page);
    await gotoWithProject(page);
    const tab = page.getByRole('button', { name: /^Awareness/ });
    await tab.click();
    await tab.locator('..').getByRole('button', { name: 'Expand panel' }).click();

    const card = page.locator('[data-testid="awareness-signal"]').filter({ hasText: 'createInvoice' });
    await expect(card).toBeVisible();
    await card.getByTestId('awareness-message-agents').click();
    const box = card.getByTestId('awareness-message-box');
    await expect(box).toContainText('Each agent in billing-v2 and checkout-fix reads it on its next step.');
    const send = box.getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled(); // nothing written yet
    await box.getByRole('textbox', { name: 'Message to the agents' }).fill(WORDS);
    await expect(send).toBeInViewport();
    await shot(page, 'awareness-message-agents');
    await send.click();

    // Sent to this signal, for this project; the box closes and the message sits under the warning.
    await expect(box).toHaveCount(0);
    expect(backend.sent).toHaveLength(1);
    expect(backend.sent[0]).toMatchObject({ id: 'k1', message: WORDS });
    expect(backend.sent[0].project).toBeTruthy();
    const reply = card.getByTestId('awareness-reply');
    await expect(reply).toContainText(`“${WORDS}”`);
    await expect(reply.getByTestId('awareness-reply-read')).toHaveText('Not read yet: each agent in this work reads it on its next step');
    await shot(page, 'awareness-message-sent');

    // The agents make their next calls; the backend tells the window, and the tab says who read it.
    backend.read();
    await page.evaluate(() => window.dispatchEvent(new Event('awareness-changed')));
    await expect(card.getByTestId('awareness-reply-read')).toHaveText(/^Read by codex and claude-code · /);
  });

  test('Escape closes the box without sending', async ({ page }) => {
    const backend = await serve(page);
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Awareness/ }).click();
    const card = page.locator('[data-testid="awareness-signal"]').filter({ hasText: 'createInvoice' });
    await card.getByTestId('awareness-message-agents').click();
    await card.getByRole('textbox', { name: 'Message to the agents' }).fill('never mind');
    await page.keyboard.press('Escape');
    await expect(card.getByTestId('awareness-message-box')).toHaveCount(0);
    expect(backend.sent).toEqual([]);
  });
});
