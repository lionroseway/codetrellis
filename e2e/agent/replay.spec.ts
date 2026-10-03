/**
 * Replay: one clock for the window (Phase 32 B5.3), journey G1.
 *
 * Sam was away for an hour. From the Timeline tab they replay it: the bar
 * says which moments and between which two times; stepping to the next
 * moment moves the inbox to what was open and waiting then (read-only, with
 * how the held call was answered later), the canvas says it shows the graph
 * as it was, and "Back to live" returns everything to now.
 *
 * The recorded moments are served here (the frames and states are B5.1 and
 * B5.2's, harness-tested against a real backend), so the screen is tested on
 * a known hour rather than on whatever this repository's agents did.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import type { AwarenessSignal, BreakpointHit, Workstream } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const MIN = 60_000;
const now = Date.now();

const ROOM: Workstream[] = [
  { root: '/work/acme-auth', branch: 'auth-refresh', head: '3f9c2e1a7b', main: false, shape: 'worktree', idle: false,
    agents: [{ sessionId: 's-auth', agentType: 'codex', model: null, source: 'mcp', lastSeen: now - 12 * MIN }],
    changes: { base: '9a8b7c6d5e', files: [], truncated: false } },
  { root: '/work/acme-billing', branch: 'billing-v2', head: '4a1b2c3d4e', main: false, shape: 'worktree', idle: false,
    agents: [{ sessionId: 's-bill', agentType: 'claude-code', model: null, source: 'mcp', lastSeen: now - 12 * MIN }],
    changes: { base: '9a8b7c6d5e', files: [], truncated: false } },
];

const frame = (id: number, at: number, reasons: string[], agentType: string | null, commitSha: string | null = null) => ({
  id, at, reasons, ref: null, sessionId: agentType ? `s-${id}` : null, agentType, workstreamRoot: null,
  commitSha, branch: 'main', sameAs: null, fileCount: 3, edgeCount: 2,
});
const FRAMES = [
  frame(11, now - 50 * MIN, ['turn-end'], 'codex'),
  frame(12, now - 30 * MIN, ['status'], null),
  frame(13, now - 10 * MIN, ['commit'], null, 'c0ffee1234'.padEnd(40, '0')),
];

const COLLISION = {
  id: 'c1', kind: 'collision' as AwarenessSignal['kind'], severity: 'high' as AwarenessSignal['severity'],
  subject: { file: 'src/auth/session.ts', symbol: 'refreshToken' }, workstreams: ['/work/acme-auth', '/work/acme-billing'],
  summary: '`auth-refresh` and `billing-v2` both change src/auth/session.ts → refreshToken',
  openedAt: now - 35 * MIN, closedAt: now - 15 * MIN,
};
const HELD: BreakpointHit = {
  ref: 'bp-held', breakpointId: 'bp_1', kind: 'task', breakpointNote: 'Ask me before touching payments', breakpointTarget: 'i1',
  tool: 'claim_item', action: 'claim', itemUid: 'i1', itemTitle: 'Partial refunds', path: null, breach: false, signalId: null,
  planUid: 'p-1', agent: 'codex', sessionId: 's-auth', workstreamRoot: '/work/acme-auth', hitAt: now - 33 * MIN,
  decision: 'steer', note: "Don't change the refund path", answeredAt: now - 20 * MIN, answeredBy: 'Sam', answeredByType: 'human',
};

function stateAt(at: number) {
  const f = [...FRAMES].reverse().find((x) => x.at <= at) ?? null;
  const middle = at >= FRAMES[1].at && at < FRAMES[2].at;
  return {
    at, projectPath: '/work/acme', frame: f, sinceFrame: null, tasks: [],
    signals: middle ? [COLLISION] : [],
    waiting: middle ? [HELD] : [],
  };
}

async function serve(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/workstreams?*', (r) => r.fulfill(json(ROOM)));
  await page.route('**/api/awareness?*', (r) => r.fulfill(json({ signals: [] })));
  await page.route('**/api/replay/frames?*', (r) => r.fulfill(json({ frames: FRAMES })));
  await page.route('**/api/replay/state?*', (r) => {
    const at = Number(new URL(r.request().url()).searchParams.get('at'));
    return r.fulfill(json(stateAt(at)));
  });
  await page.route(/\/api\/trellis\/1[123]$/, (r) => r.fulfill(json({
    id: 11, data: {
      files: [{ path: 'src/auth/session.ts' }, { path: 'src/billing/charge.ts' }, { path: 'src/shared/money.ts' }],
      edges: [
        { source: 'src/auth/session.ts', target: 'src/shared/money.ts', specifiers: ['format'] },
        { source: 'src/billing/charge.ts', target: 'src/shared/money.ts', specifiers: ['format'] },
      ],
    },
  })));
}

