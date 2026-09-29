/**
 * The phone's breakpoints (Phase 32 B4.4), seen for the first time (A4.5a).
 *
 * B4.4 built this screen, typechecked and linted it, and never rendered it:
 * the app had no way to be looked at off a device. Here it is, with two held
 * calls in the desktop's words, the three answers, and a steer that needs a
 * note before it is sent.
 */
import { test, expect } from '@playwright/test';
import { openScreen, calls, shot } from './helpers';

const now = Date.now();
const HELD = {
  ref: 'bp-1', breach: false,
  headline: 'codex in auth-refresh wants to claim “Partial refunds”',
  why: 'You asked to be asked before an agent claims or finishes this task.',
  labels: { continue: 'Continue', steer: 'Continue with steer', stop: 'Stop' },
  breakpointNote: 'Ask me before touching payments', agent: 'codex', planUid: 'p1', itemUid: 'i1', path: null,
  hitAt: now - 4 * 60_000, decision: null, note: null, answeredAt: null,
};
const BREACH = {
  ...HELD, ref: 'bp-2', breach: true,
  headline: 'claude-code in billing-v2 changed payments/refund.ts',
  why: 'It changed a file with a breakpoint before anything could pause it, and was told to stop and wait.',
  labels: { continue: 'Carry on', steer: 'Carry on with a note', stop: 'Stop' },
  breakpointNote: null, agent: 'claude-code', itemUid: null, path: 'payments/refund.ts', hitAt: now - 60_000,
};

test('held calls, oldest first, in the desktop\'s words; a steer needs a note', async ({ page }) => {
  await openScreen(page, 'breakpoints', {
    state: { waitingBreakpoints: 2 },
    rpc: {
      'breakpoint.waiting': { hits: [HELD, BREACH] },
      'breakpoint.answer': { hit: { ...HELD, decision: 'steer', note: "Don't change the refund path", answeredAt: now } },
    },
  });
  await expect(page.getByText(HELD.headline)).toBeVisible();
  await expect(page.getByText(BREACH.headline)).toBeVisible();
  await expect(page.getByText('Ask me before touching payments')).toBeVisible();
  await shot(page, 'breakpoints-waiting');

  expect((await calls(page)).map((c) => c.method)).toContain('breakpoint.waiting');
});

test('nothing held: the empty screen says what would bring something here', async ({ page }) => {
  await openScreen(page, 'breakpoints', { rpc: { 'breakpoint.waiting': { hits: [] } } });
  await expect(page.getByText('No agent is waiting on you')).toBeVisible();
  await shot(page, 'breakpoints-empty');
});

test('a steer needs a note: Send waits for one, then sends the note with the answer', async ({ page }) => {
  await openScreen(page, 'breakpoints', {
    state: { waitingBreakpoints: 1 },
    rpc: {
      'breakpoint.waiting': { hits: [HELD] },
      'breakpoint.answer': { hit: { ...HELD, decision: 'steer', note: "Don't change the refund path", answeredAt: now } },
    },
  });
  await page.getByText('Continue with steer').click();
  // A TouchableOpacity is a div on the web; its disabled state is aria-disabled, as a screen reader hears it.
  const send = page.getByText('Send', { exact: true }).locator('xpath=ancestor-or-self::*[@tabindex or @aria-disabled][1]');
  await expect(send).toHaveAttribute('aria-disabled', 'true');
  await page.getByLabel('A note the agent will read').fill("Don't change the refund path");
  await expect(send).not.toHaveAttribute('aria-disabled', 'true');
  await shot(page, 'breakpoints-steer');
  await send.click();
  await expect.poll(async () => (await calls(page)).find((c) => c.method === 'breakpoint.answer')?.params)
    .toEqual({ ref: 'bp-1', decision: 'steer', note: "Don't change the refund path" });
});
