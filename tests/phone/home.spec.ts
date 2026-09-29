/**
 * The phone's Home screen, seen (Phase 32 A4.5a): what needs the person
 * first. Two agents are held at breakpoints; the card says so in the
 * desktop's words and opens the list.
 */
import { test, expect } from '@playwright/test';
import { openScreen, navigations, shot } from './helpers';

const now = Date.now();
const hit = (ref: string, headline: string, breach = false) => ({
  ref, breach, headline, why: '', labels: { continue: 'Continue', steer: 'Continue with steer', stop: 'Stop' },
  breakpointNote: null, agent: 'codex', planUid: null, itemUid: null, path: null, hitAt: now - 120_000, decision: null, note: null, answeredAt: null,
});

test('held agents come first, and the card opens the list', async ({ page }) => {
  await openScreen(page, 'home', {
    state: {
      waitingBreakpoints: 2,
      activeProject: { path: '/work/acme', displayName: 'acme', branch: 'main' },
      agents: [{ sessionId: 's1', agentType: 'codex', model: 'gpt-5', activePlanUid: null, lastSeen: now - 5_000 }],
    },
    rpc: {
      'breakpoint.waiting': { hits: [hit('bp-1', 'codex in auth-refresh wants to claim “Partial refunds”'), hit('bp-2', 'claude-code changed payments/refund.ts', true)] },
      'criteria.awaiting': { entries: [] },
    },
  });
  const card = page.getByLabel('2 waiting on you at a breakpoint');
  await expect(card).toBeVisible();
  await expect(card).toContainText('2 agents are waiting on you');
  await expect(card).toContainText('codex in auth-refresh wants to claim “Partial refunds”');
  await shot(page, 'home-needs-attention');
  await card.click();
  expect(await navigations(page)).toContainEqual({ action: 'push', to: '/breakpoints' });
});