test.describe('Replay', () => {
  test('replay an hour: step to a moment, see the inbox as it was, go back to live', async ({ page }) => {
    await serve(page);
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();

    await page.getByTestId('replay-start').click();
    const bar = page.getByTestId('replay-bar');
    await expect(bar).toBeVisible();
    // Times alone on the day itself; a time on another day carries its date
    // ("2 Oct 23:30"), which an hour's replay just after midnight does.
    const t = String.raw`(?:\d{1,2} [A-Z][a-z]{2} )?\d\d:\d\d`;
    await expect(page.getByTestId('replay-range')).toHaveText(new RegExp(`^Replaying ${t} → ${t} · at ${t}$`));
    await expect(page.getByTestId('replay-moment')).toHaveText("Codex's turn ended · no signals open · nothing waiting on you");
    // The canvas says it is the graph as it was, not now.
    await expect(page.getByTestId('replay-canvas')).toContainText(/As it was at \d\d:\d\d · 3 files · replaying/);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'replay-start.png') });

    // The next moment: a collision was open and codex's claim was held.
    await bar.getByTitle('Next frame').click();
    await expect(page.getByTestId('replay-moment')).toHaveText('A task changed status · 1 signal open · 1 waiting on you');

    await page.getByRole('button', { name: /^Awareness( \d+)?$/ }).click();
    const held = page.locator('[data-testid="breakpoint-waiting"][data-ref="bp-held"]');
    await expect(held).toBeVisible();
    // Read-only: how it was answered later, and no buttons to answer it again.
    await expect(held.getByTestId('breakpoint-replayed')).toHaveText(/^Answered later, at \d\d:\d\d: .+, “Don't change the refund path”\.$/);
    await expect(held.getByRole('button')).toHaveCount(0);
    await expect(held.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByTestId('awareness-tab')).toContainText('refreshToken');
    await page.screenshot({ path: path.join(OUT, 'replay-inbox.png') });

    // The last moment: the collision had closed and the call was answered.
    await bar.getByTitle('Next frame').click();
    await expect(page.getByTestId('replay-moment')).toHaveText(/^A commit landed \(c0ffee1\) · no signals open · nothing waiting on you$/);
    await expect(held).toHaveCount(0);

    // Back to live: the bar and the canvas note go; the inbox is now's again.
    await page.getByTestId('replay-live').click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('replay-canvas')).toHaveCount(0);
    await expect(page.getByTestId('replay-start')).toHaveCount(0); // it lives on the Timeline tab
  });

  test('catch-up (B5.4): back after an hour, the inbox offers to play it at 4×, and it plays to now', async ({ page }) => {
    await serve(page);
    // Sam last looked at the inbox an hour ago.
    await page.addInitScript((at: number) => {
      window.localStorage.setItem('codetrellis.awareness.lastViewed', String(at));
    }, now - 60 * MIN);
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Awareness( \d+)?$/ }).click();

    const catchUp = page.getByTestId('catch-up');
    await expect(catchUp).toHaveText(/^Watch what happened since \d\d:\d\d at 4×$/);
    await page.screenshot({ path: path.join(OUT, 'replay-catch-up.png') });
    await catchUp.click();

    // It plays on its own, at 4×, and stops at the last moment.
    await expect(page.getByTestId('replay-bar')).toBeVisible();
    await expect(page.getByTestId('replay-moment')).toHaveText(/^A commit landed \(c0ffee1\)/, { timeout: 10_000 });
    await expect(page.getByTestId('replay-bar').getByTitle('Playback speed')).toHaveText(/4×/);
    // The canvas's views wait while replaying.
    await expect(page.getByRole('button', { name: 'Live', exact: true }).first()).toBeDisabled();
    await page.getByTestId('replay-live').click();
    await expect(page.getByRole('button', { name: 'Live', exact: true }).first()).toBeEnabled();
  });

  test('nothing recorded yet: the bar says what makes a moment', async ({ page }) => {
    await serve(page);
    await page.route('**/api/replay/frames?*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ frames: [] }) }));
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();
    await page.getByTestId('replay-start').click();
    await expect(page.getByTestId('replay-range')).toHaveText('Replay: nothing recorded yet');
    await expect(page.getByTestId('replay-empty')).toContainText("A moment is kept when an agent's turn ends, a task changes status or a commit lands.");
    await page.getByTestId('replay-live').click();
    await expect(page.getByTestId('replay-bar')).toHaveCount(0);
  });
});
