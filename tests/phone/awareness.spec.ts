/**
 * What overlaps, on the phone (Phase 32 A4.5b), journey C2.
 *
 * Sam is away. The Activity tab opens with "Needs you": the agent held at a
 * breakpoint, the digest's line, and the overlap between billing-v2 and
 * checkout-fix. The push opens the overlap: both sides in plain words, the
 * files, what the agent said, and Acknowledge, Intended and Reply to agent.
 * The lines of work list each worktree, and one opens to its files and turns.
 *
 * The desktop's side (the words, the digest, the turns) is served here as the
 * RPC answers A4.2 and A4.3 give, harness-tested against a real backend in
 * tests/e2e/phone-awareness.test.ts and phone-workstreams.test.ts.
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { openScreen, calls, navigations, shot } from './helpers';

const now = Date.now();
const MIN = 60_000;

const CONTRACT = {
  id: 'k1', kind: 'contract', severity: 'high', state: 'open', heading: 'Changed signature',
  summary: '`billing-v2` changed createInvoice in src/billing/invoice.ts: (order: Order): Invoice → (order: Order, currency: string): Invoice. `checkout-fix` imports it in 1 file',
  sides: ['billing-v2', 'checkout-fix'], firstSeen: now - 9 * MIN, lastSeen: now - MIN,
};
const COLLISION = {
  id: 'c1', kind: 'collision', severity: 'medium', state: 'acknowledged', heading: 'Same function',
  summary: '`auth-refresh` and `billing-v2` both change src/auth/session.ts → refreshToken',
  sides: ['auth-refresh', 'billing-v2'], firstSeen: now - 40 * MIN, lastSeen: now - 5 * MIN,
};
const NEEDS_YOU = {
  projectRoot: '/work/acme',
  digest: {
    needsYou: 1, low: 0, moreLines: 0,
    lines: [{ text: "`billing-v2` changed createInvoice's signature; `checkout-fix` imports it", question: 'keep the old signature, or update the callers?', told: true, signalIds: ['k1'] }],
  },
  signals: [CONTRACT, COLLISION],
};
const DETAIL = {
  ...CONTRACT,
  sideWords: [
    { root: '/work/acme-billing', name: 'billing-v2', words: "billing-v2 changed createInvoice's signature in src/billing/invoice.ts: createInvoice(order: Order): Invoice is now createInvoice(order: Order, currency: string): Invoice." },
    { root: '/work/acme-checkout', name: 'checkout-fix', words: 'checkout-fix imports it, in 1 file: src/checkout/submit.ts.' },
  ],
  files: ['src/billing/invoice.ts', 'src/checkout/submit.ts'],
  told: [{ agentType: 'codex', toldAt: now - 8 * MIN, note: 'Seen. I will pass the currency from the cart until billing-v2 merges.' }],
  replies: [],
};
const WORDS = 'Keep the old signature until checkout-fix has moved its callers.';

test.describe('Needs you, on Activity', () => {
  test('the held agent, the digest line, and each overlap, which opens its detail', async ({ page }) => {
    await openScreen(page, 'activity', {
      state: { waitingBreakpoints: 1, openSignals: 1 },
      rpc: { 'awareness.needsYou': NEEDS_YOU },
    });
    const section = page.getByTestId('needs-you');
    await expect(section).toContainText('NEEDS YOU (2)');
    await expect(section).toContainText('An agent is waiting on you');
    await expect(section).toContainText("billing-v2 changed createInvoice's signature; checkout-fix imports it");
    await expect(section).toContainText('Waiting on you: keep the old signature, or update the callers? · agents told');
    await expect(page.getByTestId('needs-you-signal')).toHaveCount(2);
    await expect(page.getByTestId('needs-you-signal').first()).toContainText('billing-v2 → checkout-fix');
    await expect(page.getByTestId('needs-you-signal').nth(1)).toContainText('seen');
    await shot(page, 'activity-needs-you');

    await page.getByTestId('needs-you-signal').first().click();
    await page.getByLabel('All lines of work').click();
    expect(await navigations(page)).toEqual([
      { action: 'push', to: '/signal-detail?id=k1' },
      { action: 'push', to: '/workstreams' },
    ]);
  });

  test('nothing waiting says so in a line', async ({ page }) => {
    await openScreen(page, 'activity', {
      rpc: { 'awareness.needsYou': { projectRoot: '/work/acme', digest: { needsYou: 0, low: 0, moreLines: 0, lines: [] }, signals: [] } },
    });
    await expect(page.getByTestId('needs-you')).toContainText('Nothing is waiting on you.');
  });
});

test.describe('One overlap', () => {
  test('both sides in plain words, the files, what the agent said; acknowledged from the phone', async ({ page }) => {
    await openScreen(page, 'signal-detail', {
      rpc: {
        'awareness.signal': { signal: DETAIL },
        'awareness.answer': { signal: { ...DETAIL, state: 'acknowledged', stateAt: now } },
      },
    }, { id: 'k1' });
    await expect(page.getByTestId('signal-side')).toHaveCount(2);
    await expect(page.getByTestId('signal-side').first()).toContainText('is now createInvoice(order: Order, currency: string): Invoice.');
    await expect(page.getByTestId('signal-side').nth(1)).toContainText('→ checkout-fix');
    await expect(page.getByText('src/checkout/submit.ts', { exact: true })).toBeVisible();
    await expect(page.getByText('“Seen. I will pass the currency from the cart until billing-v2 merges.”')).toBeVisible();
    await shot(page, 'signal-detail');

    await page.getByText('Acknowledge', { exact: true }).click();
    await expect(page.getByText(/^You acknowledged it/)).toBeVisible();
    expect((await calls(page)).find((c) => c.method === 'awareness.answer')?.params).toEqual({ id: 'k1', state: 'acknowledged' });
  });

  test('Reply to agent: Send waits for words, then the reply shows under the overlap, not read yet', async ({ page }) => {
    const reply = { id: 1, message: WORDS, by: { actor: 'sam', actorType: 'human', channel: 'phone' }, at: now, readBy: [] };
    await openScreen(page, 'signal-detail', {
      rpc: { 'awareness.signal': { signal: DETAIL }, 'awareness.reply': { signal: { ...DETAIL, replies: [reply] } } },
    }, { id: 'k1' });
    await page.getByText('Reply to agent', { exact: true }).click();
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await expect(send).toBeDisabled();
    await page.getByLabel('Message to the agents').fill(WORDS);
    await expect(send).toBeEnabled();
    await shot(page, 'signal-reply');
    await send.click();
    await expect(page.getByTestId('signal-reply')).toContainText(`“${WORDS}”`);
    await expect(page.getByTestId('signal-reply')).toContainText('You, from your phone');
    await expect(page.getByTestId('signal-reply')).toContainText('Not read yet: each agent in this work reads it on its next step');
    expect((await calls(page)).find((c) => c.method === 'awareness.reply')?.params).toEqual({ id: 'k1', message: WORDS });
  });

  test('an overlap that has resolved says so, rather than showing an error alone', async ({ page }) => {
    await openScreen(page, 'signal-detail', { rpc: { 'awareness.signal': { __error: 'No such open signal in this project' } } }, { id: 'gone' });
    await expect(page.getByText('No such open signal in this project')).toBeVisible();
    await expect(page.getByText(/It may have resolved/)).toBeVisible();
  });
});

test.describe('Lines of work', () => {
  const LIST = {
    projectRoot: '/work/acme',
    workstreams: [
      { id: '/work/acme-checkout', name: 'checkout-fix', branch: 'checkout-fix', shape: 'worktree', main: false,
        agents: [{ agentType: 'codex', model: 'gpt-5', source: 'mcp', lastSeen: now - 30_000 }],
        tasks: [{ uid: 'i1', title: 'Validate refunds', planUid: 'p1', status: 'in_progress' }], changedFiles: 3, signals: 1, needsYou: 1 },
      { id: '/work/acme-billing', name: 'billing-v2', branch: 'billing-v2', shape: 'shared', main: false,
        agents: [{ agentType: 'claude-code', model: null, source: 'mcp', lastSeen: now - 60_000 }, { agentType: 'claude-code', model: null, source: 'claude-log', lastSeen: null }],
        tasks: [], changedFiles: 1, signals: 2, needsYou: 0 },
    ],
  };
  test('each line with its agents, task and what it changed; one opens', async ({ page }) => {
    await openScreen(page, 'workstreams', { rpc: { 'workstreams.list': LIST } });
    await expect(page.getByTestId('workstream')).toHaveCount(2);
    await expect(page.getByTestId('workstream').first()).toContainText('▸ Validate refunds');
    await expect(page.getByTestId('workstream').first()).toContainText('⚠ 1');
    await expect(page.getByTestId('workstream').nth(1)).toContainText('Shared folder · 1 file changed · 2 overlaps');
    // The same agent over MCP and in its own log is named once.
    await expect(page.getByTestId('workstream').nth(1)).not.toContainText('claude-code, claude-code');
    await shot(page, 'workstreams');
    await page.getByTestId('workstream').first().click();
    expect(await navigations(page)).toEqual([{ action: 'push', to: '/workstream-detail?id=%2Fwork%2Facme-checkout' }]);
  });

  test('tasks worked through their brief (A6.1) follow the lines of work', async ({ page }) => {
    await openScreen(page, 'workstreams', {
      rpc: {
        'workstreams.list': {
          ...LIST,
          tasks: [
            { id: 'task:i7', itemUid: 'i7', name: 'Task · Q3 summary', planUid: 'p2', planTitle: 'Quarter close', status: 'in_progress',
              agents: [{ agentType: 'claude-desktop', model: null, lastSeen: now - 20_000 }], materials: 2, outputs: 1, signals: 1, needsYou: 1 },
            { id: 'task:i8', itemUid: 'i8', name: 'Task · Board pack', planUid: 'p2', planTitle: 'Quarter close', status: 'pending',
              agents: [{ agentType: 'claude-desktop', model: null, lastSeen: now - 90_000 }], materials: 1, outputs: 0, signals: 0, needsYou: 0 },
          ],
        },
      },
    });
    await expect(page.getByTestId('task-workstream')).toHaveCount(2);
    await expect(page.getByTestId('task-workstream').first()).toContainText('Task · Q3 summary');
    await expect(page.getByTestId('task-workstream').first()).toContainText('Quarter close · 2 materials · 1 output · 1 overlap');
    await expect(page.getByTestId('task-workstream').first()).toContainText('⚠ 1');
    await expect(page.getByTestId('task-workstream').nth(1)).toContainText('claude-desktop');
    await page.getByTestId('task-workstreams').scrollIntoViewIfNeeded();
    await shot(page, 'workstreams-tasks');
  });

  test('one line: its files with line counts and its turns in the Timeline\'s words', async ({ page }) => {
    await openScreen(page, 'workstream-detail', {
      rpc: {
        'workstreams.detail': {
          workstream: {
            ...LIST.workstreams[0], truncated: false, ahead: 4, behind: 1,
            files: [
              { path: 'src/checkout/submit.ts', status: 'modified', added: 12, removed: 3 },
              { path: 'src/checkout/refund.ts', status: 'added', added: 48, removed: 0 },
              { path: 'src/checkout/old.ts', status: 'deleted' },
            ],
            turns: [
              { sessionId: 's1', agentType: 'codex', startedAt: now - 6 * MIN, endedAt: now - 5 * MIN, summary: 'Edited src/checkout/submit.ts (+1 more) · 7 calls', calls: 7, files: ['submit.ts'], hasError: false, mutating: true },
              { sessionId: 's1', agentType: 'codex', startedAt: now - 30 * MIN, endedAt: now - 28 * MIN, summary: 'Claimed “Validate refunds”', calls: 2, files: [], hasError: false, mutating: true },
            ],
          },
        },
      },
    }, { id: '/work/acme-checkout' });
    await expect(page.getByTestId('workstream-file')).toHaveCount(3);
    await expect(page.getByTestId('workstream-file').first()).toContainText('+12 −3');
    await expect(page.getByTestId('workstream-turn')).toHaveCount(2);
    await expect(page.getByTestId('workstream-turn').first()).toContainText('Edited src/checkout/submit.ts (+1 more) · 7 calls');
    await expect(page.getByText(/4 ahead of main, 1 behind/)).toBeVisible();
    await shot(page, 'workstream-detail');
  });
});

test('the push tap opens the overlap it is about (A4.4)', async ({ page }) => {
  await openScreen(page, 'home', { rpc: { 'breakpoint.waiting': { hits: [] }, 'criteria.awaiting': { entries: [] } } });
  const pushModule = `/@fs${path.resolve('mobile/lib/push.ts')}`;
  const routes = await page.evaluate(async (m) => {
    const { routeForNotification } = await import(/* @vite-ignore */ m) as { routeForNotification: (d: Record<string, string>) => string | null };
    return [
      routeForNotification({ type: 'signal', id: 'k1' }),
      routeForNotification({ type: 'signal' }),
      routeForNotification({ type: 'breakpoint', ref: 'bp-1' }),
    ];
  }, pushModule);
  expect(routes).toEqual(['/signal-detail?id=k1', null, '/breakpoints']);
});
