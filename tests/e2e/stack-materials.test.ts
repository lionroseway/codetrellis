/**
 * Phase 32 HD3 — business clashes in the Stack, end to end.
 *
 * Dana leads a finance team. The Q3 board pack and the forecast refresh are
 * two plans, each with a Claude Desktop task working from the sales
 * workbook. The Stack tab says the two plans meet over it, as two code plans
 * touching one file would: declared at once (both briefs list it), and
 * actually once the workbook is replaced. Looking back to before the
 * replacement, each task says which version of the workbook it had read
 * then. The phone's stack is the same answer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type ScriptedAgent, type Phone } from '../harness';
import { makeWorkbook } from '../../src/backend/services/material-reader/fixtures.test-helper';
import type { Stack, StackOverlap, StackTask } from '../../src/shared/types/stack';

const BOOK = 'finance/sales-2026.xlsx';
const MATERIAL_KINDS = ['contract', 'collision', 'version-split', 'stale-base'];

test.describe.serial('Business clashes in the Stack', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let root: string;
  let phone: Phone;
  const plans: Record<string, string> = {};
  const tasks: Record<string, string> = {};
  const books: Record<string, string> = {};
  const agents: Record<string, ScriptedAgent> = {};
  const moments: Record<string, number> = {};
  let oldVersion: string | null = null;
  const WORK = [['board', 'Q3 board pack', 'Board figures'], ['forecast', 'Forecast refresh', 'Refresh the forecast']] as const;

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const post = async (url: string, body: unknown) => ((await (await raw('POST', url, body)).json()) as { uid: string }).uid;
  const stack = async () => (await (await raw('GET', `/api/stack?project=${encodeURIComponent(root)}`)).json()) as Stack;
  const stackAt = async (at: number) =>
    ((await (await raw('GET', `/api/replay/state?project=${encodeURIComponent(root)}&at=${at}`)).json()) as { stack: Stack }).stack;
  const overlapOf = (s: Stack, planUid: string): StackOverlap | undefined => s.plans.find((p) => p.uid === planUid)?.overlaps[0];
  const taskIn = (s: Stack, uid: string): StackTask | undefined => s.plans.flatMap((p) => p.tasks).find((t) => t.uid === uid);
  const workbook = (emea: number) => fs.writeFileSync(path.join(root, BOOK), makeWorkbook({ Summary: [['Region', 'Q3'], ['EMEA', emea], ['APAC', 80]] }));
  const mark = async (name: string) => {
    await new Promise((r) => setTimeout(r, 30));
    moments[name] = Date.now();
    await new Promise((r) => setTimeout(r, 30));
  };

  test.beforeAll(async () => {
    h = await setupHarness('stack-materials');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    fs.mkdirSync(path.join(root, 'finance'), { recursive: true });
    workbook(120);
    for (const [who, planTitle, taskTitle] of WORK) {
      plans[who] = (await h.client.createPlan({ title: planTitle, projectPath: root })).uid;
      tasks[who] = await post(`/api/plans/${plans[who]}/items`, { kind: 'action', title: taskTitle });
      const res = await raw('POST', `/api/items/${tasks[who]}/artefacts`, { path: BOOK, role: 'material' });
      expect(res.status).toBe(201);
      books[who] = ((await res.json()) as { uid: string }).uid;
    }
    phone = await pairPhone(h.client, { alias: 'Dana’s phone' });
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    await h?.teardown();
  });

  test('both briefs list the workbook: the plans meet, declared, by the file\'s name', async () => {
    const s = await stack();
    const fromBoard = overlapOf(s, plans.board)!;
    expect(fromBoard).toMatchObject({ withPlanUid: plans.forecast, words: '⚠ overlaps Forecast refresh', actual: [] });
    expect(fromBoard.declared.materials).toEqual([BOOK]);
    expect(fromBoard.detail).toBe('Both rely on sales-2026.xlsx.');
    expect(overlapOf(s, plans.forecast)!.words).toBe('⚠ overlaps Q3 board pack');
  });

  test('each session reads the workbook: each task says which version it read', async () => {
    for (const [who] of WORK) {
      agents[who] = await h.spawnAgent({ agentType: 'claude-desktop' });
      expect((await agents[who].callTool('get_brief', { item_uid: tasks[who] })).isError).toBeFalsy();
      const read = await agents[who].callTool('read_material', { attachment_uid: books[who], locator: { sheet: 'Summary' } });
      expect(read.isError, read.text).toBeFalsy();
    }
    const s = await stack();
    const [boardRead] = taskIn(s, tasks.board)!.reads;
    const [forecastRead] = taskIn(s, tasks.forecast)!.reads;
    expect(boardRead.path).toBe(BOOK);
    expect(boardRead.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(forecastRead.sha256).toBe(boardRead.sha256);
    expect(boardRead.words).toMatch(new RegExp(`^read sales-2026\\.xlsx on \\d+ \\w+ \\(version ${boardRead.sha256!.slice(0, 7)}\\)$`));
    oldVersion = boardRead.sha256;
    await mark('before');
  });

  test('the workbook is replaced and the board task reads the new one: the plans meet, actually', async () => {
    workbook(131);
    const read = await agents.board.callTool('read_material', { attachment_uid: books.board, locator: { sheet: 'Summary' } });
    expect(read.isError, read.text).toBeFalsy();
    let band: StackOverlap | undefined;
    await expect.poll(async () => (band = overlapOf(await stack(), plans.board))?.actual.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
    for (const sig of band!.actual) expect(MATERIAL_KINDS).toContain(sig.kind);
    expect(band!.detail).toMatch(/^Both rely on sales-2026\.xlsx\. Open now: /);
    const s = await stack();
    expect(taskIn(s, tasks.board)!.reads[0].sha256).not.toBe(oldVersion);
    expect(taskIn(s, tasks.forecast)!.reads[0].sha256).toBe(oldVersion);
    await mark('after');
  });

  test('looking back: before the replacement no signal was open, and both tasks had read the old version', async () => {
    const then = await stackAt(moments.before);
    const band = overlapOf(then, plans.board)!;
    expect(band.actual).toEqual([]);
    expect(band.declared.materials).toEqual([BOOK]);
    expect(taskIn(then, tasks.board)!.reads.map((r) => r.sha256)).toEqual([oldVersion]);
    expect(taskIn(then, tasks.forecast)!.reads.map((r) => r.sha256)).toEqual([oldVersion]);

    const later = await stackAt(moments.after);
    expect(overlapOf(later, plans.board)!.actual.length).toBeGreaterThan(0);
    expect(overlapOf(later, plans.board)!.detail).toMatch(/Open then: /);
    expect(taskIn(later, tasks.board)!.reads[0].sha256).not.toBe(oldVersion);
  });

  test('the phone\'s stack says the same', async () => {
    const onPhone = await phone.rpc<Stack>('stack.summary', { projectPath: root });
    const rest = await stack();
    for (const who of ['board', 'forecast'] as const) {
      const a = onPhone.plans.find((p) => p.uid === plans[who])!.overlaps;
      const b = rest.plans.find((p) => p.uid === plans[who])!.overlaps;
      expect(a.map((o) => [o.words, o.detail])).toEqual(b.map((o) => [o.words, o.detail]));
    }
  });
});
