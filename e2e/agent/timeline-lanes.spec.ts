/**
 * Timeline lanes (Phase 32 B2.1): parallel work reads as parallel.
 *
 * The app is given a fixed room (three worktrees, their agents, an overlap)
 * and a fixed history of agent events, so each lane and mark it draws is
 * checked and photographed: a lane per workstream, a mark per turn in the
 * lane it belongs to, ✎ for a spec edit, ⚠ for the overlap on both lanes,
 * and a click on a mark opening that turn below.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import type { AgentEvent, AwarenessSignal, BreakpointHit, Workstream, WorkstreamAgent, WorkstreamCommit } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const now = Date.now();
const MIN = 60_000;

const agent = (sessionId: string, agentType: string): WorkstreamAgent => ({ sessionId, agentType, model: null, source: 'mcp', lastSeen: now - 12_000 });
const ws = (root: string, branch: string, main: boolean, agents: WorkstreamAgent[]): Workstream => ({
  root, branch, head: '3f9c2e1a7b', main, shape: 'worktree', agents,
  changes: { base: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b', files: [], truncated: false }, idle: false,
});

const ROOM: Workstream[] = [
  ws('/work/acme', 'main', true, []),
  ws('/work/acme-auth', 'auth-refresh', false, [agent('s-auth', 'codex')]),
  ws('/work/acme-billing', 'billing-v2', false, [agent('s-bill', 'claude-code')]),
];

const SIGNALS: AwarenessSignal[] = [{
  id: 'c1', kind: 'collision', severity: 'high', subject: { file: 'src/auth/session.ts', symbol: 'refreshToken' },
  workstreams: ['/work/acme-auth', '/work/acme-billing'],
  summary: '`auth-refresh` and `billing-v2` both change src/auth/session.ts → refreshToken',
  firstSeen: now - 9 * MIN, lastSeen: now - MIN, state: 'open',
}];

let n = 0;
const event = (at: number, type: AgentEvent['type'], payload: Record<string, unknown>, extra: Record<string, unknown> = {}): AgentEvent =>
  ({ id: `hist-${n++}`, timestamp: at, source: type === 'spec_edited' ? 'app' : 'mcp', type, payload, ...extra } as AgentEvent);

const HISTORY: AgentEvent[] = [
  // auth-refresh's agent, named by its stored row.
  event(now - 20 * MIN, 'tool_call', { tool: 'search_symbols', args: '{"query":"refreshToken"}', sessionId: 's-auth', agentType: 'codex' }, { workstreamRoot: '/work/acme-auth' }),
  // billing-v2's agent, placed by its session.
  event(now - 12 * MIN, 'tool_call', { tool: 'list_plans', args: '{}', sessionId: 's-bill', agentType: 'claude-code' }),
  event(now - 6 * MIN, 'tool_error', { tool: 'get_app_guide', args: '{"flavor":"x"}', error: 'Invalid arguments', sessionId: 's-bill', agentType: 'claude-code' }),
  // A spec edited from the app: no workstream.
  event(now - 3 * MIN, 'spec_edited', { kind: 'document', title: 'Token rotation', version: 2, authorType: 'human', agentType: 'human' }),
];

const sha = (c: string) => c.repeat(40);
const commit = (at: number, c: string, subject: string, extra: Partial<WorkstreamCommit> = {}): WorkstreamCommit =>
  ({ sha: sha(c), at, author: 'Sam', subject, merge: false, agent: null, ...extra });

// B2.2: each lane's own commits, a merge among them.
const COMMITS: Record<string, WorkstreamCommit[]> = {
  '/work/acme': [commit(now - 25 * MIN, 'a', 'Bump deps')],
  '/work/acme-auth': [
    commit(now - 17 * MIN, 'b', 'Tighten email check', { agent: 'codex' }),
    commit(now - 5 * MIN, 'c', 'Merge auth-side', { merge: true }),
  ],
  // A lane that is not a workstream never appears for its commits alone.
  '/work/elsewhere': [commit(now - 4 * MIN, 'd', 'Unrelated')],
};

// B2.2: a person deciding auth-refresh's criteria, and a check run on billing-v2.
const CHECKS: AgentEvent[] = [
  event(now - 15 * MIN, 'criterion_decided',
    { criterionUid: 'cr-1', decision: 'approved', text: 'Old tokens are refused', itemTitle: 'Rotate refresh tokens', agentType: 'human', actorType: 'human', workstreamRoot: '/work/acme-auth' },
    { source: 'app' }),
  event(now - 8 * MIN, 'criterion_decided',
    { criterionUid: 'cr-2', decision: 'sent_back', text: 'Rotation is logged', itemTitle: 'Rotate refresh tokens', agentType: 'human', actorType: 'human', workstreamRoot: '/work/acme-auth' },
    { source: 'app' }),
  event(now - 7 * MIN, 'check_run',
    { planUid: 'p-1', trigger: 'manual', passed: 3, failed: 0, failing: [], agentType: 'human', workstreamRoot: '/work/acme-billing' },
    { source: 'app' }),
];

// B4.3b: calls held at breakpoints. codex on auth-refresh was paused and
// steered; Claude Code on billing-v2 waits now; a breach on billing-v2.
const hit = (over: Partial<BreakpointHit>): BreakpointHit => ({
  ref: 'bp-x', breakpointId: 'bp_1', kind: 'task', breakpointNote: null, breakpointTarget: 'i1', tool: 'claim_item', action: 'claim',
  itemUid: 'i1', itemTitle: 'Rotate refresh tokens', path: null, breach: false, signalId: null, planUid: 'p-1',
  agent: 'codex', sessionId: 's-auth', workstreamRoot: '/work/acme-auth', hitAt: now - 18 * MIN, decision: null, note: null,
  answeredAt: null, answeredBy: null, answeredByType: null, ...over,
});
const HITS: BreakpointHit[] = [
  hit({ ref: 'bp-steered', decision: 'steer', note: 'Keep the old cookie name', answeredAt: now - 13 * MIN, answeredBy: 'Sam', answeredByType: 'human' }),
  hit({ ref: 'bp-waiting', kind: 'code', breakpointTarget: 'src/billing/charge.ts#settle', tool: 'check_breakpoint', action: 'edit_code', path: 'src/billing/charge.ts',
    agent: 'claude-code-hook', sessionId: 's-bill', workstreamRoot: '/work/acme-billing', hitAt: now - 8 * MIN }),
  hit({ ref: 'bp-breach', kind: 'code', breakpointTarget: 'src/billing/refund.ts', tool: 'list_plans', action: 'breach', breach: true, path: 'src/billing/refund.ts',
    agent: 'codex', sessionId: 's-other', workstreamRoot: '/work/acme-billing', hitAt: now - 4 * MIN }),
];

async function serve(page: Page, history: AgentEvent[] = HISTORY, commits: Record<string, WorkstreamCommit[]> = {}) {
  await page.route('**/api/workstreams?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROOM) }));
  await page.route('**/api/workstreams/commits?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ since: now - 120 * MIN, commits }) }));
  await page.route('**/api/awareness?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signals: SIGNALS }) }));
  await page.route('**/api/agent-events?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: history }) }));
}

test.describe('Timeline lanes', () => {
  test('a lane per workstream, each turn on its own, the overlap on both, and a click opens the turn', async ({ page }) => {
    await serve(page);
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();

    const lanes = page.getByTestId('timeline-lanes');
    await expect(lanes).toBeVisible({ timeout: 10_000 });
    // Main first, the workstreams by name, work outside any last. Other specs
    // share the backend, so their live agents may add a lane or a mark of
    // their own; only this room's lanes and marks are checked.
    const labels = () => lanes.getByTestId('timeline-lane').evaluateAll((els) => els.map((e) => e.getAttribute('data-lane')));
    await expect.poll(async () => (await labels()).filter((l) => ['main', 'auth-refresh', 'billing-v2', 'No workstream'].includes(l ?? '')))
      .toEqual(['main', 'auth-refresh', 'billing-v2', 'No workstream']);
    expect((await labels()).at(-1)).toBe('No workstream');

    const lane = (label: string) => lanes.locator(`[data-testid="timeline-lane"][data-lane="${label}"]`);
    const kinds = async (label: string) => lane(label).getByTestId('timeline-mark').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    await expect.poll(() => kinds('auth-refresh')).toEqual(['turn', 'signal']);
    // In time order: its first turn, the overlap (9 min ago), then the failed call.
    await expect.poll(() => kinds('billing-v2')).toEqual(['turn', 'signal', 'turn']);
    expect(await kinds('main')).toEqual([]);
    expect(await kinds('No workstream')).toContain('edit');

    // Words, not only glyphs and colour: the hover says what each is.
    await expect(lane('billing-v2').locator('[data-kind="turn"]').nth(1)).toHaveAttribute('title', /turn \(failed\) · claude-code: Get app guide failed/);
    await expect(lane('auth-refresh').locator('[data-kind="signal"]')).toHaveAttribute('title', /high signal · `auth-refresh` and `billing-v2` both change/);
    // "No workstream" collects other specs' live edits too, so pick this room's by its spec.
    await expect(lane('No workstream').locator('[data-kind="edit"][title*="Token rotation"]'))
      .toHaveAttribute('title', /edit · human: Edited the spec “Token rotation” \(v2\)/);

    fs.mkdirSync(OUT, { recursive: true });
    await page.getByTestId('timeline-lanes').screenshot({ path: path.join(OUT, 'timeline-lanes.png') });

    // Clicking auth-refresh's turn opens it in the list below.
    await lane('auth-refresh').locator('[data-kind="turn"]').click();
    const card = page.locator('[data-testid="turn-card"]', { hasText: 'Looked for `refreshToken`' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Looked for `refreshToken`').nth(1)).toBeVisible();

    // Clicking the overlap goes to the Awareness tab.
    await lane('billing-v2').locator('[data-kind="signal"]').click();
    await expect(page.getByTestId('awareness-needs-you')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, 'timeline-lanes-panel.png') });
  });

  test('B2.2: ◉ each lane\'s commits, ⧫ a merge, ✓ / ✗ criteria decided and checked on the lane of the work', async ({ page }) => {
    await serve(page, CHECKS, COMMITS);
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();

    const lanes = page.getByTestId('timeline-lanes');
    await expect(lanes).toBeVisible({ timeout: 10_000 });
    const lane = (label: string) => lanes.locator(`[data-testid="timeline-lane"][data-lane="${label}"]`);
    // The workstreams in order. Commits add no lane: /work/elsewhere is not a
    // workstream here. (Other specs share the backend, so their live events
    // may add a "No workstream" lane below; it is not this test's.)
    await expect(lanes.getByTestId('timeline-lane').first()).toHaveAttribute('data-lane', 'main');
    await expect(lanes.getByTestId('timeline-lane').nth(1)).toHaveAttribute('data-lane', 'auth-refresh');
    await expect(lanes.getByTestId('timeline-lane').nth(2)).toHaveAttribute('data-lane', 'billing-v2');
    await expect(lane('elsewhere')).toHaveCount(0);
    const kinds = async (label: string) => lane(label).getByTestId('timeline-mark').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    await expect.poll(() => kinds('main')).toEqual(['commit']);
    // In time order: a commit, the approval, the overlap, the send-back, the merge.
    await expect.poll(() => kinds('auth-refresh')).toEqual(['commit', 'check-pass', 'signal', 'check-fail', 'merge']);
    await expect.poll(() => kinds('billing-v2')).toEqual(['signal', 'check-pass']);

    // Words beside glyphs: the hover names each, and a commit its agent and short sha.
    await expect(lane('auth-refresh').locator('[data-kind="commit"]')).toHaveAttribute('title', /commit · codex: Tighten email check \(bbbbbbb\)/);
    await expect(lane('auth-refresh').locator('[data-kind="merge"]')).toHaveAttribute('title', /merge · Sam: Merge auth-side \(ccccccc\)/);
    await expect(lane('auth-refresh').locator('[data-kind="check-pass"]')).toHaveAttribute('title', /checks passed · human: You approved “Old tokens are refused”/);
    await expect(lane('auth-refresh').locator('[data-kind="check-fail"]')).toHaveAttribute('title', /checks failed · human: You sent back “Rotation is logged”/);
    await expect(lane('billing-v2').locator('[data-kind="check-pass"]')).toHaveAttribute('title', /checks passed · human: Checked criteria: all 3 passing/);
    await expect(lane('auth-refresh').locator('[data-kind="check-fail"]')).toHaveText('✗');
    await expect(lane('auth-refresh').locator('[data-kind="merge"]')).toHaveText('⧫');

    fs.mkdirSync(OUT, { recursive: true });
    await lanes.screenshot({ path: path.join(OUT, 'timeline-lanes-marks.png') });

    // A decision opens as its turn below; a commit opens nothing.
    await lane('auth-refresh').locator('[data-kind="check-fail"]').click();
    await expect(page.locator('[data-testid="turn-card"]', { hasText: 'You sent back “Rotation is logged”' })).toBeVisible();
  });

  test('B4.3b: ⏸ a held call spans to its answer, dashed while it waits; ⊘ a breach is its own mark', async ({ page }) => {
    await serve(page, CHECKS);
    await page.route((url) => url.pathname === '/api/breakpoint-hits' && url.searchParams.get('state') === 'all',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: HITS }) }));
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();

    const lanes = page.getByTestId('timeline-lanes');
    await expect(lanes).toBeVisible({ timeout: 10_000 });
    const lane = (label: string) => lanes.locator(`[data-testid="timeline-lane"][data-lane="${label}"]`);
    const kinds = async (label: string) => lane(label).getByTestId('timeline-mark').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    await expect.poll(() => kinds('auth-refresh')).toEqual(['pause', 'check-pass', 'signal', 'check-fail']);
    await expect.poll(() => kinds('billing-v2')).toEqual(['signal', 'pause', 'check-pass', 'breach']);

    // Words, not only glyphs: who wanted what, and what became of it.
    await expect(lane('auth-refresh').locator('[data-kind="pause"]')).toHaveAttribute('title', /paused at a breakpoint · codex wants to claim “Rotate refresh tokens”; continued with a steer by Sam/);
    await expect(lane('billing-v2').locator('[data-kind="pause"]')).toHaveAttribute('title', /paused at a breakpoint · Claude Code wants to change “settle in src\/billing\/charge.ts”; waiting on you/);
    await expect(lane('billing-v2').locator('[data-kind="breach"]')).toHaveAttribute('title', /breach · codex changed src\/billing\/refund.ts past a breakpoint; waiting on you/);
    await expect(lane('billing-v2').locator('[data-kind="pause"]')).toHaveText('⏸\uFE0E');
    await expect(lane('billing-v2').locator('[data-kind="breach"]')).toHaveText('⊘');

    // The answered pause is a solid span; the waiting one is dashed and runs to now.
    await expect(lane('auth-refresh').getByTestId('timeline-pause-span')).toHaveAttribute('data-waiting', 'false');
    await expect(lane('billing-v2').getByTestId('timeline-pause-span')).toHaveAttribute('data-waiting', 'true');

    fs.mkdirSync(OUT, { recursive: true });
    await lanes.screenshot({ path: path.join(OUT, 'timeline-lanes-breakpoints.png') });

    // A pause opens Awareness, where it is answered.
    await lane('billing-v2').locator('[data-kind="pause"]').click();
    await expect(page.getByTestId('awareness-needs-you')).toBeVisible();
  });
});
