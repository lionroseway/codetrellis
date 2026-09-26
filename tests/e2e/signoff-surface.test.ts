/**
 * The sign-off surface over REST (Phase 32 §0.4d).
 *
 * Five routes had no test: checking a criterion, the plan's worklist, and
 * the sign-off pack as data, as a saved page, and verified later against
 * the files it names. One plan walks through them: a citation approved
 * (over plain HTTP, so recorded as unverified), one sent back with a note,
 * one waiting for a person, one not started. Then the source file moves,
 * and the check, the worklist and the pack's verification all say so.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

interface Worklist {
  planUid: string;
  entries: Array<{ reason: string; text: string; note: string | null; details: string[]; anchors: Array<{ path: string | null; locator: unknown }> }>;
  waitingForPerson: number;
  met: number;
  total: number;
}

test.describe.serial('Sign-off surface', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let planUid: string;
  let ledger: string;
  let approved: { uid: string };
  let savedPage: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(name, args);
    expect(res.isError, `${name}: ${res.text}`).not.toBe(true);
    return JSON.parse(res.text);
  };
  /** The verify route takes the saved file as text/plain, which the JSON client does not send. */
  const verify = (uid: string, text: string) => fetch(h.backend.baseUrl + `/api/plans/${uid}/signoff-pack/verify`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-codetrellis-token': h.backend.capabilityToken },
    body: text,
  });

  test.beforeAll(async () => {
    h = await setupHarness('signoff-surface');
    await h.client.scanProject(h.fixture.projectPath);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    ledger = path.join(h.fixture.projectPath, 'data', 'ledger.csv');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    fs.writeFileSync(ledger, 'region,revenue\nEMEA,120\nAPAC,80\n');

    planUid = (await h.client.createPlan({ title: 'Q3 board pack', projectPath: h.fixture.projectPath })).uid;
    const item = (await req('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Q3 revenue summary' })).uid as string;
    const material = await tool('record_artefact', { item_uid: item, path: 'data/ledger.csv', role: 'material', note: 'The ledger export' });
    const cite = (range: string) => [{ attachment_uid: material.attachment_uid, locator: { range } }];

    // Approved: the agent cites B2, a person approves.
    approved = await req('POST', `/api/items/${item}/criteria`, { text: 'EMEA revenue matches the ledger', kind: 'citation' });
    await tool('submit_criterion', { criterion_uid: approved.uid, evidence: cite('B2'), note: 'EMEA in B2' });
    await req('POST', `/api/criteria/${approved.uid}/decide`, { decision: 'approved' });

    // Sent back, with a note.
    const summary = await req('POST', `/api/items/${item}/criteria`, { text: 'The summary reads well', kind: 'manual' });
    await tool('submit_criterion', { criterion_uid: summary.uid, note: 'Drafted' });
    await req('POST', `/api/criteria/${summary.uid}/decide`, { decision: 'sent_back', note: 'Lead with the APAC miss' });

    // Waiting for a person.
    const apac = await req('POST', `/api/items/${item}/criteria`, { text: 'APAC revenue matches the ledger', kind: 'citation' });
    await tool('submit_criterion', { criterion_uid: apac.uid, evidence: cite('B3'), note: 'APAC in B3' });

    // Not started.
    await req('POST', `/api/items/${item}/criteria`, { text: 'Finance has seen it', kind: 'manual' });
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('check: a criterion whose evidence holds passes, and an unknown one is 404', async () => {
    const check = await req('POST', `/api/criteria/${approved.uid}/check`);
    expect(check).toMatchObject({ criterionUid: approved.uid, ok: true });
    expect((await h.client.raw('POST', '/api/criteria/no-such-criterion/check')).status).toBe(404);
  });

  test('worklist: sent back first with its note, then not started; met and waiting are counted, not listed', async () => {
    const list = (await req('GET', `/api/plans/${planUid}/worklist`)) as Worklist;
    expect(list.planUid).toBe(planUid);
    expect(list.entries.map((e) => [e.reason, e.text])).toEqual([
      ['sent_back', 'The summary reads well'],
      ['open', 'Finance has seen it'],
    ]);
    expect(list.entries[0].note).toBe('Lead with the APAC miss');
    expect(list).toMatchObject({ total: 4, met: 1, waitingForPerson: 1 });
    expect((await h.client.raw('GET', '/api/plans/no-such-plan/worklist')).status).toBe(404);
  });

  test('pack as data: every criterion, the approval tagged as unverified, the file with its hash', async () => {
    const pack = await req('GET', `/api/plans/${planUid}/signoff-pack`);
    expect(pack).toMatchObject({ format: 'codetrellis-signoff-pack', plan: { uid: planUid, title: 'Q3 board pack' } });
    expect(pack.rows).toHaveLength(4);
    const row = pack.rows.find((r: { text: string }) => r.text === 'EMEA revenue matches the ledger');
    expect(row).toMatchObject({ state: 'met', unverified: true, selfApproved: false });
    expect(row.decision).toMatchObject({ decision: 'approved', actorType: 'unverified', channel: 'local-api' });
    const file = pack.files.find((f: { path: string }) => f.path === 'data/ledger.csv');
    expect(file).toMatchObject({ takenAt: 'approval' });
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await h.client.raw('GET', '/api/plans/no-such-plan/signoff-pack')).status).toBe(404);
  });

  test('pack as a page: a download, sandboxed, with the unverified approval listed apart', async () => {
    const res = await h.client.raw('GET', `/api/plans/${planUid}/signoff-pack.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="sign-off-pack-Q3-board-pack.html"');
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'.*sandbox/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    savedPage = await res.text();
    const apart = savedPage.indexOf('Approved through the local API (unverified)');
    expect(apart).toBeGreaterThan(0);
    expect(savedPage.indexOf('EMEA revenue matches the ledger', apart)).toBeGreaterThan(apart);
    expect(savedPage).toContain('1 of 4 criteria met — 1 of them unverified (local API), listed separately');
    expect((await h.client.raw('GET', '/api/plans/no-such-plan/signoff-pack.html')).status).toBe(404);
  });

  test('verify: the saved page matches while the file is unchanged', async () => {
    const res = await verify(planUid, savedPage);
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.files.find((f: { path: string }) => f.path === 'data/ledger.csv').verdict).toBe('matches');
    expect(result.changed).toBe(0);
    expect(result.missing).toBe(0);
  });

  test('the source moves: the check fails, the worklist says stale and why, the pack no longer matches', async () => {
    // The restated ledger drops the regional rows: B2 now points at nothing.
    fs.writeFileSync(ledger, 'region,revenue\n');

    const check = await req('POST', `/api/criteria/${approved.uid}/check`);
    expect(check.ok).toBe(false);
    expect(check.findings.map((f: { message: string }) => f.message).join('\n')).toMatch(/B2 is outside data\/ledger\.csv/);

    const list = (await req('GET', `/api/plans/${planUid}/worklist`)) as Worklist;
    const stale = list.entries.find((e) => e.text === 'EMEA revenue matches the ledger');
    expect(stale?.reason).toBe('stale');
    expect(stale?.details).toEqual(['data/ledger.csv changed after it was approved']);
    expect(list.met).toBe(0);

    const result = await (await verify(planUid, savedPage)).json();
    expect(result.files.find((f: { path: string }) => f.path === 'data/ledger.csv').verdict).toBe('changed');
  });

  test('verify refuses an empty body, something that is not a pack, and another plan\'s pack', async () => {
    expect((await verify(planUid, '   ')).status).toBe(400);
    expect((await verify(planUid, '<html>not a pack</html>')).status).toBe(400);
    const other = (await h.client.createPlan({ title: 'Other', projectPath: h.fixture.projectPath })).uid;
    const wrong = await verify(other, savedPage);
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toMatch(/different plan/);
  });
});
