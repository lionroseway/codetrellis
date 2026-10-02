/**
 * Phase 32 B10.5 — the G2 done-when: months later, the week a payment
 * change was built, as it was, and proven.
 *
 * Sam's team keeps a year of evidence. One week, the refunds change is
 * built while the exports work is also under way: an agent's claim of the
 * refunds task is held at a breakpoint and a person lets it through, and a
 * person approves its criterion. Months later (the backend's clock moved
 * forward 120 days) an auditor asks what else was going on and who approved
 * what. The reviewer sets the cursor to that week: the frames are there,
 * with the code as it was; the stack then shows both plans under way and the
 * refunds task in progress, though it is done now; the Timeline has the
 * breakpoint and the approval, each with who. The record says it is intact
 * since that week. The week's evidence exports and verifies. Then someone
 * edits the approval in the database: the record names it, and so does the
 * evidence exported before.
 */

import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, startBackend, createClient, createMcpClient, type Harness, type HarnessClient, type RunningBackend, type ScriptedMcp } from '../harness';
import type { RecordCheck } from '../../src/shared/types/record';

const DAY = 24 * 60 * 60 * 1000;
const LATER = 120 * DAY;
const FRAME_ENV = { CODETRELLIS_FRAME_INTERVAL_MS: '200', CODETRELLIS_TURN_GAP_MS: '600000' };

interface Frame { id: number; at: number; reasons: string[]; sameAs: number | null }
interface Stored { id: string; type: string; agentType: string | null; at?: number; timestamp?: number; payload: Record<string, unknown> }
interface Check { ok: boolean; seal: { state: string }; chain: { ok: boolean; words: string }; here: { state: string; words: string }; words: string }

