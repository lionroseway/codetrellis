/**
 * A task's grounding line, on the phone (Phase 32 B8.3b).
 *
 * Sam opens "Q3 revenue summary" on his phone. Above its criteria, the line
 * the desktop says: "3 criteria · 1 grounded · 1 waiting on a person · 1
 * changed since"; under each criterion, why it stands where it does. A
 * desktop from before B8.3b sends no line, and the criteria show as before.
 *
 * The desktop's side (`criteria.list` with `grounding`) is served here as
 * the RPC answer; tests/e2e/task-grounding.test.ts checks it against a real
 * backend and a paired phone.
 */
import { test, expect } from '@playwright/test';
import { openScreen, shot } from './helpers';

const ITEM = {
  uid: 'i1', planUid: 'p1', parentUid: null, kind: 'action', title: 'Q3 revenue summary', body: 'Summarise Q3 for the board.',
  status: 'in_progress', assignee: 'claude-code', assigneeType: 'mcp', progressPercent: 60, blockedReason: null,
  sortOrder: 1, createdAt: 1, updatedAt: 2,
};
const criterion = (uid: string, text: string, state: string) => ({
  uid, itemUid: 'i1', text, kind: 'citation', policy: 'propose', state, author: 'Sam Lee', authorType: 'human', latestSubmission: [], latestSignoff: null,
});
const CRITERIA = [
  criterion('c1', 'A summary exists', 'met'),
  criterion('c2', 'Reads well to the board', 'open'),
  criterion('c3', 'EMEA revenue matches the ledger', 'stale'),
];
const GROUNDING = {
  words: '3 criteria · 1 grounded · 1 waiting on a person · 1 changed since', grounded: false,
  grades: {
    c1: { grade: 'grounded', why: 'met, and its checks still pass' },
    c2: { grade: 'waiting', why: 'only a person can judge it' },
    c3: { grade: 'changed', why: 'a file it was approved on has changed since' },
  },
};
const side = (grounding: unknown) => ({
  rpc: {
    'plan.item.get': { item: ITEM, comments: [], externalRefs: [], attachments: [] },
    'plan.items': [ITEM],
    'criteria.list': { item: { uid: 'i1', title: ITEM.title, planUid: 'p1' }, criteria: CRITERIA, ...(grounding ? { grounding } : {}) },
  },
});

test('the task\'s grounding line above its criteria, and why each stands where it does', async ({ page }) => {
  await openScreen(page, 'item-detail', side(GROUNDING), { uid: 'i1', planUid: 'p1' });
  const line = page.getByTestId('grounding-line');
  await expect(line).toHaveText(GROUNDING.words);
  await expect(page.getByText('only a person can judge it')).toBeVisible();
  await expect(page.getByText('a file it was approved on has changed since')).toBeVisible();
  await line.scrollIntoViewIfNeeded();
  await shot(page, 'item-grounding');
});

test('a desktop from before B8.3b: the criteria show, without the line', async ({ page }) => {
  await openScreen(page, 'item-detail', side(null), { uid: 'i1', planUid: 'p1' });
  await expect(page.getByText('EMEA revenue matches the ledger')).toBeVisible();
  await expect(page.getByTestId('grounding-line')).toHaveCount(0);
});
