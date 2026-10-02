/**
 * Phase 32 B10.5 — the G2 journey in the window: months later, a reviewer
 * replays the week a payment change was built.
 *
 * They choose the day the week began; the bar says which days it covers,
 * and every moment in it by date, because none of it is today. The moment
 * shows what was waiting then. The week's evidence exports from the bar
 * and verifies. The recorded moments are served here, from a March week, as
 * the replay spec serves its hour; the evidence is the real backend's.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import type { BreakpointHit } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const YEAR = new Date().getFullYear();
const march = (d: number, h: number, m: number) => new Date(YEAR, 2, d, h, m).getTime();
const now = Date.now();

const frame = (id: number, at: number, reasons: string[], agentType: string | null) => ({
  id, at, reasons, ref: null, sessionId: agentType ? `s-${id}` : null, agentType, workstreamRoot: null,
  commitSha: null, branch: 'main', sameAs: null, fileCount: 3, edgeCount: 2,
});
const FRAMES = [
  frame(21, march(2, 9, 14), ['status'], null),
  frame(22, march(4, 16, 2), ['turn-end'], 'codex'),
  frame(23, march(6, 17, 40), ['status'], null),
];
const HELD: BreakpointHit = {
  ref: 'bp-held', breakpointId: 'bp_1', kind: 'task', breakpointNote: 'Payments: ask me first', breakpointTarget: 'i1',
  tool: 'claim_item', action: 'claim', itemUid: 'i1', itemTitle: 'Round refunds half-even', path: null, breach: false, signalId: null,
  planUid: 'p-1', agent: 'codex', sessionId: 's-22', workstreamRoot: null, hitAt: march(4, 15, 58),
  decision: 'continue', note: null, answeredAt: march(4, 16, 30), answeredBy: 'Sam', answeredByType: 'human',
};

async function serve(page: Page, asked: string[]) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/replay/frames?*', (r) => {
    asked.push(r.request().url());
    return r.fulfill(json({ frames: FRAMES }));
  });
  await page.route('**/api/replay/state?*', (r) => {
    const at = Number(new URL(r.request().url()).searchParams.get('at'));
    const f = [...FRAMES].reverse().find((x) => x.at <= at) ?? null;
    return r.fulfill(json({ at, projectPath: '/work/acme', frame: f, sinceFrame: null, tasks: [], signals: [], waiting: f?.id === 22 ? [HELD] : [] }));
  });
  await page.route(/\/api\/trellis\/2[123]$/, (r) => r.fulfill(json({
    id: 21, data: { files: [{ path: 'src/payments/refund.ts' }, { path: 'src/shared/money.ts' }], edges: [{ source: 'src/payments/refund.ts', target: 'src/shared/money.ts', specifiers: ['round'] }] },
  })));
}

test.describe('Replay a week', () => {
  test('months later: choose the day, replay that week by date, see what waited, export its evidence', async ({ page }, testInfo) => {
    test.skip(new Date(YEAR, 2, 9).getTime() > now, 'needs a March week behind today');
    const asked: string[] = [];
    await serve(page, asked);
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();

    await page.getByTestId('replay-week-day').fill(`${YEAR}-03-02`);
    const go = page.getByTestId('replay-week');
    await expect(go).toHaveText('Replay 2 Mar – 8 Mar');
    fs.mkdirSync(OUT, { recursive: true });
    await page.getByTestId('replay-starts').screenshot({ path: path.join(OUT, 'replay-week-start.png') });
    await go.click();

    // The frames asked for are that week's, not the last two hours'.
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    const url = new URL(asked[0]);
    expect(Number(url.searchParams.get('from'))).toBe(new Date(YEAR, 2, 2).getTime());
    expect(Number(url.searchParams.get('to'))).toBe(new Date(YEAR, 2, 9).getTime() - 1);

    const bar = page.getByTestId('replay-bar');
    await expect(page.getByTestId('replay-range')).toHaveText('Replaying 2 Mar 09:14 → 6 Mar 17:40 · at 2 Mar 09:14');
    await bar.getByTitle('Next frame').click();
    await expect(page.getByTestId('replay-range')).toHaveText('Replaying 2 Mar 09:14 → 6 Mar 17:40 · at 4 Mar 16:02');
    await expect(page.getByTestId('replay-moment')).toContainText('1 waiting on you');

    // That week's evidence, from the bar: named for the week, and it verifies.
    const [download] = await Promise.all([page.waitForEvent('download'), bar.getByTestId('evidence-export').click()]);
    expect(download.suggestedFilename()).toBe(`evidence-week-from-${YEAR}-03-02.html`);
    const saved = testInfo.outputPath('week.html');
    await download.saveAs(saved);
    expect(fs.readFileSync(saved, 'utf-8')).toContain('<h1>Evidence</h1>');
    await bar.getByTestId('evidence-verify-input').setInputFiles(saved);
    await expect(bar.getByTestId('evidence-verification')).toHaveAttribute('data-ok', 'true');
    await expect(bar.getByTestId('evidence-verification')).toHaveText(/^✓ This evidence holds: [a-z]/);

    await bar.screenshot({ path: path.join(OUT, 'replay-week.png') });
  });
});
