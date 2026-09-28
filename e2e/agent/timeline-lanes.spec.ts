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
import type { AgentEvent, AwarenessSignal, Workstream, WorkstreamAgent } from '../../src/shared/types';

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

async function serve(page: Page) {
  await page.route('**/api/workstreams?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROOM) }));
  await page.route('**/api/awareness?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signals: SIGNALS }) }));
  await page.route('**/api/agent-events?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: HISTORY }) }));
}

test.describe('Timeline lanes', () => {
  test('a lane per workstream, each turn on its own, the overlap on both, and a click opens the turn', async ({ page }) => {
    await serve(page);
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();

    const lanes = page.getByTestId('timeline-lanes');
    await expect(lanes).toBeVisible({ timeout: 10_000 });
    await expect(lanes.getByTestId('timeline-lane')).toHaveText([/main/, /auth-refresh/, /billing-v2/, /No workstream/]);

    const lane = (label: string) => lanes.locator(`[data-testid="timeline-lane"][data-lane="${label}"]`);
    const kinds = async (label: string) => lane(label).getByTestId('timeline-mark').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    await expect.poll(() => kinds('auth-refresh')).toEqual(['turn', 'signal']);
    // In time order: its first turn, the overlap (9 min ago), then the failed call.
    await expect.poll(() => kinds('billing-v2')).toEqual(['turn', 'signal', 'turn']);
    expect(await kinds('main')).toEqual([]);
    expect(await kinds('No workstream')).toEqual(['edit']);

    // Words, not only glyphs and colour: the hover says what each is.
    await expect(lane('billing-v2').locator('[data-kind="turn"]').nth(1)).toHaveAttribute('title', /turn \(failed\) · claude-code: Get app guide failed/);
    await expect(lane('auth-refresh').locator('[data-kind="signal"]')).toHaveAttribute('title', /high signal · `auth-refresh` and `billing-v2` both change/);
    await expect(lane('No workstream').locator('[data-kind="edit"]')).toHaveAttribute('title', /edit · human: Edited the spec “Token rotation” \(v2\)/);

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
});
