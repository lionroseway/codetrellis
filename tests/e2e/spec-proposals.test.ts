/**
 * Phase 32 B7.2 — proposing a spec change (JOURNEYS I1).
 *
 * The billing agent finds the invoice format cannot carry currency. Instead
 * of editing the page, it proposes a new "Fields" section, with why and the
 * failing test. The proposal lists the tasks relying on Fields or on the
 * whole page, in other plans, and leaves the page as it was. It is the
 * calling agent's, from its session. When the page changes afterwards, the
 * proposal says so. Editing a relied-on page directly still works, and says
 * who relies on it. Nonsense is refused with a sentence.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n\n## Totals\n\nSum of lines.\n';
const NEW_FIELDS = '## Fields\n\n- amount\n- currency (ISO 4217, required)';

interface Proposal {
  uid: string; pageUid: string; section: string; sectionTitle: string | null; baseVersion: number; currentVersion: number;
  pageChangedSince: boolean; beforeText: string; proposedText: string; why: string; evidence: { tests?: string[] };
  affected: Array<{ title: string; planTitle: string; section: string }>; affectedWords: string | null;
  author: string; authorType: string; sessionId: string | null; status: string;
}

test.describe.serial('Proposing a spec change', () => {
  let h: Harness;
  let root: string;
  let billingAgent: ScriptedAgent;
  let page: string;
  let proposal: Proposal;

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const pageBody = async () => ((await (await h.client.raw('GET', `/api/items/${page}`)).json()) as { body: string }).body;

  test.beforeAll(async () => {
    h = await setupHarness('spec-proposals');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    billingAgent = await h.spawnAgent({ agentType: 'codex' });

    const spec = (await h.client.createPlan({ title: 'Invoicing spec', projectPath: root })).uid;
    page = await post(`/api/plans/${spec}/items`, { kind: 'object', title: 'Invoice format', body: BODY });
    const plans: Record<string, string> = {};
    for (const t of ['Billing v2', 'Checkout', 'Exports']) plans[t] = (await h.client.createPlan({ title: t, projectPath: root })).uid;
    const task = async (plan: string, title: string, reliesOn: unknown) => {
      const uid = await post(`/api/plans/${plans[plan]}/items`, { kind: 'action', title });
      expect((await h.client.raw('PUT', `/api/items/${uid}/relies-on`, { reliesOn })).ok).toBe(true);
    };
    await task('Checkout', 'Show totals', [{ page, section: 'fields' }]);
    await task('Exports', 'Export invoices', [{ page }]);
    await task('Billing v2', 'Sum lines', [{ page, section: 'totals' }]);
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the agent proposes a section: who relies on it is listed, and the page is left as it was', async () => {
    const r = await billingAgent.callTool('propose_spec_change', {
      page_uid: page, section: 'fields', text: NEW_FIELDS,
      why: 'Amounts are ambiguous for EU customers.', evidence: { tests: ['invoice_eu.spec'] },
    });
    expect(r.isError, r.text).toBeFalsy();
    const body = JSON.parse(r.answer) as { proposal: Proposal; next: string };
    proposal = body.proposal;
    expect(proposal).toMatchObject({
      pageUid: page, section: 'fields', sectionTitle: 'Fields', status: 'open',
      beforeText: '## Fields\n\n- amount\n', proposedText: NEW_FIELDS, evidence: { tests: ['invoice_eu.spec'] },
      pageChangedSince: false, author: 'codex', authorType: 'mcp',
    });
    expect(proposal.sessionId).toBeTruthy();
    // Fields, and the whole page; not Totals.
    expect(proposal.affected.map((a) => [a.planTitle, a.title]).sort()).toEqual([['Checkout', 'Show totals'], ['Exports', 'Export invoices']]);
    expect(proposal.affectedWords).toBe('2 tasks in 2 plans rely on this');
    expect(body.next).toContain('a person decides');
    expect(await pageBody()).toBe(BODY);
  });

  test('anyone can read it back: an agent by uid or by page, REST for the project', async () => {
    const other = await h.spawnAgent({ agentType: 'claude-code' });
    const byUid = JSON.parse((await other.callTool('list_spec_proposals', { uid: proposal.uid })).answer) as { proposals: Proposal[] };
    expect(byUid.proposals[0].why).toBe('Amounts are ambiguous for EU customers.');
    const byPage = JSON.parse((await other.callTool('list_spec_proposals', { page_uid: page, status: 'open' })).answer) as { proposals: Proposal[] };
    expect(byPage.proposals.map((p) => p.uid)).toEqual([proposal.uid]);
    const rest = (await (await h.client.raw('GET', `/api/spec-proposals?project=${encodeURIComponent(root)}`)).json()) as { proposals: Proposal[] };
    expect(rest.proposals.map((p) => p.uid)).toEqual([proposal.uid]);
    expect((await (await h.client.raw('GET', `/api/spec-proposals/${proposal.uid}`)).json()).uid).toBe(proposal.uid);
  });

  test('a direct edit to a page others rely on is saved, and says who relies on it', async () => {
    const r = await billingAgent.callTool('update_item', { uid: page, body: `${BODY}\n## Notes\n\nDraft.\n` });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toContain('Relied on by 3 tasks in 3 plans');
    expect(r.text).toContain('propose_spec_change');
    expect(await pageBody()).toContain('## Notes');
  });

  test('once the page has changed, the proposal says so', async () => {
    const again = JSON.parse((await billingAgent.callTool('list_spec_proposals', { uid: proposal.uid })).answer) as { proposals: Proposal[] };
    expect(again.proposals[0]).toMatchObject({ pageChangedSince: true, baseVersion: proposal.baseVersion });
    expect(again.proposals[0].currentVersion).toBeGreaterThan(proposal.baseVersion);
  });

  test('refused with a sentence: no page, a task, a heading not there, no why, nothing changed', async () => {
    const refuse = async (args: Record<string, unknown>) => {
      const r = await billingAgent.callTool('propose_spec_change', { page_uid: page, text: 'x', why: 'y', ...args });
      expect(r.isError).toBe(true);
      return r.text;
    };
    const aTask = JSON.parse((await billingAgent.callTool('list_spec_proposals', { uid: proposal.uid })).answer).proposals[0].affected;
    expect(aTask.length).toBeGreaterThan(0);
    expect(await refuse({ page_uid: 'nope' })).toMatch(/No page nope/);
    expect(await refuse({ section: 'currency' })).toMatch(/has no heading "currency"/);
    expect(await refuse({ why: '  ' })).toMatch(/needs a why/);
    expect(await refuse({ section: 'totals', text: '## Totals\n\nSum of lines.' })).toMatch(/same as the page has now/);
    const bad = await h.client.raw('POST', `/api/items/${page}/spec-proposals`, { text: 'x' });
    expect(bad.status).toBe(400);
  });
});
