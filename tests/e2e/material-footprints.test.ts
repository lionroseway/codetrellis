/**
 * Phase 32 A6.2 — material footprints (awareness spec §10.2).
 *
 * Priya's two sessions work two tasks of one plan, "Q3 report" and "Board
 * pack", and both use the sales export recorded on the report. Each opens its
 * task with get_brief and reads the export through read_material. Each read
 * is kept against the task of the session that made it, with who read it,
 * the part, and the file's hash then: the export changes between the two
 * reads, so the two tasks saw different versions, and their briefs say so.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

interface ReadLine { path: string; attachment_uid: string; reads: number; parts: string[]; by: string[]; sha256: string | null }

test.describe.serial('Material footprints', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let sales: { uid: string; sha256: string };
  const items: Record<string, string> = {};
  const agents: Record<string, ScriptedAgent> = {};

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const readSoFar = async (who: string, task: string) =>
    (JSON.parse((await agents[who].callTool('get_brief', { item_uid: items[task] })).answer) as { read_so_far: ReadLine[] }).read_so_far;
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const V1 = 'region,q3\nEMEA,120\nAPAC,80\n';
  const V2 = 'region,q3\nEMEA,125\nAPAC,80\n';

  test.beforeAll(async () => {
    h = await setupHarness('material-footprints');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data/sales.csv'), V1);
    const plan = (await h.client.createPlan({ title: 'Quarter close', projectPath: root })).uid;
    for (const title of ['Q3 report', 'Board pack']) items[title] = await post(`/api/plans/${plan}/items`, { kind: 'action', title });
    const res = await h.client.raw('POST', `/api/items/${items['Q3 report']}/artefacts`, { path: 'data/sales.csv', role: 'material' });
    expect(res.status).toBe(201);
    sales = await res.json();
    expect(sales.sha256).toBe(sha(V1));
    agents.report = await h.spawnAgent({ agentType: 'claude-desktop' });
    agents.pack = await h.spawnAgent({ agentType: 'codex' });
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('before any read, a brief has read nothing', async () => {
    expect(await readSoFar('report', 'Q3 report')).toEqual([]);
    expect(await readSoFar('pack', 'Board pack')).toEqual([]);
  });

  test('two sessions read one material: each read is kept with who, the part and the hash then', async () => {
    const first = await agents.report.callTool('read_material', { attachment_uid: sales.uid, locator: { lines: '1-2' } });
    expect(first.isError, first.text).toBeFalsy();

    // The export is replaced before the pack's session reads it.
    fs.writeFileSync(path.join(root, 'data/sales.csv'), V2);
    const second = await agents.pack.callTool('read_material', { attachment_uid: sales.uid });
    expect(second.isError, second.text).toBeFalsy();

    const report = await readSoFar('report', 'Q3 report');
    expect(report).toEqual([expect.objectContaining({
      path: 'data/sales.csv', attachment_uid: sales.uid, reads: 1, parts: ['lines 1–2'], by: ['claude-desktop'], sha256: sha(V1),
    })]);
    // The pack read the material recorded on the report: it counts for the pack.
    const pack = await readSoFar('pack', 'Board pack');
    expect(pack).toEqual([expect.objectContaining({
      path: 'data/sales.csv', attachment_uid: sales.uid, reads: 1, parts: ['the whole file'], by: ['codex'], sha256: sha(V2),
    })]);
  });

  test('reading again adds to the task\'s own line, with the new hash', async () => {
    await agents.report.callTool('read_material', { attachment_uid: sales.uid, locator: { lines: '1-2' } });
    await agents.report.callTool('read_material', { attachment_uid: sales.uid, locator: { text: 'APAC' } });
    const report = await readSoFar('report', 'Q3 report');
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ reads: 3, parts: ['lines 1–2', 'where it says “APAC”'], by: ['claude-desktop'], sha256: sha(V2) });
    // The pack's line is its own.
    expect((await readSoFar('pack', 'Board pack'))[0].reads).toBe(1);
  });

  test('a read that fails is not kept', async () => {
    const bad = await agents.pack.callTool('read_material', { attachment_uid: sales.uid, locator: { lines: '900-901' } });
    expect(bad.isError).toBe(true);
    expect((await readSoFar('pack', 'Board pack'))[0].reads).toBe(1);
  });
});