test.describe.serial('G2: months later, the week a payment change was built', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let root: string;
  let codex: ScriptedMcp;
  let refunds: string;
  let refundsTask: string;
  let weekFrom: number;
  let weekTo: number;
  let heldAt = 0;
  let later: RunningBackend | null = null;
  let client: HarnessClient;
  let evidencePage = '';

  const json = async <T>(c: HarnessClient, method: string, url: string, body?: unknown): Promise<T> => {
    const res = await c.raw(method, url, body);
    expect(res.status, `${method} ${url}: ${await res.clone().text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const q = () => `project=${encodeURIComponent(root)}`;
  const startLater = async () => {
    later = await startBackend({ dataDir: h.fixture.dataDir, env: { ...FRAME_ENV, CODETRELLIS_CLOCK_OFFSET_MS: String(LATER) } });
    client = createClient(later.baseUrl, later.capabilityToken);
    await client.scanProject(root);
  };
  const verify = (text: string) => fetch(later!.baseUrl + '/api/evidence/verify', {
    method: 'POST', headers: { 'content-type': 'text/plain', 'x-codetrellis-token': later!.capabilityToken }, body: text,
  });

  test.beforeAll(async () => {
    h = await setupHarness('record-g2', { env: FRAME_ENV });
    root = h.fixture.projectPath;
    client = h.client;
    // The team keeps a year: set before the week, by a person.
    const settings = await json<{ data: Record<string, unknown> }>(client, 'GET', '/api/settings');
    await json(client, 'PUT', '/api/settings', { data: { ...settings.data, retentionDays: 365 } });
    await client.scanProject(root);
    codex = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await codex.connect();
  });

  test.afterAll(async () => {
    await codex?.disconnect().catch(() => {});
    await later?.stop().catch(() => {});
    await h?.teardown();
  });

  test('the week: refunds built beside the exports work; a claim held and let through; the criterion approved', async () => {
    weekFrom = Date.now();
    refunds = (await client.createPlan({ title: 'Payments: refunds to the cent', projectPath: root })).uid;
    refundsTask = (await json<{ uid: string }>(client, 'POST', `/api/plans/${refunds}/items`, { kind: 'action', title: 'Round refunds half-even' })).uid;
    const exportsPlan = (await client.createPlan({ title: 'Exports v2', projectPath: root })).uid;
    const exportsTask = (await json<{ uid: string }>(client, 'POST', `/api/plans/${exportsPlan}/items`, { kind: 'action', title: 'CSV exports' })).uid;
    await json(client, 'PUT', `/api/items/${exportsTask}`, { status: 'in_progress' });
    await json(client, 'PUT', `/api/items/${refundsTask}`, { status: 'in_progress' });
    await expect.poll(async () => (await json<{ frames: Frame[] }>(client, 'GET', `/api/replay/frames?${q()}`)).frames.length).toBeGreaterThan(0);

    await json(client, 'POST', '/api/breakpoints', { kind: 'task', itemUid: refundsTask, note: 'Payments: ask me first' });
    const held = await codex.callTool('claim_item', { uid: refundsTask });
    expect(held.isError, held.text).toBeFalsy();
    heldAt = Date.now();
    await json(client, 'POST', `/api/breakpoint-hits/${(JSON.parse(held.text) as { ref: string }).ref}/answer`, { decision: 'continue' });
    expect((await codex.callTool('claim_item', { uid: refundsTask })).isError).toBeFalsy();

    const criterion = await json<{ uid: string }>(client, 'POST', `/api/items/${refundsTask}/criteria`, { text: 'Refunds round half-even to the cent', kind: 'manual' });
    expect((await codex.callTool('submit_criterion', { criterion_uid: criterion.uid, evidence: [], note: 'Checked against the ledger' })).isError).toBeFalsy();
    await json(client, 'POST', `/api/criteria/${criterion.uid}/decide`, { decision: 'approved' });
    await new Promise((r) => setTimeout(r, 300));
    await json(client, 'PUT', `/api/items/${refundsTask}`, { status: 'done' });
    await expect.poll(async () => (await json<{ frames: Frame[] }>(client, 'GET', `/api/replay/frames?${q()}`)).frames.length, { timeout: 10_000 }).toBeGreaterThan(1);
    weekTo = Date.now();
  });

  test('120 days later, with a year kept: the week\'s frames, the code then, the stack then, and the Timeline\'s decisions with who', async () => {
    await codex.disconnect();
    await h.backend.stop();
    await startLater();
    // Months later, life goes on: new work joins the record.
    const today = createMcpClient({ mcpPort: later!.mcpPort, capabilityToken: later!.capabilityToken, clientName: 'codex', roots: [root] });
    await today.connect();
    expect((await today.callTool('list_plans', {})).isError).toBeFalsy();
    await today.disconnect();
    const now = (await json<{ events: Stored[] }>(client, 'GET', '/api/agent-events?limit=1')).events;
    expect(now.length).toBe(1);
    // Stamped months after the week: the clock really moved.
    expect(now[0].timestamp!).toBeGreaterThan(weekTo + LATER - DAY);

    // The cursor set to that week.
    const frames = (await json<{ frames: Frame[] }>(client, 'GET', `/api/replay/frames?${q()}&from=${weekFrom}&to=${weekTo}`)).frames;
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((f) => f.at >= weekFrom && f.at <= weekTo)).toBe(true);
    const graph = await client.raw('GET', `/api/trellis/${frames[0].sameAs ?? frames[0].id}`);
    expect(graph.status).toBe(200);

    // While the claim was held: both plans under way, the refunds task in progress (done now), the call waiting on a person.
    const then = await json<{ stack: { plans: Array<{ title: string; tasks: Array<{ title: string; status: string | null }> }> }; waiting: Array<{ agent: string }> }>(
      client, 'GET', `/api/replay/state?${q()}&at=${heldAt}`);
    expect(then.stack.plans.map((p) => p.title).sort()).toEqual(['Exports v2', 'Payments: refunds to the cent']);
    const refundsThen = then.stack.plans.find((p) => p.title === 'Payments: refunds to the cent')!;
    expect(refundsThen.tasks.map((t) => [t.title, t.status])).toEqual([['Round refunds half-even', 'in_progress']]);
    expect(then.waiting.map((w) => w.agent)).toEqual(['codex']);

    // The Timeline for that week: the breakpoint, the answer, and the approval, each with who.
    const week = (await json<{ events: Stored[] }>(client, 'GET', `/api/agent-events?since=${weekFrom}&before=${weekTo + 1}&limit=2000`)).events;
    const decided = week.filter((e) => ['breakpoint_hit', 'breakpoint_answered', 'criterion_decided'].includes(e.type));
    expect(decided.map((e) => e.type)).toEqual(['breakpoint_hit', 'breakpoint_answered', 'criterion_decided']);
    expect(decided[0].agentType).toBe('codex');
    expect(decided[1].payload).toMatchObject({ decision: 'continue', byType: 'unverified' });
    expect(decided[2].payload).toMatchObject({ decision: 'approved' });
  });

  test('the record says it is intact since that week; the week\'s evidence exports and verifies, the approval in it', async () => {
    const r = await json<RecordCheck>(client, 'GET', '/api/record');
    expect(r.ok, r.words).toBe(true);
    expect(r.words).toMatch(new RegExp(`^Intact: \\d+ entries since ${new Date(weekFrom).toISOString().slice(0, 10)} match the chain\\.$`));
    expect(r.trimmedThrough).toBe(0);

    const res = await client.raw('GET', `/api/evidence?${q()}&from=${weekFrom}&to=${weekTo}&format=html`);
    expect(res.status).toBe(200);
    evidencePage = await res.text();
    // Who approved it, as the record's other decisions say (plain HTTP here, so not "You").
    expect(evidencePage).toContain('Someone over the local API approved “Refunds round half-even to the cent”');
    expect(evidencePage).toContain('Paused at a breakpoint before claiming “Round refunds half-even”');
    const c = (await (await verify(evidencePage)).json()) as Check;
    expect(c.ok, c.words).toBe(true);
    expect(c.seal.state).toBe('this-computer');
    expect(c.here.state).toBe('matches');
  });

  test('the approval edited in the database since: the record names it, and so does the evidence exported before', async () => {
    const week = (await json<{ events: Stored[] }>(client, 'GET', `/api/agent-events?since=${weekFrom}&before=${weekTo + 1}&limit=2000`)).events;
    const approval = week.find((e) => e.type === 'criterion_decided')!;
    await later!.stop();
    later = null;
    const Database = require('better-sqlite3') as new (file: string) => { prepare: (sql: string) => { get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown }; close: () => void };
    const db = new Database(path.join(h.fixture.dataDir, 'data.db'));
    const row = db.prepare('SELECT payload FROM agent_events WHERE id = ?').get(approval.id) as { payload: string };
    db.prepare('UPDATE agent_events SET payload = ? WHERE id = ?').run(row.payload.replace('"approved"', '"sent_back"'), approval.id);
    const seq = (db.prepare('SELECT seq FROM record_chain WHERE event_id = ?').get(approval.id) as { seq: number }).seq;
    db.close();

    await startLater();
    const r = await json<RecordCheck>(client, 'GET', '/api/record');
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => [p.seq, p.kind, p.type])).toEqual([[seq, 'changed', 'criterion_decided']]);
    expect(r.words).toContain(`#${seq} (criterion decided`);

    const c = (await (await verify(evidencePage)).json()) as Check;
    expect(c.ok).toBe(false);
    expect(c.chain.ok, 'the page itself is intact').toBe(true);
    expect(c.here.state).toBe('differs');
    expect(c.here.words).toContain(`#${seq} (criterion decided`);
    expect(c.here.words).toContain('its content was changed in this computer\'s record since');
  });
});
