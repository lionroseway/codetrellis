/**
 * Phase 32 B7.3 — the agents a spec change affects are told, once, and say
 * what it would mean for their work (JOURNEYS I1).
 *
 * The billing agent, working "Add currency", proposes a new Fields section
 * for "Invoice format". The checkout agent ("Show totals" relies on Fields)
 * and the exports agent ("Export invoices" relies on the whole page) are
 * each told on their next call, and only once. The agent on "Sum lines"
 * (relies on Totals) is not told, and neither is the proposer, although
 * "Add currency" relies on the whole page too. Their replies are kept with
 * who and which plan, and posted as weigh-ins in Billing v2.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n\n## Totals\n\nSum of lines.\n';
const HEADER = '── CodeTrellis: spec change proposed ──';

interface Impact { impact: string; words: string; tasks: number | null; itemTitle: string | null; planTitle: string | null; author: string; sessionId: string | null }
interface ChannelEvent { eventType: string; itemUid: string | null; author: string; payload: { message: string } }

test.describe.serial('Told once about a spec change, and weighing in', () => {
  let h: Harness;
  let root: string;
  let page: string;
  let proposal: string;
  const plans: Record<string, string> = {};
  const tasks: Record<string, string> = {};
  const agents: Record<string, ScriptedAgent> = {};

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  /** Any read-only call, to see what rides on its result. */
  const nextCall = (who: string) => agents[who].callTool('get_spec_links', { uid: tasks[who] });

  test.beforeAll(async () => {
    h = await setupHarness('spec-impacts');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    const spec = (await h.client.createPlan({ title: 'Invoicing spec', projectPath: root })).uid;
    page = await post(`/api/plans/${spec}/items`, { kind: 'object', title: 'Invoice format', body: BODY });
    for (const t of ['Billing v2', 'Checkout', 'Exports']) plans[t] = (await h.client.createPlan({ title: t, projectPath: root })).uid;

    const work: Array<[who: string, agentType: string, plan: string, title: string, reliesOn: unknown]> = [
      ['billing', 'codex', 'Billing v2', 'Add currency', [{ page }]],
      ['checkout', 'claude-code', 'Checkout', 'Show totals', [{ page, section: 'fields' }]],
      ['exports', 'aider', 'Exports', 'Export invoices', [{ page }]],
      ['totals', 'cursor', 'Billing v2', 'Sum lines', [{ page, section: 'totals' }]],
    ];
    for (const [who, agentType, plan, title, reliesOn] of work) {
      tasks[who] = await post(`/api/plans/${plans[plan]}/items`, { kind: 'action', title });
      expect((await h.client.raw('PUT', `/api/items/${tasks[who]}/relies-on`, { reliesOn })).ok).toBe(true);
      agents[who] = await h.spawnAgent({ agentType });
      const claimed = await agents[who].callTool('claim_item', { uid: tasks[who], agent_type: agentType });
      expect(claimed.isError, claimed.text).toBeFalsy();
    }

    const r = await agents.billing.callTool('propose_spec_change', {
      page_uid: page, section: 'fields', text: '## Fields\n\n- amount\n- currency (ISO 4217, required)',
      why: 'Amounts are ambiguous for EU customers.', evidence: { tests: ['invoice_eu.spec'] },
    });
    expect(r.isError, r.text).toBeFalsy();
    proposal = (JSON.parse(r.answer) as { proposal: { uid: string } }).proposal.uid;
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('each agent whose task relies on the section is told on its next call, once', async () => {
    for (const [who, task, plan] of [['checkout', 'Show totals', 'Checkout'], ['exports', 'Export invoices', 'Exports']]) {
      const first = await nextCall(who);
      expect(first.isError, first.text).toBeFalsy();
      expect(first.text).toContain(HEADER);
      expect(first.text).toContain(`codex proposes a change to § Fields of "Invoice format". Your task "${task}" (${plan}) relies on it.`);
      expect(first.text).toContain('Why: Amounts are ambiguous for EU customers.');
      expect(first.text).toContain('Evidence: tests invoice_eu.spec');
      expect(first.text).toContain('> - currency (ISO 4217, required)');
      expect(first.text).toContain(`reply_to_spec_proposal("${proposal}"`);
      // The tool's own answer is untouched.
      expect(JSON.parse(first.answer)).toHaveProperty('relies_on');

      const second = await nextCall(who);
      expect(second.text).not.toContain(HEADER);
    }
  });

  test('not the agent relying on another section, and not the proposer', async () => {
    expect((await nextCall('totals')).text).not.toContain(HEADER);
    expect((await nextCall('billing')).text).not.toContain(HEADER);
  });

  test('replies are kept with who and which plan, and posted as weigh-ins in the proposer\'s plan', async () => {
    const none = await agents.exports.callTool('reply_to_spec_proposal', { uid: proposal, impact: 'none' });
    expect(none.isError, none.text).toBeFalsy();
    const changes = await agents.checkout.callTool('reply_to_spec_proposal', {
      uid: proposal, impact: 'changes', words: 'The totals row must show the currency next to the amount.', tasks: 2,
    });
    expect(changes.isError, changes.text).toBeFalsy();
    expect(JSON.parse(changes.answer).next).toContain('posted to the proposer\'s plan');

    const read = JSON.parse((await agents.totals.callTool('list_spec_proposals', { uid: proposal })).answer) as { proposals: Array<{ impacts: Impact[] }> };
    const impacts = read.proposals[0].impacts;
    expect(impacts.map((i) => [i.impact, i.itemTitle, i.planTitle, i.author, i.tasks])).toEqual([
      ['none', 'Export invoices', 'Exports', 'aider', null],
      ['changes', 'Show totals', 'Checkout', 'claude-code', 2],
    ]);
    expect(impacts[1].words).toBe('The totals row must show the currency next to the amount.');
    expect(impacts.every((i) => i.sessionId)).toBe(true);

    const events = (await (await h.client.raw('GET', `/api/plans/${plans['Billing v2']}/channels?event_types=weigh-in`)).json()) as ChannelEvent[];
    const messages = events.map((e) => e.payload.message);
    expect(messages).toContain('On the proposed change to § Fields of "Invoice format": no impact on "Export invoices" (Exports).');
    expect(messages).toContain('On the proposed change to § Fields of "Invoice format": "Show totals" (Checkout) would change (2 tasks): The totals row must show the currency next to the amount.');
    expect(events.every((e) => e.itemUid === tasks.billing)).toBe(true);
    expect(events.map((e) => e.author).sort()).toEqual(['aider', 'claude-code']);
  });

  test('refused with a sentence: no proposal, changes without words, a count that is not one', async () => {
    const refuse = async (args: Record<string, unknown>) => {
      const r = await agents.checkout.callTool('reply_to_spec_proposal', { uid: proposal, impact: 'changes', words: 'x', ...args });
      expect(r.isError).toBe(true);
      return r.text;
    };
    expect(await refuse({ uid: 'nope' })).toMatch(/No proposal nope/);
    expect(await refuse({ words: '  ' })).toMatch(/Say in a sentence/);
    expect(await refuse({ tasks: -1 })).toMatch(/whole number/);
  });
});
