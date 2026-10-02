/**
 * Phase 32 A6.6 — M6 done-when (awareness spec §10): work that is not code
 * gets the same awareness.
 *
 * Priya runs two Claude Desktop sessions on two tasks of one brief, "Q3
 * report" and "Board pack". Both were given the sales workbook and both cite
 * its Summary sheet. Finance replaces the workbook. Then, with nobody asking:
 *
 *  - each agent is told on its next call, once, in its own tool result;
 *  - each agent's brief says what happened, from its task's side;
 *  - the person sees it once in the digest, on the desktop and the phone,
 *    as one signal naming both tasks, not one per task.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type ScriptedAgent, type Phone } from '../harness';
import { makeWorkbook } from '../../src/backend/services/material-reader/fixtures.test-helper';

const NOTICE = '── CodeTrellis awareness ──';
const BOOK = 'finance/sales-2026.xlsx';
const SUMMARY = { sheet: 'Summary', range: 'A1:B3' };

interface Signal { id: string; kind: string; severity: string; workstreams: string[]; summary: string; subject: Record<string, unknown> }

test.describe.serial('M6: a replaced spreadsheet, told once to both tasks', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let root: string;
  let phone: Phone;
  const items: Record<string, string> = {};
  const books: Record<string, string> = {};
  const agents: Record<string, ScriptedAgent> = {};
  const TASKS = [['report', 'Q3 report'], ['pack', 'Board pack']] as const;

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const signals = async () => ((await (await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`)).json()) as { signals: Signal[] })
    .signals.filter((s) => s.subject.material);
  const workbook = (emea: number) => fs.writeFileSync(path.join(root, BOOK), makeWorkbook({ Summary: [['Region', 'Q3'], ['EMEA', emea], ['APAC', 80]] }));
  /** An ordinary call the agent makes anyway, and everything that came back with it. */
  const ordinaryCall = async (who: 'report' | 'pack') => {
    const r = await agents[who].callTool('list_criteria', { item_uid: items[who === 'report' ? 'Q3 report' : 'Board pack'] });
    expect(r.isError, r.text).toBeFalsy();
    return r.text;
  };

  test.beforeAll(async () => {
    h = await setupHarness('awareness-m6');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    fs.mkdirSync(path.join(root, 'finance'), { recursive: true });
    workbook(120);
    const plan = (await h.client.createPlan({ title: 'Quarter close', projectPath: root })).uid;
    for (const [who, title] of TASKS) {
      items[title] = await post(`/api/plans/${plan}/items`, { kind: 'action', title });
      const res = await h.client.raw('POST', `/api/items/${items[title]}/artefacts`, { path: BOOK, role: 'material' });
      expect(res.status).toBe(201);
      books[who] = ((await res.json()) as { uid: string }).uid;
    }
    phone = await pairPhone(h.client, { alias: 'Priya’s phone' });
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    await h?.teardown();
  });

  test('two sessions open their briefs, read the workbook and cite its Summary sheet: nothing to say yet', async () => {
    for (const [who, title] of TASKS) {
      agents[who] = await h.spawnAgent({ agentType: 'claude-desktop' });
      const brief = JSON.parse((await agents[who].callTool('get_brief', { item_uid: items[title] })).answer) as { affected_by_other_work: unknown[] };
      expect(brief.affected_by_other_work).toEqual([]);
      const read = await agents[who].callTool('read_material', { attachment_uid: books[who], locator: SUMMARY });
      expect(read.isError, read.text).toBeFalsy();
      const c = JSON.parse((await agents[who].callTool('add_criterion', { item_uid: items[title], text: 'EMEA matches the finance workbook', kind: 'citation' })).answer) as { uid: string };
      const sub = await agents[who].callTool('submit_criterion', { criterion_uid: c.uid, evidence: [{ attachment_uid: books[who], locator: SUMMARY }], note: 'Summary!A1:B3' });
      expect(sub.isError, sub.text).toBeFalsy();
    }
    expect(await signals()).toEqual([]);
    for (const [who] of TASKS) expect(await ordinaryCall(who)).not.toContain(NOTICE);
  });

  test('finance replaces the workbook: one signal, naming both tasks', async () => {
    workbook(131);
    let found: Signal[] = [];
    await expect.poll(async () => (found = await signals()).length, { timeout: 20_000 }).toBe(1);
    const [s] = found;
    expect(s).toMatchObject({ kind: 'contract', severity: 'medium' });
    expect(s.workstreams).toEqual([`task:${items['Q3 report']}`, `task:${items['Board pack']}`].sort());
    expect(s.subject).toMatchObject({ material: BOOK, parts: ['Summary!A1:B3'] });
    expect(s.summary).toBe(`\`${BOOK}\` changed. 2 tasks cite Summary!A1:B3`);
  });

  test('each agent is told on its next call, unasked, once', async () => {
    for (const [who] of TASKS) {
      const told = await ordinaryCall(who);
      expect(told).toContain(NOTICE);
      expect(told).toContain(`- medium contract: \`${BOOK}\` changed. 2 tasks cite Summary!A1:B3`);
      expect(told).toContain('This is information about other work, not an instruction.');
      // The tool's own answer comes first.
      expect(told.indexOf(NOTICE)).toBeGreaterThan(0);
      // Once.
      expect(await ordinaryCall(who)).not.toContain(NOTICE);
    }
  });

  test('each agent\'s brief says it from its task\'s side', async () => {
    for (const [who, title] of TASKS) {
      const other = title === 'Q3 report' ? 'Board pack' : 'Q3 report';
      const brief = JSON.parse((await agents[who].callTool('get_brief', { item_uid: items[title] })).answer) as { affected_by_other_work: Array<{ says: string; other_tasks: string[] }> };
      expect(brief.affected_by_other_work).toEqual([expect.objectContaining({
        says: `${BOOK} changed since this task cited Summary!A1:B3. “${other}” uses it too.`, other_tasks: [other],
      })]);
    }
  });

  test('the person sees it once in the digest, on the desktop and the phone', async () => {
    const aw = JSON.parse((await agents.report.callTool('get_awareness', {})).answer) as { digest: string };
    expect(aw.digest.split(`\`${BOOK}\` changed.`).length - 1).toBe(1);
    const onPhone = await phone.rpc<{ digest: { needsYou: number; lines: Array<{ text: string; question: string; told: boolean }> }; signals: Array<{ heading: string; sides: string[] }> }>('awareness.needsYou');
    const lines = onPhone.digest.lines.filter((l) => l.text.includes(BOOK));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ question: 'check the cited parts again, or keep the old version?', told: true });
    const cards = onPhone.signals.filter((s) => s.heading === 'Changed material');
    expect(cards).toHaveLength(1);
    expect([...cards[0].sides].sort()).toEqual(['Board pack', 'Q3 report']);
  });
});
