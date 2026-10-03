/**
 * Phase 32 A6.3 — material signals (awareness spec §10.3).
 *
 * Priya's two Claude Desktop sessions work "Q3 report" and "Board pack",
 * and both were given the sales export. Each reads it. When the export is
 * replaced, the app raises one signal naming both tasks (it changed after
 * they read it). When the pack reads the new one, the two tasks disagree
 * about the facts: one signal, a version split, saying which task has the
 * current one. When the report cites the export and it changes again, the
 * report's citation is out of date while the pack still uses the file: one
 * contract signal, told to the pack's agent on its next call.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

interface Signal { id: string; kind: string; severity: string; state: string; workstreams: string[]; summary: string; subject: Record<string, unknown> }

test.describe.serial('Material signals', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let plan: string;
  const items: Record<string, string> = {};
  const sales: Record<string, string> = {};
  const agents: Record<string, ScriptedAgent> = {};

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const signals = async () => ((await (await h.client.raw('GET', `/api/awareness?fresh=1&project=${encodeURIComponent(root)}`)).json()) as { signals: Signal[] }).signals
    .filter((s) => s.subject.material);
  const replace = (text: string) => fs.writeFileSync(path.join(root, 'data/sales.csv'), text);
  const readIt = async (who: 'report' | 'pack') => {
    const r = await agents[who].callTool('read_material', { attachment_uid: sales[who] });
    expect(r.isError, r.text).toBeFalsy();
  };
  const task = (title: string) => `task:${items[title]}`;

  test.beforeAll(async () => {
    h = await setupHarness('material-signals');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    replace('region,q3\nEMEA,120\n');
    plan = (await h.client.createPlan({ title: 'Quarter close', projectPath: root })).uid;
    for (const [who, title] of [['report', 'Q3 report'], ['pack', 'Board pack']] as const) {
      items[title] = await post(`/api/plans/${plan}/items`, { kind: 'action', title });
      const res = await h.client.raw('POST', `/api/items/${items[title]}/artefacts`, { path: 'data/sales.csv', role: 'material' });
      expect(res.status).toBe(201);
      sales[who] = ((await res.json()) as { uid: string }).uid;
      agents[who] = await h.spawnAgent({ agentType: 'claude-desktop' });
      expect((await agents[who].callTool('get_brief', { item_uid: items[title] })).isError).toBeFalsy();
    }
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('two tasks read the same version: nothing to say', async () => {
    await readIt('report');
    await readIt('pack');
    expect(await signals()).toEqual([]);
  });

  test('the export is replaced: one signal, naming both tasks', async () => {
    replace('region,q3\nEMEA,125\n');
    let found: Signal[] = [];
    await expect.poll(async () => (found = await signals()).length, { timeout: 15_000 }).toBe(1);
    const [s] = found;
    expect(s).toMatchObject({ kind: 'stale-base', severity: 'low', state: 'open' });
    expect(s.workstreams).toEqual([task('Board pack'), task('Q3 report')].sort());
    expect(s.subject).toMatchObject({ material: 'data/sales.csv', labels: { [task('Q3 report')]: 'Q3 report', [task('Board pack')]: 'Board pack' } });
    expect(s.summary).toMatch(/^`data\/sales\.csv` changed after “.+”, “.+” read it, and neither has read it since$/);
  });

  test('the pack reads the new export: the two tasks now read different versions', async () => {
    await readIt('pack');
    let found: Signal[] = [];
    await expect.poll(async () => (found = await signals()).map((s) => s.kind), { timeout: 15_000 }).toEqual(['version-split']);
    expect(found[0]).toMatchObject({ severity: 'medium', subject: { readVersions: { [task('Board pack')]: 'current', [task('Q3 report')]: 'earlier' } } });
    expect(found[0].summary).toContain('“Board pack” has the current one');
  });

  test('the report cites the export and it changes again: one contract signal, told to the pack\'s agent', async () => {
    // The report catches up and cites the line it uses.
    await readIt('report');
    const c = JSON.parse((await agents.report.callTool('add_criterion', { item_uid: items['Q3 report'], text: 'EMEA matches the export', kind: 'citation' })).answer) as { uid: string };
    const sub = await agents.report.callTool('submit_criterion', { criterion_uid: c.uid, evidence: [{ attachment_uid: sales.report, locator: { lines: 2 } }], note: 'line 2' });
    expect(sub.isError, sub.text).toBeFalsy();
    await expect.poll(async () => (await signals()).length, { timeout: 15_000 }).toBe(0);

    replace('region,q3\nEMEA,131\n');
    let found: Signal[] = [];
    await expect.poll(async () => (found = await signals()).map((s) => s.kind), { timeout: 15_000 }).toEqual(['contract']);
    expect(found[0]).toMatchObject({ severity: 'medium', subject: { parts: ['line 2'], citedBy: [task('Q3 report')] } });
    expect(found[0].summary).toBe('`data/sales.csv` changed. “Q3 report” cites line 2. “Board pack” uses it too');

    // The pack's agent hears of it on its next call; so does its awareness.
    const aw = JSON.parse((await agents.pack.callTool('get_awareness', {})).answer) as { your_task: string; signals: Array<{ id: string }> };
    expect(aw.your_task).toBe(task('Board pack'));
    expect(aw.signals.map((s) => s.id)).toContain(found[0].id);
  });

  test('each task\'s brief says what the other task\'s work did to it, from its own side (A6.4)', async () => {
    const affected = async (who: 'report' | 'pack', title: string) =>
      (JSON.parse((await agents[who].callTool('get_brief', { item_uid: items[title] })).answer) as { affected_by_other_work: Array<{ kind: string; severity: string; state: string; says: string; other_tasks: string[] }> }).affected_by_other_work;
    expect(await affected('pack', 'Board pack')).toEqual([{
      signal_id: expect.any(String), kind: 'Changed material', severity: 'medium', state: 'open',
      says: 'data/sales.csv changed since “Q3 report” cited line 2. This task uses it too.', other_tasks: ['Q3 report'],
    }]);
    expect((await affected('report', 'Q3 report'))[0].says).toBe('data/sales.csv changed since this task cited line 2. “Board pack” uses it too.');

    // Dismissed by the person, it leaves the brief; the tab still has it.
    const [s] = await signals();
    expect((await h.client.raw('POST', `/api/awareness/${s.id}/state?project=${encodeURIComponent(root)}`, { state: 'dismissed' })).ok).toBe(true);
    expect(await affected('pack', 'Board pack')).toEqual([]);
  });

  test('the sign-off pack lists each signal that touched a task, and how it ended (A6.5)', async () => {
    const pack = (await (await h.client.raw('GET', `/api/plans/${plan}/signoff-pack`)).json()) as {
      signals: Array<{ itemTitle: string; heading: string; outcome: string; says: string; outcomeWords: string }>;
    };
    const of = (title: string) => pack.signals.filter((x) => x.itemTitle === title).map((x) => [x.heading, x.outcome]);
    // The contract was set aside over the local API; the earlier two are gone.
    // Answered before fixed, then by severity, as a PR body orders them.
    expect(of('Board pack')).toEqual([['Changed material', 'dismissed'], ['Different versions', 'fixed'], ['Material changed', 'fixed']]);
    expect(of('Q3 report').map((x) => x[0]).sort()).toEqual(['Changed material', 'Different versions', 'Material changed']);
    const set = pack.signals.find((x) => x.itemTitle === 'Board pack' && x.outcome === 'dismissed')!;
    expect(set.says).toBe('data/sales.csv changed since “Q3 report” cited line 2. This task uses it too.');
    expect(set.outcomeWords).toBe('Set aside by someone through the local API, not verified as the person.');

    const html = await (await h.client.raw('GET', `/api/plans/${plan}/signoff-pack.html`)).text();
    expect(html).toContain('<h2>Other work that touched these tasks</h2>');
    expect(html).toContain('data/sales.csv changed since “Q3 report” cited line 2. This task uses it too.');
  });
});
