/**
 * Phase 32 B10.1 — the record, end to end: a real agent over MCP, the
 * running backend, a restart, and the database changed behind its back.
 *
 * An agent works; a person sets an architecture rule and stops it. Every
 * one of those is linked into the record as it is written, the person's
 * decisions included (who, and how the call arrived). The record walks
 * intact, for the window and for an agent asking, and still does after the
 * app restarts. Then someone edits a tool call in the database while the
 * app is closed: on the next start the walk names that entry, by number,
 * kind and agent.
 */

import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, startBackend, createClient, createMcpClient, type Harness, type RunningBackend, type ScriptedMcp } from '../harness';
import type { RecordCheck } from '../../src/shared/types/record';

interface Stored { id: string; type: string; agentType: string | null; payload: Record<string, unknown> }

test.describe.serial('The record', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let agent: ScriptedMcp;
  const running: RunningBackend[] = [];

  const record = async (client = h.client) => (await (await client.raw('GET', '/api/record')).json()) as RecordCheck;
  const events = async (client = h.client) =>
    ((await (await client.raw('GET', '/api/agent-events?limit=2000')).json()) as { events: Stored[] }).events;

  test.beforeAll(async () => {
    h = await setupHarness('record');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await agent.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    for (const b of running) await b.stop().catch(() => {});
    await h?.teardown();
  });

  test('what an agent did and what a person decided are both in the record, and it walks intact', async () => {
    expect((await agent.callTool('list_plans', {})).isError).toBeFalsy();
    const q = `project=${encodeURIComponent(root)}`;
    expect((await h.client.raw('PUT', `/api/rules/web-not-db?${q}`, { from: 'packages/web/', mayNotImport: 'services/', because: 'the web app calls the API' })).status).toBe(200);
    expect((await h.client.raw('DELETE', `/api/rules/web-not-db?${q}&confirm=1`)).status).toBe(200);

    await expect.poll(async () => (await events()).filter((e) => e.type === 'rule_changed').length, { timeout: 10_000 }).toBe(2);
    const rules = (await events()).filter((e) => e.type === 'rule_changed');
    // Who, from how the call arrived: the harness speaks plain HTTP, never the app window.
    expect(rules.map((e) => [e.payload.change, e.payload.authorType])).toEqual([['set', 'unverified'], ['stopped', 'unverified']]);
    expect(rules[0].payload).toMatchObject({ ruleId: 'web-not-db', from: 'packages/web/', mayNotImport: 'services/', because: 'the web app calls the API' });

    const r = await record();
    expect(r.ok, r.words).toBe(true);
    expect(r.entries).toBe((await events()).length);
    expect(r.head.seq).toBe(r.entries);
    expect(r.head.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.words).toMatch(/^Intact: \d+ entries since \d{4}-\d{2}-\d{2} match the chain\.$/);
  });

  test('an agent asks the same question and gets the same answer', async () => {
    const res = await agent.callTool('verify_record', {});
    expect(res.isError, res.text).toBeFalsy();
    const j = JSON.parse(res.text) as { ok: boolean; words: string; entries: number; head: { seq: number } };
    expect(j.ok).toBe(true);
    expect(j.words).toMatch(/^Intact: /);
    // Its own call joins the record after the walk.
    expect(j.entries).toBeGreaterThan(0);
  });

  test('after a restart the record still walks, and goes on from where it was', async () => {
    const before = await record();
    await h.backend.stop();
    const b = await startBackend({ dataDir: h.fixture.dataDir });
    running.push(b);
    const client = createClient(b.baseUrl, b.capabilityToken);
    const after = await record(client);
    expect(after.ok, after.words).toBe(true);
    expect(after.head).toEqual(before.head);

    await client.scanProject(root);
    const again = createMcpClient({ mcpPort: b.mcpPort, capabilityToken: b.capabilityToken, clientName: 'codex', roots: [root] });
    await again.connect();
    await again.callTool('list_plans', {});
    await again.disconnect();
    await expect.poll(async () => (await record(client)).head.seq, { timeout: 10_000 }).toBeGreaterThan(before.head.seq);
    expect((await record(client)).ok).toBe(true);
    await b.stop();
    running.pop();
  });

  test('a tool call edited in the database while the app was closed is named on the next start', async () => {
    const Database = require('better-sqlite3') as new (file: string) => { prepare: (sql: string) => { get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown }; close: () => void };
    const db = new Database(path.join(h.fixture.dataDir, 'data.db'));
    const target = db.prepare(`SELECT c.seq AS seq, e.id AS id FROM agent_events e JOIN record_chain c ON c.event_id = e.id
      WHERE e.type = 'tool_call' AND e.agent_type = 'codex' ORDER BY c.seq ASC LIMIT 1`).get() as { seq: number; id: string };
    db.prepare('UPDATE agent_events SET payload = ? WHERE id = ?').run(JSON.stringify({ tool: 'delete_plan', args: '{}' }), target.id);
    db.close();

    const b = await startBackend({ dataDir: h.fixture.dataDir });
    running.push(b);
    const r = await record(createClient(b.baseUrl, b.capabilityToken));
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => [p.seq, p.kind, p.type, p.agentType])).toEqual([[Number(target.seq), 'changed', 'tool_call', 'codex']]);
    expect(r.words).toContain(`#${target.seq} (tool call by codex, `);
    expect(r.words).toContain('its content changed after it was written');
  });
});
