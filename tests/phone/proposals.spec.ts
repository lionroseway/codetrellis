/**
 * A proposed spec change on the phone (Phase 32 B7.6).
 *
 * In Waiting on you beside the held calls: who proposes what and why, the
 * note on the page's breakpoint, the text now and proposed, what the relying
 * plan replied, and Accept or Reject with a note for the proposer.
 */
import { test, expect } from '@playwright/test';
import { openScreen, calls, shot } from './helpers';

const now = Date.now();
const HIT = {
  ref: 'bp-p1', breach: false, proposalUid: 'sp-1',
  headline: 'codex wants to change the spec “Invoice format”',
  why: 'A spec others rely on would change. Nothing changes until you decide.',
  labels: { continue: 'Accept', steer: 'Accept, with a note', stop: 'Reject' },
  breakpointNote: null, agent: 'codex', planUid: 'p1', itemUid: 'page-1', path: null,
  hitAt: now - 6 * 60_000, decision: null, note: null, answeredAt: null,
};
const HELD = {
  ...HIT, ref: 'bp-1', proposalUid: null,
  headline: 'claude-code in main wants to claim “Show totals”',
  why: 'You asked to be asked before an agent claims or finishes this task.',
  labels: { continue: 'Continue', steer: 'Continue with steer', stop: 'Stop' },
  breakpointNote: 'Ask me before checkout work', itemUid: 'i1', hitAt: now - 60_000,
};
const PROPOSAL = {
  uid: 'sp-1', hitRef: 'bp-p1', status: 'open',
  headline: '✎ codex proposes a change to § Fields of “Invoice format”',
  where: '§ Fields of “Invoice format”',
  why: 'Amounts are ambiguous for EU customers.',
  evidence: 'tests invoice_eu.spec',
  before: '## Fields\n\n- amount\n',
  proposed: '## Fields\n\n- amount\n- currency (ISO 4217)',
  replies: '2 tasks in 2 plans rely on this. 2 of 2 replied.',
  impacts: [
    { impact: 'changes', label: 'Changes 1 task', who: 'Show totals (Checkout)', words: 'The totals row must show the currency.' },
    { impact: 'none', label: 'No impact', who: 'Export invoices (Exports)', words: '' },
  ],
  pageChangedSince: false, guardNote: 'Invoices go to the tax office; ask me first.', guarded: true,
  createdAt: now - 6 * 60_000, decidedAt: null, decisionNote: null,
};

test('a proposal waits beside the held calls, with every reply, and is accepted with a note', async ({ page }) => {
  await openScreen(page, 'breakpoints', {
    state: { waitingBreakpoints: 2 },
    rpc: {
      'breakpoint.waiting': { hits: [HIT, HELD] },
      'proposal.get': { proposal: PROPOSAL },
      'proposal.decide': { proposal: { ...PROPOSAL, status: 'accepted', decisionNote: 'Name the standard.' }, flagged: 2 },
    },
  });
  await expect(page.getByText(PROPOSAL.headline)).toBeVisible();
  await expect(page.getByText('Why: Amounts are ambiguous for EU customers.')).toBeVisible();
  await expect(page.getByText('Evidence: tests invoice_eu.spec')).toBeVisible();
  await expect(page.getByText('You guard this page: “Invoices go to the tax office; ask me first.”')).toBeVisible();
  await expect(page.getByText(PROPOSAL.replies)).toBeVisible();
  await expect(page.getByText('Changes 1 task')).toBeVisible();
  await expect(page.getByText('— The totals row must show the currency.', { exact: false })).toBeVisible();
  await expect(page.getByText('No impact')).toBeVisible();
  // The held call beside it keeps its own three answers.
  await expect(page.getByText(HELD.headline)).toBeVisible();
  await shot(page, 'proposal-waiting');

  await page.getByLabel('A note for the proposer').fill('Name the standard.');
  await page.getByText('Accept', { exact: true }).click();
  await expect.poll(async () => (await calls(page)).find((c) => c.method === 'proposal.decide')?.params)
    .toEqual({ uid: 'sp-1', decision: 'accept', note: 'Name the standard.' });
  expect((await calls(page)).filter((c) => c.method === 'breakpoint.answer')).toEqual([]);
});
