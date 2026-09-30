/**
 * Phase 32 B7.6 — a proposed spec change, decided from the phone (JOURNEYS I1).
 *
 * Away from the desk: the billing agent proposes a new Fields section for
 * "Invoice format"; the checkout agent, whose task relies on it, replies that
 * it changes one task. Sam's phone counts it, lists it in Waiting on you, and
 * reads it in the desktop's words, with the reply beside it. It cannot be
 * answered like a held call. Sam accepts it from the phone with a note: the
 * page has its new version, as Sam; the relying task says "spec changed";
 * the proposer's wait returns accepted with the note; the window is told.
 * A phone allowed only to read sees it and cannot decide it.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, openEventStream, pairPhone, type Harness, type ScriptedAgent, type Phone, type EventStream } from '../harness';

const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n';
const NEW_FIELDS = '## Fields\n\n- amount\n- currency';

interface PhoneHit { ref: string; proposalUid: string | null; headline: string; why: string; labels: Record<string, string> }
interface PhoneProposal {
  uid: string; hitRef: string; status: string; headline: string; why: string; evidence: string; before: string; proposed: string;
  replies: string; impacts: Array<{ impact: string; label: string; who: string; words: string }>; decisionNote: string | null;
}

test.describe.serial('A spec change decided from the phone', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let page: string;
  let showTotals: string;
  let billing: ScriptedAgent;
  let checkout: ScriptedAgent;
  let phone: Phone;
  let events: EventStream;
  let proposal: { uid: string; hitRef: string };

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const get = async <T>(url: string) => (await (await h.client.raw('GET', url)).json()) as T;

  test.beforeAll(async () => {
    h = await setupHarness('phone-proposals');
    const root = h.fixture.projectPath;
    await h.client.scanProject(root);
    const spec = (await h.client.createPlan({ title: 'Invoicing spec', projectPath: root })).uid;
    page = await post(`/api/plans/${spec}/items`, { kind: 'object', title: 'Invoice format', body: BODY });
    const checkoutPlan = (await h.client.createPlan({ title: 'Checkout', projectPath: root })).uid;
    const billingPlan = (await h.client.createPlan({ title: 'Billing v2', projectPath: root })).uid;
    showTotals = await post(`/api/plans/${checkoutPlan}/items`, { kind: 'action', title: 'Show totals' });
    const addCurrency = await post(`/api/plans/${billingPlan}/items`, { kind: 'action', title: 'Add currency' });
    expect((await h.client.raw('PUT', `/api/items/${showTotals}/relies-on`, { reliesOn: [{ page, section: 'fields' }] })).ok).toBe(true);
    billing = await h.spawnAgent({ agentType: 'codex' });
    checkout = await h.spawnAgent({ agentType: 'claude-code' });
    expect((await billing.callTool('claim_item', { uid: addCurrency, agent_type: 'codex' })).isError).toBeFalsy();
    expect((await checkout.callTool('claim_item', { uid: showTotals, agent_type: 'claude-code' })).isError).toBeFalsy();
    events = await openEventStream(h.backend);
    phone = await pairPhone(h.client, { alias: 'Sam’s phone' });
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    events?.close();
    await h?.teardown();
  });

  test('proposed and replied to: the phone counts it and lists it, in the desktop\'s words', async () => {
    const made = JSON.parse((await billing.callTool('propose_spec_change', {
      page_uid: page, section: 'fields', text: NEW_FIELDS, why: 'Amounts are ambiguous for EU customers.', evidence: { tests: ['invoice_eu.spec'] },
    })).answer) as { proposal: { uid: string; hitRef: string } };
    proposal = made.proposal;
    await checkout.callTool('get_spec_links', { uid: showTotals }); // told on its next call
    expect((await checkout.callTool('reply_to_spec_proposal', { uid: proposal.uid, impact: 'changes', words: 'The totals row must show the currency.', tasks: 1 })).isError).toBeFalsy();

    await phone.waitForState((s) => s.waitingBreakpoints === 1);
    const { hits } = await phone.rpc<{ hits: PhoneHit[] }>('breakpoint.waiting');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ref: proposal.hitRef, proposalUid: proposal.uid, labels: { continue: 'Accept', stop: 'Reject' } });

    const { proposals } = await phone.rpc<{ proposals: PhoneProposal[] }>('proposal.list');
    expect(proposals.map((p) => p.uid)).toEqual([proposal.uid]);
    const { proposal: read } = await phone.rpc<{ proposal: PhoneProposal }>('proposal.get', { uid: proposal.uid });
    expect(read).toMatchObject({
      headline: '✎ codex proposes a change to § Fields of “Invoice format”',
      why: 'Amounts are ambiguous for EU customers.', evidence: 'tests invoice_eu.spec',
      before: '## Fields\n\n- amount\n', proposed: NEW_FIELDS,
      replies: '1 task in 1 plan relies on this. 1 of 1 replied.', status: 'open',
    });
    expect(read.impacts).toEqual([{ impact: 'changes', label: 'Changes 1 task', who: 'Show totals (Checkout)', words: 'The totals row must show the currency.' }]);
  });

  test('it is decided on the proposal, not answered like a held call', async () => {
    expect(await phone.rpcError('breakpoint.answer', { ref: proposal.hitRef, decision: 'continue' })).toMatch(/decided on the proposal/);
    expect(await phone.rpcError('proposal.decide', { uid: proposal.uid, decision: 'amend', text: 'x' })).toMatch(/amending it is done in the window/);
  });

  test('a phone allowed only to read sees it and cannot decide it', async () => {
    await phone.grant(['read']);
    expect((await phone.rpc<{ proposals: PhoneProposal[] }>('proposal.list')).proposals).toHaveLength(1);
    expect(await phone.rpcError('proposal.decide', { uid: proposal.uid, decision: 'accept' })).toMatch(/write/i);
    await phone.grant(['read', 'write']);
  });

  test('accepted from the phone: a new version as the person, the task says spec changed, the proposer is answered', async () => {
    const wait = billing.callTool('await_decision', { ref: proposal.hitRef, wait_seconds: 20 });
    const told = events.waitFor('spec-proposal-decided', (p) => p.uid === proposal.uid);
    const r = await phone.rpc<{ proposal: PhoneProposal; flagged: number; alreadyDecided?: true }>('proposal.decide', {
      uid: proposal.uid, decision: 'accept', note: 'Name the standard next time.', author: 'Priya',
    });
    expect(r.alreadyDecided).toBeUndefined();
    expect(r).toMatchObject({ flagged: 1, proposal: { status: 'accepted', decisionNote: 'Name the standard next time.' } });
    expect(await told).toMatchObject({ uid: proposal.uid, status: 'accepted', pageUid: page });

    const answer = JSON.parse((await wait).answer) as { status: string; decision: string; note: string | null };
    expect(answer).toMatchObject({ status: 'answered', decision: 'accepted', note: 'Name the standard next time.' });
    expect((await get<{ body: string }>(`/api/items/${page}`)).body).toContain('- currency');
    const stored = await get<{ decidedBy: string; decidedByType: string }>(`/api/spec-proposals/${proposal.uid}`);
    expect(stored.decidedByType).toBe('human');
    expect(stored.decidedBy).not.toBe('Priya');
    const links = await get<{ specChanged: Array<{ proposalUid: string }> }>(`/api/items/${showTotals}/spec-links`);
    expect(links.specChanged.map((c) => c.proposalUid)).toContain(proposal.uid);

    await phone.waitForState((s) => s.waitingBreakpoints === 0);
    expect((await phone.rpc<{ hits: PhoneHit[] }>('breakpoint.waiting')).hits).toEqual([]);
    const again = await phone.rpc<{ proposal: PhoneProposal; alreadyDecided?: true }>('proposal.decide', { uid: proposal.uid, decision: 'reject' });
    expect(again).toMatchObject({ alreadyDecided: true, proposal: { status: 'accepted' } });
  });
});
