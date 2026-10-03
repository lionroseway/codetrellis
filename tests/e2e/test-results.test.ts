/**
 * Phase 32 B8.1 — per-test results, from the reports agents hand over.
 *
 * Sam's agent runs the billing tests and hands over the JUnit report with
 * report_tests: CodeTrellis reads it test by test, says "5 tests, 2 failing"
 * and names them with the first line of why. Handing it over again changes
 * nothing, and an older run never replaces a newer result. The window reads
 * the same (GET /api/tests). A test criterion's check names the failing
 * tests too, and keeps their results, credited to whoever recorded the file.
 * A file that is not a report, and one outside the project, are refused.
 * CodeTrellis runs nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const report = (cases: string) => `<?xml version="1.0"?>\n<testsuites>\n<testsuite name="billing">\n${cases}\n</testsuite>\n</testsuites>\n`;
const FIRST = report([
  '<testcase classname="InvoiceTest" name="totals a basket" time="0.01" file="src/billing/invoice.test.ts"/>',
  '<testcase classname="InvoiceTest" name="rounds half up" file="src/billing/invoice.test.ts"><failure message="expected 10.5 to be 11"/></testcase>',
  '<testcase classname="TaxTest" name="vat at 20%" file="src/billing/tax.test.ts"><error message="TypeError: rate is undefined"/></testcase>',
  '<testcase classname="TaxTest" name="zero rated" file="src/billing/tax.test.ts"/>',
  '<testcase classname="TaxTest" name="reverse charge" file="src/billing/tax.test.ts"><skipped/></testcase>',
].join('\n'));
const FIXED = report([
  '<testcase classname="InvoiceTest" name="rounds half up" file="src/billing/invoice.test.ts"/>',
  '<testcase classname="TaxTest" name="vat at 20%" file="src/billing/tax.test.ts"/>',
].join('\n'));

interface Listed { summary: { tests: number; failing: number; words: string }; tests: Array<{ label: string; result: string; message: string | null; reportPath: string }>; reports: Array<{ path: string; reportedBy: string }> }

test.describe.serial('Per-test results', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  const write = (rel: string, body: string, mtime?: Date) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    if (mtime) fs.utimesSync(p, mtime, mtime);
  };
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await agent.callTool(tool, args);
    return { error: r.isError ? r.text : null, data: r.isError ? null : JSON.parse(r.text) };
  };
  const listed = async () => (await (await h.client.raw('GET', `/api/tests?project=${encodeURIComponent(root)}`)).json()) as Listed;

  test.beforeAll(async () => {
    h = await setupHarness('test-results');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'codex' });
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('nothing reported yet says how to report', async () => {
    expect((await listed()).summary.words).toBe('No test results yet: an agent hands over a JUnit report with report_tests.');
  });

  test('a report handed over is read test by test: totals, and the failing ones by name with why', async () => {
    write('reports/junit-1.xml', FIRST, new Date(Date.now() - 60_000));
    const { error, data } = await call('report_tests', { path: 'reports/junit-1.xml' });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      report: 'reports/junit-1.xml',
      totals: { tests: 5, passed: 2, failing: 2, skipped: 1 },
      says: '5 tests, 2 failing, 1 skipped.',
      failing: [
        { test: 'InvoiceTest › rounds half up', result: 'failed', why: 'expected 10.5 to be 11' },
        { test: 'TaxTest › vat at 20%', result: 'error', why: 'TypeError: rate is undefined' },
      ],
    });
  });

  test('handing the same report over again changes nothing', async () => {
    const { data } = await call('report_tests', { path: 'reports/junit-1.xml' });
    expect(data.says).toBe('5 tests, 2 failing, 1 skipped (already reported; nothing changed).');
    expect((await listed()).reports).toHaveLength(1);
  });

  test('the same bytes from a later run are a new run: it is counted from when it ran', async () => {
    // A runner that stamps no time writes the same file when nothing changed.
    // It kept the first run's time, so tests re-run on the code as it is now
    // still read as older than the code.
    const before = (await call('report_tests', { path: 'reports/junit-1.xml' })).data;
    const later = new Date(Date.now() - 5_000);
    write('reports/junit-1.xml', FIRST, later);
    const { data } = await call('report_tests', { path: 'reports/junit-1.xml' });
    expect(data.says).toBe('5 tests, 2 failing, 1 skipped.');
    expect(Date.parse(data.ran_at)).toBe(later.getTime());
    expect(Date.parse(data.ran_at)).toBeGreaterThan(Date.parse(before.ran_at));
    expect((await listed()).reports).toHaveLength(1);
    // And handing that same run over again is, again, nothing new.
    expect((await call('report_tests', { path: 'reports/junit-1.xml' })).data.says).toBe('5 tests, 2 failing, 1 skipped (already reported; nothing changed).');
  });

  test('the window and get_test_results say the same, failing first', async () => {
    const l = await listed();
    expect(l.summary).toMatchObject({ tests: 5, failing: 2, words: '5 tests, 2 failing, 1 skipped' });
    expect(l.tests.map((t) => [t.label, t.result])).toEqual([
      ['TaxTest › vat at 20%', 'error'],
      ['InvoiceTest › rounds half up', 'failed'],
      ['TaxTest › reverse charge', 'skipped'],
      ['InvoiceTest › totals a basket', 'passed'],
      ['TaxTest › zero rated', 'passed'],
    ]);
    expect(l.reports[0].reportedBy).not.toBe('');
    const { data } = await call('get_test_results', { match: 'tax.test', failing_only: true });
    expect(data.tests).toEqual([expect.objectContaining({ test: 'TaxTest › vat at 20%', result: 'error', why: 'TypeError: rate is undefined', file: 'src/billing/tax.test.ts' })]);
  });

  test('a newer run replaces the results it covers; an older one never does', async () => {
    write('reports/junit-2.xml', FIXED);
    expect((await call('report_tests', { path: 'reports/junit-2.xml' })).data.says).toBe('2 tests, none failing.');
    let l = await listed();
    expect(l.summary).toMatchObject({ tests: 5, failing: 0 });
    // A report from before both runs, handed over late, changes no result.
    write('reports/junit-0.xml', FIRST.replace('expected 10.5 to be 11', 'an old failure'), new Date(Date.now() - 3_600_000));
    expect((await call('report_tests', { path: 'reports/junit-0.xml' })).error).toBeNull();
    l = await listed();
    expect(l.summary.failing).toBe(0);
    expect(l.tests.find((t) => t.label === 'InvoiceTest › rounds half up')).toMatchObject({ result: 'passed', reportPath: 'reports/junit-2.xml' });
  });

  test('a file that is not a report, one that is missing, and one outside the project are refused', async () => {
    write('notes.xml', '<notes><note>hi</note></notes>');
    expect((await call('report_tests', { path: 'notes.xml' })).error).toMatch(/^notes\.xml is not a JUnit report\. Most runners write one/);
    expect((await call('report_tests', { path: 'reports/nope.xml' })).error).toBe('reports/nope.xml does not exist.');
    expect((await call('report_tests', { path: '../outside.xml' })).error).toBe('../outside.xml is not a file inside this project.');
  });

  test('a test criterion\'s check names the failing tests, and keeps their results', async () => {
    const plan = await h.client.createPlan({ title: 'Billing fixes', projectPath: root });
    const item = ((await (await h.client.raw('POST', `/api/plans/${plan.uid}/items`, { kind: 'action', title: 'Fix VAT rounding' })).json()) as { uid: string }).uid;
    write('reports/junit-3.xml', report('<testcase classname="VatTest" name="rounds per line"><failure message="expected 2.40 to be 2.41"/></testcase>\n<testcase classname="VatTest" name="sums lines"/>'));
    const art = (await call('record_artefact', { item_uid: item, path: 'reports/junit-3.xml', role: 'evidence' })).data;
    const c = (await (await h.client.raw('POST', `/api/items/${item}/criteria`, { text: 'VAT tests pass', kind: 'test' })).json()) as { uid: string };
    const checked = (await call('check_criterion', { criterion_uid: c.uid, evidence: [{ attachment_uid: art.attachment_uid }] })).data;
    expect(checked.ok).toBe(false);
    expect(checked.findings.map((f: { message: string }) => f.message)).toContain('reports/junit-3.xml reports 1 of 2 tests failing: VatTest › rounds per line (expected 2.40 to be 2.41)');
    const l = await listed();
    expect(l.tests.find((t) => t.label === 'VatTest › rounds per line')).toMatchObject({ result: 'failed', message: 'expected 2.40 to be 2.41' });
  });
});
