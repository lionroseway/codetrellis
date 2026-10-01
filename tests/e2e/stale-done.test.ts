/**
 * Phase 32 B8.4a — "done" on stale tests (JOURNEYS J1).
 *
 * Sam's agent fixes VAT rounding in src/billing/vat.ts. It runs the tests,
 * hands over the report and its test criterion is met: the task says
 * "1 criterion · grounded". Then it edits vat.ts once more and marks the
 * task done, citing the same report. That is refused, with why, and nothing
 * changes: the task now says "⚠ tests older than the code", in the window
 * and in the agent's brief. It runs the tests again, hands over the new
 * report, and "done" goes through. A person marking it done is their call:
 * never refused. CodeTrellis runs nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const REPORT = (n: number) => `<?xml version="1.0"?>\n<testsuites>\n<testsuite name="vat">\n${
  Array.from({ length: n }, (_, i) => `<testcase classname="VatTest" name="case ${i + 1}" file="src/billing/vat.test.ts"/>`).join('\n')
}\n</testsuite>\n</testsuites>\n`;

interface Grounding { words: string | null; criteria: Array<{ uid: string; grade: string; why: string }> }

test.describe.serial('Done on tests older than the code', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  let item: string;
  let criterion: string;
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const write = (rel: string, body: string, mtime: Date) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    fs.utimesSync(p, mtime, mtime);
  };
  const grounding = async () => (await (await h.client.raw('GET', `/api/items/${item}/grounding`)).json()) as Grounding;
  const statusOf = async () => ((await (await h.client.raw('GET', `/api/items/${item}`)).json()) as { status: string }).status;

  test.beforeAll(async () => {
    h = await setupHarness('stale-done');
    root = h.fixture.projectPath;
    write('src/billing/vat.ts', 'export const vat = (n: number) => Math.round(n * 0.2 * 100) / 100;\n', minutesAgo(30));
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
    const plan = await h.client.createPlan({ title: 'Billing fixes', projectPath: root });
    item = ((await (await h.client.raw('POST', `/api/plans/${plan.uid}/items`, {
      kind: 'action', title: 'Fix VAT rounding', fileSpecs: [{ path: 'src/billing/vat.ts', action: 'modify' }],
    })).json()) as { uid: string }).uid;
    criterion = ((await (await h.client.raw('POST', `/api/items/${item}/criteria`, { text: 'VAT tests pass', kind: 'test', policy: 'agent' })).json()) as { uid: string }).uid;
    expect((await agent.callTool('update_item', { uid: item, status: 'in_progress' })).isError).toBeFalsy();
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('the tests run after the change: met, and the task is grounded', async () => {
    write('reports/vat.xml', REPORT(12), minutesAgo(20));
    const art = JSON.parse((await agent.callTool('record_artefact', { item_uid: item, path: 'reports/vat.xml', role: 'evidence' })).text) as { attachment_uid: string };
    const r = await agent.callTool('submit_criterion', { criterion_uid: criterion, evidence: [{ attachment_uid: art.attachment_uid }] });
    expect(r.isError, r.text).toBeFalsy();
    expect((await grounding()).words).toBe('1 criterion · grounded');
  });

  test('the code changes after the run: "done" on that report is refused, says why, and changes nothing', async () => {
    write('src/billing/vat.ts', 'export const vat = (n: number) => Math.round(n * 0.2 * 100 + Number.EPSILON) / 100;\n', minutesAgo(5));
    const r = await agent.callTool('update_item', { uid: item, status: 'done' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Not done: "VAT tests pass" — ⚠ tests older than the code: reports\/vat\.xml ran \d{4}-\d\d-\d\d \d\d:\d\d, before the last change to this item's files \(\d{4}-\d\d-\d\d \d\d:\d\d\) — run the tests again\. Hand over the new report \(submit_criterion, or report_tests\), then mark it done\. Nothing was changed\.$/);
    expect(await statusOf()).toBe('in_progress');
  });

  test('the task says "⚠ tests older than the code", in the window and in the agent\'s brief', async () => {
    const g = await grounding();
    expect(g.words).toBe('1 criterion · 1 with tests older than the code');
    expect(g.criteria[0]).toMatchObject({ uid: criterion, grade: 'tests_older' });
    expect(g.criteria[0].why).toMatch(/^⚠ tests older than the code: reports\/vat\.xml ran /);
    const brief = JSON.parse((await agent.callTool('get_brief', { item_uid: item })).text) as { grounding: { says: string } };
    expect(brief.grounding.says).toBe(g.words);
  });

  test('run again and handed over: "done" goes through, and the task is grounded', async () => {
    write('reports/vat.xml', REPORT(12), minutesAgo(1));
    const art = JSON.parse((await agent.callTool('record_artefact', { item_uid: item, path: 'reports/vat.xml', role: 'evidence' })).text) as { attachment_uid: string };
    expect((await agent.callTool('submit_criterion', { criterion_uid: criterion, evidence: [{ attachment_uid: art.attachment_uid }] })).isError).toBeFalsy();
    const r = await agent.callTool('update_item', { uid: item, status: 'done' });
    expect(r.isError, r.text).toBeFalsy();
    expect(await statusOf()).toBe('done');
    expect((await grounding()).words).toBe('1 criterion · grounded');
  });

  test('a person marking it done is their call: never refused', async () => {
    expect((await h.client.raw('PUT', `/api/items/${item}`, { status: 'in_progress' })).status).toBe(200);
    write('src/billing/vat.ts', 'export const vat = (n: number) => Math.round(n * 20) / 100;\n', new Date());
    expect((await grounding()).words).toBe('1 criterion · 1 with tests older than the code');
    expect((await h.client.raw('PUT', `/api/items/${item}`, { status: 'done' })).status).toBe(200);
    expect(await statusOf()).toBe('done');
  });
});
