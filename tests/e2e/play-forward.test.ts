/**
 * Phase 32 B9.1 — playing the plans forward (JOURNEYS G3, the data).
 *
 * Sam's project has three active plans and a finished one. JIRA-142 rounds
 * VAT in validators.ts; JIRA-150 adds a currency field to validators.ts and
 * creates currency.ts; the board pack and the forecast refresh both list
 * sales-2026.xlsx in their briefs. The finished plan also named
 * validators.ts, last month. Played forward: every active plan's planned
 * changes, validators.ts a planned overlap between JIRA-142 and JIRA-150,
 * the spreadsheet one between the two business plans, and nothing from the
 * finished plan. An agent asking gets the same answer. Once JIRA-150's task
 * waits on JIRA-142's, the overlap reads sequenced. A project never opened
 * is refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';
import type { PlayForward } from '../../src/shared/types/play-forward';

const VALIDATORS = 'packages/shared/src/validators.ts';
const CURRENCY = 'packages/shared/src/currency.ts';
const BOOK = 'data/sales-2026.xlsx';

test.describe.serial('Playing the plans forward', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  const tasks: Record<string, string> = {};

  const post = async (url: string, body: unknown) => (await h.client.raw('POST', url, body)).json() as Promise<{ uid: string }>;
  const forward = async () => (await (await h.client.raw('GET', `/api/play-forward?project=${encodeURIComponent(root)}`)).json()) as PlayForward;
  const plan = async (title: string, ticket?: string) => {
    const uid = (await h.client.createPlan({ title, projectPath: root })).uid;
    if (ticket) await agent.callTool('set_plan_external_ref', { plan_uid: uid, url: `https://example.atlassian.net/browse/${ticket}`, key: ticket });
    return uid;
  };

  test.beforeAll(async () => {
    h = await setupHarness('play-forward');
    root = h.fixture.projectPath;
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, BOOK), 'not really a workbook');
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });

    const vat = await plan('VAT rounding', 'JIRA-142');
    const currency = await plan('Currency', 'JIRA-150');
    const board = await plan('Q3 board pack');
    const forecast = await plan('Forecast refresh');
    const old = await plan('Last month');

    tasks.vat = (await post(`/api/plans/${vat}/items`, { kind: 'action', title: 'Round VAT per line', fileSpecs: [{ path: VALIDATORS, action: 'modify' }] })).uid;
    tasks.currency = (await post(`/api/plans/${currency}/items`, {
      kind: 'action', title: 'Add a currency field', fileSpecs: [{ path: VALIDATORS, action: 'modify' }, { path: CURRENCY, action: 'create' }],
    })).uid;
    tasks.board = (await post(`/api/plans/${board}/items`, { kind: 'action', title: 'Summarise Q3' })).uid;
    tasks.forecast = (await post(`/api/plans/${forecast}/items`, { kind: 'action', title: 'Refresh the forecast' })).uid;
    for (const t of [tasks.board, tasks.forecast]) {
      expect((await h.client.raw('POST', `/api/items/${t}/artefacts`, { path: BOOK, role: 'material' })).ok).toBe(true);
    }
    tasks.old = (await post(`/api/plans/${old}/items`, { kind: 'action', title: 'Old validation', fileSpecs: [{ path: VALIDATORS, action: 'modify' }] })).uid;
    expect((await h.client.raw('PUT', `/api/plans/${old}`, { status: 'completed' })).ok).toBe(true);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('every active plan\'s planned changes, by ticket key; nothing from a finished plan', async () => {
    const f = await forward();
    expect(f.plans.map((p) => p.label).sort()).toEqual(['Forecast refresh', 'JIRA-142', 'JIRA-150', 'Q3 board pack']);
    expect(f.files.map((x) => [x.path, x.change])).toEqual([[CURRENCY, 'create'], [VALIDATORS, 'modify']]);
    expect(f.files.find((x) => x.path === VALIDATORS)!.by.map((b) => b.planLabel).sort()).toEqual(['JIRA-142', 'JIRA-150']);
    expect(f.projection.ghostFiles.map((g) => g.path)).toEqual([CURRENCY]);
    expect(f.projection.modifiedFiles.map((g) => g.path)).toEqual([VALIDATORS]);
  });

  test('where they will meet: a file two plans plan to change, and a spreadsheet two plans rely on', async () => {
    const f = await forward();
    const file = f.overlaps.find((o) => o.kind === 'file')!;
    expect(file.words).toMatch(/^◇ planned overlap: JIRA-1(42|50) and JIRA-1(42|50) both plan to change packages\/shared\/src\/validators\.ts$/);
    expect(file).toMatchObject({ subject: VALIDATORS, file: VALIDATORS, serious: false, sequenced: false });
    expect(file.plans.flatMap((p) => p.tasks.map((t) => t.title)).sort()).toEqual(['Add a currency field', 'Round VAT per line']);
    const book = f.overlaps.find((o) => o.kind === 'material')!;
    expect(book.words).toMatch(/^◇ planned overlap: (Q3 board pack|Forecast refresh) and (Q3 board pack|Forecast refresh) both rely on data\/sales-2026\.xlsx$/);
    expect(book.file).toBeNull();
    expect(f.overlaps).toHaveLength(2);
    expect(f.words).toBe('Planned by 4 active plans · 1 file to change, 1 to create · 2 planned overlaps');
  });

  test('an agent asking gets the same answer', async () => {
    const r = await agent.callTool('get_play_forward', { project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    expect(JSON.parse(r.text)).toEqual(await forward());
  });

  test('once one task waits on the other, the overlap is sequenced and says which waits', async () => {
    expect((await h.client.raw('PUT', `/api/items/${tasks.currency}`, { dependencies: [tasks.vat] })).ok).toBe(true);
    const file = (await forward()).overlaps.find((o) => o.kind === 'file')!;
    expect(file.sequenced).toBe(true);
    expect(file.words).toMatch(/ · sequenced: JIRA-150 waits on JIRA-142$/);
    expect((await forward()).words).toBe('Planned by 4 active plans · 1 file to change, 1 to create · 2 planned overlaps (1 sequenced)');
  });

  test('a task done plans nothing more; a project never opened is refused', async () => {
    expect((await h.client.raw('PUT', `/api/items/${tasks.vat}`, { status: 'done' })).ok).toBe(true);
    const f = await forward();
    expect(f.overlaps.filter((o) => o.kind === 'file')).toEqual([]);
    expect(f.files.find((x) => x.path === VALIDATORS)!.by.map((b) => b.planLabel)).toEqual(['JIRA-150']);
    expect((await h.client.raw('GET', `/api/play-forward?project=${encodeURIComponent('/tmp/never-opened')}`)).ok).toBe(false);
    expect((await agent.callTool('get_play_forward', { project_path: '/tmp/never-opened' })).isError).toBe(true);
  });
});
