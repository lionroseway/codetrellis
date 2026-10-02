/**
 * Phase 32 B10.4 — the evidence export, end to end.
 *
 * An agent works on a plan and a person decides things: a breakpoint on a
 * task holds the agent, the person says continue, and sets an architecture
 * rule. The plan's evidence is exported, signed: the record's entries with
 * the link before them, the decisions in words, the stack at both ends, the
 * sign-off pack. It verifies as JSON and as the saved page. The same window
 * asked for by an agent is the same package. A page with one decision
 * edited is refused. Then a tool call is changed in the database while the
 * app is closed: on the next start, the evidence exported before names it.
 */

import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, startBackend, type Harness, type RunningBackend, type ScriptedMcp } from '../harness';

interface Entry { seq: number; hash: string; digest: string; event: { id: string; type: string; agentType: string | null; payload: string } | null }
interface Evidence {
  format: string;
  window: { from: number; to: number; plan: { uid: string; title: string } | null; words: string };
  record: { before: { seq: number; hash: string }; through: { seq: number; hash: string }; entries: Entry[] };
  start: { stack: { plans: Array<{ title: string }> } };
  end: { stack: { plans: Array<{ title: string; tasks: Array<{ title: string; status: string | null }> }> } };
  decisions: Array<{ seq: number; type: string; words: string }>;
  signoffPack: { plan: { uid: string } } | null;
  seal: { key: string };
}
interface Check { ok: boolean; seal: { state: string; words: string }; chain: { ok: boolean; words: string }; here: { state: string; words: string }; words: string }

