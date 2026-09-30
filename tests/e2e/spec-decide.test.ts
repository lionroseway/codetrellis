/**
 * Phase 32 B7.4 — the decision on a spec change is a person's (JOURNEYS I1).
 *
 * The billing agent proposes a new Fields section for "Invoice format". The
 * proposal waits in the person's inbox as a `proposal` breakpoint hit, and
 * the agent can await_decision on it. It cannot be answered like a held
 * call, and no MCP tool decides it. Accepting writes the page's new version
 * as the person and flags the two tasks relying on Fields "spec changed";
 * each agent holding one is told once, and the proposer is told the outcome.
 * A rejection leaves the page and tells the proposer why. Amend accepts the
 * person's own text.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n\n## Totals\n\nSum of lines.\n';
const NEW_FIELDS = '## Fields\n\n- amount\n- currency (ISO 4217, required)';

interface Hit { ref: string; kind: string; action: string; breakpointTarget: string; answeredAt: number | null }
interface Proposal { uid: string; hitRef: string; status: string; decidedBy: string | null; decisionNote: string | null; decidedText: string | null }

test.describe.serial('A person decides a spec change', () => {
  let h: Harness;
  let root: string;
  let page: string;
  let proposal: Proposal;
  const plans: Record<string, string> = {};
  const tasks: Record<string, string> = {};
  const agents: Record<string, ScriptedAgent> = {};

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const get = async <T>(url: string) => (await (await h.client.raw('GET', url)).json()) as T;
  const pageBody = async () => (await get<{ body: string }>(`/api/items/${page}`)).body;
  const nextCall = (who: string) => agents[who].callTool('get_spec_links', { uid: tasks[who] });
  const propose = async (who: string, section: string, text: string, why: string) => {
    const r = await agents[who].callTool('propose_spec_change', { page_uid: page, section, text, why });
    expect(r.isError, r.text).toBeFalsy();
    return JSON.parse(r.answer) as { proposal: Proposal; next: string };
  };
  const decide = (uid: string, body: Record<string, unknown>) => h.client.raw('POST', `/api/spec-proposals/${uid}/decision`, body);
  /** The proposer's await_decision: its answer, and the whole text (a notice can ride on it). */
  const awaitDecision = async (ref: string) => {
    const r = await agents.billing.callTool('await_decision', { ref, wait_seconds: 0 });
    return { ...(JSON.parse(r.answer) as { status: string; decision?: string; note?: string | null; message?: string }), text: r.text };
  };

  test.beforeAll(async () => {
    h = await setupHarness('spec-decide');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    const spec = (await h.client.createPlan({ title: 'Invoicing spec', projectPath: root })).uid;
    page = await post(`/api/plans/${spec}/items`, { kind: 'object', title: 'Invoice format', body: BODY });
    for (const t of ['Billing v2', 'Checkout', 'Exports']) plans[t] = (await h.client.createPlan({ title: t, projectPath: root })).uid;
    const work: Array<[who: string, agentType: string, plan: string, title: string, reliesOn: unknown[]]> = [
      ['billing', 'codex', 'Billing v2', 'Add currency', []],
      ['checkout', 'claude-code', 'Checkout', 'Show totals', [{ page, section: 'fields' }]],
      ['exports', 'aider', 'Exports', 'Export invoices', [{ page }]],
    ];
    for (const [who, agentType, plan, title, reliesOn] of work) {
      tasks[who] = await post(`/api/plans/${plans[plan]}/items`, { kind: 'action', title });
      if (reliesOn.length) expect((await h.client.raw('PUT', `/api/items/${tasks[who]}/relies-on`, { reliesOn })).ok).toBe(true);
      agents[who] = await h.spawnAgent({ agentType });
      const claimed = await agents[who].callTool('claim_item', { uid: tasks[who], agent_type: agentType });
      expect(claimed.isError, claimed.text).toBeFalsy();
    }
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('a proposal waits in the inbox, and the proposer can await it', async () => {
    const made = await propose('billing', 'fields', NEW_FIELDS, 'Amounts are ambiguous for EU customers.');
    proposal = made.proposal;
    expect(proposal.hitRef).toMatch(/^bp-/);
    expect(made.next).toContain(`await_decision("${proposal.hitRef}")`);

    const waiting = (await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits;
    expect(waiting.find((x) => x.ref === proposal.hitRef)).toMatchObject({ kind: 'proposal', action: 'propose', breakpointTarget: proposal.uid, answeredAt: null });
    expect((await awaitDecision(proposal.hitRef)).status).toBe('waiting');
    // A breakpoint of this kind is raised, never set by hand.
    expect((await h.client.raw('POST', '/api/breakpoints', { kind: 'proposal', itemUid: page })).status).toBe(400);
  });

  test('it is not answered like a held call, and no MCP tool decides it', async () => {
    const r = await h.client.raw('POST', `/api/breakpoint-hits/${proposal.hitRef}/answer`, { decision: 'continue' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain('decided on the proposal');
    // Nor cleared, which would let it through with nobody deciding.
    const bps = (await get<{ breakpoints: Array<{ id: string; kind: string; target: string }> }>('/api/breakpoints')).breakpoints;
    const bp = bps.find((b) => b.kind === 'proposal' && b.target === proposal.uid)!;
    expect(bp).toBeTruthy();
    expect((await h.client.raw('DELETE', `/api/breakpoints/${bp.id}`)).status).toBe(400);
    const names = (await agents.billing.mcp.listTools()).map((t) => t.name);
    // What an agent can do with a proposal: make one, read them, reply. Nothing decides one.
    expect(names.filter((n) => /spec_propos|propose_spec/.test(n)).sort()).toEqual(['list_spec_proposals', 'propose_spec_change', 'reply_to_spec_proposal']);
    // Replying weighs in and decides nothing.
    expect((await agents.checkout.callTool('reply_to_spec_proposal', { uid: proposal.uid, impact: 'none' })).isError).toBeFalsy();
    const still = JSON.parse((await agents.billing.callTool('list_spec_proposals', { uid: proposal.uid })).answer) as { proposals: Proposal[] };
    expect(still.proposals[0].status).toBe('open');
    expect(await pageBody()).toBe(BODY);
  });

  test('accept writes the new version as the person and flags the relying tasks', async () => {
    const r = await decide(proposal.uid, { decision: 'accept', note: 'Agreed: EU invoices need it.' });
    expect(r.ok).toBe(true);
    const body = (await r.json()) as { proposal: Proposal; flagged: Array<{ title: string }> };
    expect(body.proposal).toMatchObject({ status: 'accepted', decisionNote: 'Agreed: EU invoices need it.', decidedText: null });
    expect(body.proposal.decidedBy).toBeTruthy();
    expect(body.flagged.map((t) => t.title).sort()).toEqual(['Export invoices', 'Show totals']);
    expect(await pageBody()).toContain('- currency (ISO 4217, required)');
    expect(await pageBody()).toContain('## Totals\n\nSum of lines.');

    const events = await get<Array<{ itemUid: string; eventType: string; summary: string }>>(`/api/plans/${plans.Checkout}/timeline?kinds=spec_changed`);
    expect(events.map((e) => [e.itemUid, e.eventType])).toEqual([[tasks.checkout, 'spec_changed']]);
    const flags = await get<{ specChanged: Array<{ proposalUid: string; toldAt: number | null }> }>(`/api/items/${tasks.checkout}/spec-links`);
    expect(flags.specChanged).toMatchObject([{ proposalUid: proposal.uid, toldAt: null }]);
    expect((await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits.some((x) => x.ref === proposal.hitRef)).toBe(false);
  });

  test('each relying agent is told once; the proposer hears the outcome', async () => {
    for (const [who, task] of [['checkout', 'Show totals'], ['exports', 'Export invoices']]) {
      const first = await nextCall(who);
      expect(first.text).toContain('── CodeTrellis: spec changed ──');
      expect(first.text).toContain(`Your task "${task}" relies on it.`);
      expect(first.text).toContain('Their note: Agreed: EU invoices need it.');
      expect(first.text).toContain('> - currency (ISO 4217, required)');
      expect((await nextCall(who)).text).not.toContain('spec changed ──');
    }
    const flags = await get<{ specChanged: Array<{ toldAt: number | null }> }>(`/api/items/${tasks.checkout}/spec-links`);
    expect(flags.specChanged[0].toldAt).toBeTruthy();

    // The proposer is told on its next call, which here is the wait itself.
    const told = await awaitDecision(proposal.hitRef);
    expect(told).toMatchObject({ status: 'answered', decision: 'accepted', note: 'Agreed: EU invoices need it.' });
    expect(told.text).toContain('── CodeTrellis: spec proposal decided ──');
    expect(told.text).toContain('Your proposal to change § Fields of "Invoice format" was accepted; the page has its new version.');
    expect((await nextCall('billing')).text).not.toContain('spec proposal decided');
  });

  test('reject leaves the page and tells the proposer why; a decision stands', async () => {
    const before = await pageBody();
    const { proposal: p } = await propose('billing', 'totals', '## Totals\n\nSum of lines, per currency.', 'Mixed currencies cannot be summed.');
    expect((await decide(p.uid, { decision: 'reject', note: 'Totals stay per invoice.' })).ok).toBe(true);
    expect(await pageBody()).toBe(before);
    const told = await awaitDecision(p.hitRef);
    expect(told).toMatchObject({ decision: 'rejected', note: 'Totals stay per invoice.' });
    expect(told.text).toContain('Your proposal to change § Totals of "Invoice format" was not accepted. Their note: Totals stay per invoice.');
    // Nothing relies on Totals, and nothing was flagged.
    expect((await get<{ specChanged: unknown[] }>(`/api/items/${tasks.checkout}/spec-links`)).specChanged).toHaveLength(1);
    const again = await decide(p.uid, { decision: 'accept' });
    expect(again.status).toBe(409);
  });

  test('amend accepts the person\'s own text', async () => {
    const { proposal: p } = await propose('billing', 'fields', '## Fields\n\n- amount\n- currency\n- tax', 'Tax belongs on the invoice.');
    expect((await decide(p.uid, { decision: 'amend' })).status).toBe(400);
    const amended = '## Fields\n\n- amount\n- currency (ISO 4217, required)\n- tax_rate (percent)';
    const r = await decide(p.uid, { decision: 'amend', text: amended });
    expect(r.ok).toBe(true);
    expect(((await r.json()) as { proposal: Proposal }).proposal).toMatchObject({ status: 'accepted', decidedText: amended });
    expect(await pageBody()).toContain('- tax_rate (percent)');
    const told = await nextCall('checkout');
    expect(told.text).toContain('a person accepted codex\'s proposal, with changes');
    expect(told.text).toContain('> - tax_rate (percent)');
  });

  test('a proposal whose plan is deleted is withdrawn, and waits on nobody', async () => {
    const { proposal: p } = await propose('billing', 'totals', '## Totals\n\nSum of lines, rounded.', 'Rounding is unspecified.');
    const spec = (await get<{ planUid: string }>(`/api/items/${page}`)).planUid;
    expect((await h.client.raw('DELETE', `/api/plans/${spec}?disk=false`)).ok).toBe(true);
    const after = JSON.parse((await agents.checkout.callTool('list_spec_proposals', { uid: p.uid })).answer) as { proposals: Array<Proposal & { decisionNote: string }> };
    expect(after.proposals[0]).toMatchObject({ status: 'withdrawn', decisionNote: 'The plan was deleted.' });
    expect((await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits.some((x) => x.ref === p.hitRef)).toBe(false);
  });
});
