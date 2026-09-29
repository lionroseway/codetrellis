/**
 * The phone's other everyday screens, seen (Phase 32 A4.5a): the plans list,
 * the activity feed and what is waiting for the person's approval. Each is
 * shown with a realistic desktop, and one empty.
 */
import { test, expect } from '@playwright/test';
import { openScreen, navigations, shot } from './helpers';

const now = Date.now();

test('plans: each with its progress', async ({ page }) => {
  await openScreen(page, 'plans', {
    state: {
      plans: [
        { uid: 'p1', name: 'Partial refunds', status: 'in_progress', projectPath: '/work/acme', itemCount: 6, doneCount: 2, inProgressCount: 1, updatedAt: now - 600_000 },
        { uid: 'p2', name: 'Invoice currency', status: 'draft', projectPath: '/work/acme', itemCount: 3, doneCount: 0, inProgressCount: 0, updatedAt: now - 7_200_000 },
      ],
    },
  });
  await expect(page.getByText('Partial refunds')).toBeVisible();
  await expect(page.getByText('Invoice currency')).toBeVisible();
  await shot(page, 'plans-list');
});

test('activity: the agents and what they posted', async ({ page }) => {
  await openScreen(page, 'activity', {
    state: {
      agents: [{ sessionId: 's1', agentType: 'codex', model: 'gpt-5', activePlanUid: 'p1', lastSeen: now - 5_000 }],
      plans: [{ uid: 'p1', name: 'Partial refunds', status: 'in_progress', projectPath: '/work/acme', itemCount: 6, doneCount: 2, inProgressCount: 1, updatedAt: now }],
      channelEvents: [
        { uid: 'e1', planUid: 'p1', eventType: 'need-decision', message: 'Refund to the original card, or to store credit?', author: 'codex', authorType: 'agent', status: 'open', createdAt: now - 180_000 },
        { uid: 'e2', planUid: 'p1', eventType: 'steer', message: "Don't change the refund path", author: 'sam@acme.dev', authorType: 'human', status: 'open', createdAt: now - 60_000 },
      ],
    },
  });
  await expect(page.getByText('Refund to the original card, or to store credit?')).toBeVisible();
  await shot(page, 'activity-feed');
  await page.getByText('Refund to the original card, or to store credit?').click();
  expect(await navigations(page)).toContainEqual({ action: 'push', to: '/event-detail?uid=e1' });
});

test('activity, quiet: says so', async ({ page }) => {
  await openScreen(page, 'activity', {});
  await expect(page.getByText('No channel events yet')).toBeVisible();
  await shot(page, 'activity-empty');
});

test('approvals: what is waiting for the person, by task', async ({ page }) => {
  await openScreen(page, 'approvals', {
    rpc: {
      'criteria.awaiting': {
        entries: [{
          uid: 'c1', itemUid: 'i1', text: 'Refunds over £500 need a second approver', kind: 'check', policy: 'human', state: 'submitted',
          evidence: [], lastDecision: null, changedFiles: ['src/payments/refund.ts'], canApprove: true, canSendBack: true,
          itemTitle: 'Partial refunds', planUid: 'p1', planTitle: 'Refunds',
        }],
      },
    },
  });
  await expect(page.getByText('Refunds over £500 need a second approver')).toBeVisible();
  await shot(page, 'approvals-waiting');
});
