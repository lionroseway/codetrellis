/**
 * I1 "done when" (Phase 32 B7.7, JOURNEYS I1): the spec is wrong.
 *
 * The billing agent finds the invoice format cannot carry currency and
 * proposes a change to its Fields section, with the failing test as
 * evidence. Two other plans rely on that section. Their agents are told
 * once, never the proposer, and reply: "checkout: no change needed" and
 * "exports: one new column". Sam sees one proposal with both impacts and
 * accepts it. The page has a new version, as Sam; both plans' tasks are
 * marked "spec changed", and each agent is told once. The window (REST), an
 * MCP client and the phone agree on the proposal throughout.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type ScriptedAgent, type Phone } from '../harness';

const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n\n## Totals\n\nSum of lines.\n';
const NEW_FIELDS = '## Fields\n\n- amount\n- currency (ISO 4217)';
const PROPOSED = '── CodeTrellis: spec change proposed ──';
const CHANGED = '── CodeTrellis: spec changed ──';

interface Impact { impact: string; words: string; tasks: number | null; itemTitle: string | null; planTitle: string | null }
interface Proposal { uid: string; hitRef: string; status: string; affected: Array<{ itemUid: string }>; impacts: Impact[]; decidedBy: string | null; decidedByType: string | null }

test.describe.serial('I1: the spec is wrong', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let page: string;
  let phone: Phone;
  let proposal: Proposal;
  const tasks: Record<string, string> = {};
  const agents: Record<string, ScriptedAgent> = {};

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const get = async <T>(url: string) => (await (await h.client.raw('GET', url)).json()) as T;
  /** An agent's next call, as it would make one: its own task's spec links. */
  const nextCall = async (who: string) => (await agents[who].callTool('get_spec_links', { uid: tasks[who] })).text;
  const sortImpacts = (xs: Array<{ words: string }>) => xs.map((x) => x.words).sort();

  test.beforeAll(async () => {
    h = await setupHarness('conferring-i1');
    const root = h.fixture.projectPath;
    await h.client.scanProject(root);
    const spec = (await h.client.createPlan({ title: 'Invoicing spec', projectPath: root })).uid;
    page = await post(`/api/plans/${spec}/items`, { kind: 'object', title: 'Invoice format', body: BODY });
    const work: Array<[who: string, agentType: string, plan: string, title: string, relies: boolean]> = [
      ['billing', 'codex', 'Billing v2', 'Add currency', false],
      ['checkout', 'claude-code', 'Checkout', 'Show totals', true],
      ['exports', 'aider', 'Exports', 'Export invoices', true],
    ];
    for (const [who, agentType, plan, title, relies] of work) {
      const planUid = (await h.client.createPlan({ title: plan, projectPath: root })).uid;
      tasks[who] = await post(`/api/plans/${planUid}/items`, { kind: 'action', title });
      if (relies) expect((await h.client.raw('PUT', `/api/items/${tasks[who]}/relies-on`, { reliesOn: [{ page, section: 'fields' }] })).ok).toBe(true);
      agents[who] = await h.spawnAgent({ agentType });
      const claimed = await agents[who].callTool('claim_item', { uid: tasks[who], agent_type: agentType });
      expect(claimed.isError, claimed.text).toBeFalsy();
    }
    phone = await pairPhone(h.client, { alias: 'Sam’s phone' });
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    await h?.teardown();
  });

  test('the billing agent proposes the change with the failing test; two plans rely on that section', async () => {
    const r = await agents.billing.callTool('propose_spec_change', {
      page_uid: page, section: 'fields', text: NEW_FIELDS,
      why: 'The invoice format cannot carry currency; EU invoices are ambiguous.',
      evidence: { tests: ['invoice_eu.spec'], note: 'invoice_eu.spec fails: expected a currency field' },
    });
    expect(r.isError, r.text).toBeFalsy();
    const made = JSON.parse(r.answer) as { proposal: Proposal; next: string };
    proposal = made.proposal;
    expect(proposal.affected.map((a) => a.itemUid).sort()).toEqual([tasks.checkout, tasks.exports].sort());
    expect(made.next).toContain('2 tasks in 2 plans');
    expect((await get<{ body: string }>(`/api/items/${page}`)).body).toBe(BODY);
  });

  test('their agents are told once, never the proposer, and reply with the impact', async () => {
    for (const who of ['checkout', 'exports']) {
      expect(await nextCall(who)).toContain(PROPOSED);
      expect(await nextCall(who)).not.toContain(PROPOSED);
    }
    expect(await nextCall('billing')).not.toContain(PROPOSED);

    expect((await agents.checkout.callTool('reply_to_spec_proposal', { uid: proposal.uid, impact: 'none', words: 'checkout: no change needed' })).isError).toBeFalsy();
    expect((await agents.exports.callTool('reply_to_spec_proposal', { uid: proposal.uid, impact: 'changes', words: 'exports: one new column', tasks: 1 })).isError).toBeFalsy();
  });

  test('Sam sees one proposal with both impacts, and the window, an MCP client and the phone agree', async () => {
    const waiting = (await get<{ hits: Array<{ kind: string; breakpointTarget: string }> }>('/api/breakpoint-hits')).hits.filter((x) => x.kind === 'proposal');
    expect(waiting.map((x) => x.breakpointTarget)).toEqual([proposal.uid]);

    const rest = await get<Proposal>(`/api/spec-proposals/${proposal.uid}`);
    expect(rest.status).toBe('open');
    expect(sortImpacts(rest.impacts)).toEqual(['checkout: no change needed', 'exports: one new column']);
    expect(rest.impacts.map((i) => [i.planTitle, i.impact]).sort()).toEqual([['Checkout', 'none'], ['Exports', 'changes']]);

    const viaMcp = JSON.parse((await agents.billing.callTool('list_spec_proposals', { uid: proposal.uid })).answer) as { proposals?: Proposal[]; proposal?: Proposal };
    const mcp = viaMcp.proposal ?? viaMcp.proposals?.[0];
    expect(mcp?.status).toBe('open');
    expect(sortImpacts(mcp!.impacts)).toEqual(sortImpacts(rest.impacts));

    await phone.waitForState((s) => s.waitingBreakpoints === 1);
    const onPhone = (await phone.rpc<{ proposal: { status: string; replies: string; impacts: Array<{ words: string; label: string; who: string }> } }>('proposal.get', { uid: proposal.uid })).proposal;
    expect(onPhone.status).toBe('open');
    expect(onPhone.replies).toBe('2 tasks in 2 plans rely on this. 2 of 2 replied.');
    expect(sortImpacts(onPhone.impacts)).toEqual(sortImpacts(rest.impacts));
    expect(onPhone.impacts.map((i) => `${i.label} · ${i.who}`).sort()).toEqual(['Changes 1 task · Export invoices (Exports)', 'No impact · Show totals (Checkout)']);
  });

  test('Sam accepts: a new version as Sam, both tasks marked spec changed, each agent told once, the proposer told the outcome', async () => {
    const wait = agents.billing.callTool('await_decision', { ref: proposal.hitRef, wait_seconds: 20 });
    const res = await h.client.raw('POST', `/api/spec-proposals/${proposal.uid}/decision`, { decision: 'accept', note: 'Agreed; ISO codes only.' });
    expect(res.ok).toBe(true);
    const decided = (await res.json()) as { flagged: Array<{ itemUid: string }> };
    expect(decided.flagged.map((f) => f.itemUid).sort()).toEqual([tasks.checkout, tasks.exports].sort());

    const answer = JSON.parse((await wait).answer) as { decision: string; note: string };
    expect(answer).toMatchObject({ decision: 'accepted', note: 'Agreed; ISO codes only.' });
    expect((await get<{ body: string }>(`/api/items/${page}`)).body).toContain('- currency (ISO 4217)');

    for (const who of ['checkout', 'exports']) {
      const links = await get<{ specChanged: Array<{ proposalUid: string }> }>(`/api/items/${tasks[who]}/spec-links`);
      expect(links.specChanged.map((c) => c.proposalUid), who).toContain(proposal.uid);
      expect(await nextCall(who)).toContain(CHANGED);
      expect(await nextCall(who)).not.toContain(CHANGED);
    }

    // The same answer everywhere, and the decision is a person's.
    const rest = await get<Proposal>(`/api/spec-proposals/${proposal.uid}`);
    expect(rest).toMatchObject({ status: 'accepted', decidedByType: 'unverified' });
    const viaMcp = JSON.parse((await agents.exports.callTool('list_spec_proposals', { uid: proposal.uid })).answer) as { proposals?: Proposal[]; proposal?: Proposal };
    expect((viaMcp.proposal ?? viaMcp.proposals?.[0])?.status).toBe('accepted');
    expect((await phone.rpc<{ proposal: { status: string } }>('proposal.get', { uid: proposal.uid })).proposal.status).toBe('accepted');
    await phone.waitForState((s) => s.waitingBreakpoints === 0);
  });
});