test.describe.serial('The evidence export', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let agent: ScriptedMcp;
  let planUid: string;
  let exported: Evidence;
  let page: string;
  const running: RunningBackend[] = [];

  const verify = (baseUrl: string, token: string, text: string) => fetch(baseUrl + '/api/evidence/verify', {
    method: 'POST', headers: { 'content-type': 'text/plain', 'x-codetrellis-token': token }, body: text,
  });

  test.beforeAll(async () => {
    h = await setupHarness('evidence');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'codex' });
    planUid = (await h.client.createPlan({ title: 'Refunds to the cent', projectPath: root })).uid;
    const item = ((await (await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Round refunds' })).json()) as { uid: string }).uid;

    // A breakpoint on the task: the agent's claim is held, the person says continue, the claim goes through.
    expect((await h.client.raw('POST', '/api/breakpoints', { kind: 'task', itemUid: item })).status).toBe(201);
    const held = await agent.callTool('claim_item', { uid: item });
    expect(held.isError, held.text).toBeFalsy();
    const ref = String((JSON.parse(held.text) as { ref: string }).ref);
    expect((await h.client.raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'continue' })).status).toBe(200);
    expect((await agent.callTool('claim_item', { uid: item })).isError).toBeFalsy();
    expect((await agent.callTool('list_plans', {})).isError).toBeFalsy();
    // And a rule, set by the person.
    expect((await h.client.raw('PUT', `/api/rules/web-not-db?project=${encodeURIComponent(root)}`, { from: 'packages/web/', mayNotImport: 'services/', because: 'the web app calls the API' })).status).toBe(200);
  });

  test.afterAll(async () => {
    for (const b of running) await b.stop().catch(() => {});
    await h?.teardown();
  });

  test('a plan\'s evidence: its entries chain from the link before, with the decisions in words, the stack and the pack; signed', async () => {
    await expect.poll(async () => {
      const e = (await (await h.client.raw('GET', `/api/evidence?plan=${planUid}`)).json()) as Evidence;
      return e.decisions.map((d) => d.type);
    }, { timeout: 10_000 }).toEqual(['breakpoint_hit', 'breakpoint_answered', 'rule_changed']);
    const res = await h.client.raw('GET', `/api/evidence?plan=${planUid}`);
    expect(res.status).toBe(200);
    exported = (await res.json()) as Evidence;
    expect(exported.format).toBe('codetrellis-evidence');
    expect(exported.window.plan).toEqual({ uid: planUid, title: 'Refunds to the cent' });
    expect(exported.seal.key).toMatch(/^SHA256:/);
    const seqs = exported.record.entries.map((e) => e.seq);
    expect(seqs[0]).toBe(exported.record.before.seq + 1);
    expect(seqs).toEqual(seqs.map((_, i) => seqs[0] + i));
    expect(exported.decisions.map((d) => d.words)).toEqual([
      'Paused at a breakpoint before claiming “Round refunds”',
      'Someone said continue claiming “Round refunds”',
      'Someone over the local API set the architecture rule “packages/web/ may not import services/”',
    ]);
    expect(exported.end.stack.plans.map((p) => p.title)).toEqual(['Refunds to the cent']);
    expect(exported.end.stack.plans[0].tasks.map((t) => t.title)).toEqual(['Round refunds']);
    expect(exported.signoffPack?.plan.uid).toBe(planUid);
    // The agent's calls are in it, by whom.
    expect(exported.record.entries.some((e) => e.event?.type === 'tool_call' && e.event.agentType === 'codex')).toBe(true);
  });

  test('it verifies, as JSON and as the saved page', async () => {
    const asJson = (await (await verify(h.backend.baseUrl, h.backend.capabilityToken, JSON.stringify(exported))).json()) as Check;
    expect(asJson.ok, asJson.words).toBe(true);
    expect(asJson.seal.state).toBe('this-computer');
    expect(asJson.chain.words).toMatch(/^Its \d+ record entries \(#\d+ to #\d+\) recompute into one unbroken chain\.$/);
    expect(asJson.here.state).toBe('matches');

    const res = await h.client.raw('GET', `/api/evidence?plan=${planUid}&format=html`);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="evidence-Refunds-to-the-cent.html"');
    page = await res.text();
    expect(page).toContain('Breakpoints and decisions');
    const asPage = (await (await verify(h.backend.baseUrl, h.backend.capabilityToken, page)).json()) as Check;
    expect(asPage.ok, asPage.words).toBe(true);
  });

  test('an agent asks for the same window and gets the same entries, signed by the same computer', async () => {
    const r = await agent.callTool('export_evidence', { project_path: root, from: exported.window.from, to: exported.window.to });
    expect(r.isError, r.text).toBeFalsy();
    const e = JSON.parse(r.text) as Evidence;
    expect(e.seal.key).toBe(exported.seal.key);
    expect(e.record.entries.map((x) => x.hash)).toEqual(exported.record.entries.map((x) => x.hash));
    const c = (await (await verify(h.backend.baseUrl, h.backend.capabilityToken, r.text)).json()) as Check;
    expect(c.ok, c.words).toBe(true);
  });

  test('a page with a decision edited is refused: the seal fails and the chain names the entry', async () => {
    const said = exported.decisions[1];
    const entry = exported.record.entries.find((e) => e.seq === said.seq)!;
    // The person's "continue" turned into a "stop", inside the page's data.
    const was = JSON.stringify(entry.event!.payload).slice(1, -1);
    const forged = page.replace(was, was.replace('continue', 'stop'));
    expect(forged).not.toBe(page);
    const c = (await (await verify(h.backend.baseUrl, h.backend.capabilityToken, forged)).json()) as Check;
    expect(c.ok).toBe(false);
    expect(c.seal.state).toBe('changed');
    expect(c.chain.ok).toBe(false);
    expect(c.chain.words).toContain(`#${said.seq} (breakpoint answered by unverified, `);
    expect(c.chain.words).toContain('its event does not match its digest');
  });

  test('bad requests say what is wrong; a project not opened is refused', async () => {
    expect((await h.client.raw('GET', '/api/evidence?plan=no-such-plan')).status).toBe(404);
    const backwards = await h.client.raw('GET', `/api/evidence?project=${encodeURIComponent(root)}&from=20&to=10`);
    expect(backwards.status).toBe(400);
    expect(((await backwards.json()) as { error: string }).error).toBe('from must be before to');
    expect((await h.client.raw('GET', `/api/evidence?project=${encodeURIComponent('/not/opened')}&from=0&to=10`)).status).toBe(403);
    const notEvidence = await verify(h.backend.baseUrl, h.backend.capabilityToken, '{"format":"codetrellis-signoff-pack"}');
    expect(notEvidence.status).toBe(400);
    expect(((await notEvidence.json()) as { error: string }).error).toBe('That file is not a CodeTrellis evidence export');
  });

  test('a tool call changed in the database while the app was closed: the evidence exported before names it', async () => {
    const target = exported.record.entries.find((e) => e.event?.type === 'tool_call' && e.event.agentType === 'codex')!;
    await h.backend.stop();
    const Database = require('better-sqlite3') as new (file: string) => { prepare: (sql: string) => { run: (...a: unknown[]) => unknown }; close: () => void };
    const db = new Database(path.join(h.fixture.dataDir, 'data.db'));
    db.prepare('UPDATE agent_events SET payload = ? WHERE id = ?').run(JSON.stringify({ tool: 'delete_plan', args: '{}' }), target.event!.id);
    db.close();

    const b = await startBackend({ dataDir: h.fixture.dataDir });
    running.push(b);
    const c = (await (await verify(b.baseUrl, b.capabilityToken, page)).json()) as Check;
    expect(c.seal.state).toBe('this-computer');
    expect(c.chain.ok, 'the page itself is intact').toBe(true);
    expect(c.here.state).toBe('differs');
    expect(c.ok).toBe(false);
    expect(c.here.words).toContain(`#${target.seq} (tool call by codex, `);
    expect(c.here.words).toContain('its content was changed in this computer\'s record since');
  });
});
