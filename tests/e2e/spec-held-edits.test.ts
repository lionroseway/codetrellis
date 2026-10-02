/**
 * Phase 32 B7.5a — a spec breakpoint on a page others rely on (JOURNEYS I1).
 *
 * Sam guards "Invoice format" with a spec breakpoint. The billing agent tries
 * to edit it directly: the call is held, and its result names the two tasks,
 * in two plans, that rely on the page and says to propose the change instead.
 * Sam's inbox says the same. The agent proposes: that is not held (a person
 * decides a proposal anyway), and the proposal carries Sam's note on the
 * breakpoint, for the agent and for the card. A page nothing relies on is
 * held as before, with no such words.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n';
const NOTE = 'Invoices go to the tax office; ask me first.';

interface Hit { ref: string; kind: string; action: string; itemUid: string; reliedOn?: { tasks: number; plans: number } | null; answeredAt: number | null }
interface Paused { paused: boolean; ref: string; message: string; breakpoint: { kind: string; note: string | null }; reliedOnBy?: Array<{ uid: string; title: string; plan: string }> }

test.describe.serial('A guarded page others rely on', () => {
  let h: Harness;
  let root: string;
  let page: string;
  let lonely: string;
  let billing: ScriptedAgent;
  const tasks: Record<string, string> = {};

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const get = async <T>(url: string) => (await (await h.client.raw('GET', url)).json()) as T;
  const pageBody = async (uid: string) => (await get<{ body: string }>(`/api/items/${uid}`)).body;

  test.beforeAll(async () => {
    h = await setupHarness('spec-held-edits');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    const spec = (await h.client.createPlan({ title: 'Invoicing spec', projectPath: root })).uid;
    page = await post(`/api/plans/${spec}/items`, { kind: 'object', title: 'Invoice format', body: BODY });
    lonely = await post(`/api/plans/${spec}/items`, { kind: 'object', title: 'Glossary', body: '# Glossary\n' });
    for (const [plan, title, reliesOn] of [
      ['Checkout', 'Show totals', [{ page, section: 'fields' }]],
      ['Exports', 'Export invoices', [{ page }]],
      ['Billing v2', 'Add currency', []],
    ] as const) {
      const planUid = (await h.client.createPlan({ title: plan, projectPath: root })).uid;
      tasks[title] = await post(`/api/plans/${planUid}/items`, { kind: 'action', title });
      if (reliesOn.length) expect((await h.client.raw('PUT', `/api/items/${tasks[title]}/relies-on`, { reliesOn })).ok).toBe(true);
    }
    for (const target of [page, lonely]) {
      const res = await h.client.raw('POST', '/api/breakpoints', { kind: 'spec', itemUid: target, note: target === page ? NOTE : undefined });
      expect(res.ok).toBe(true);
    }
    billing = await h.spawnAgent({ agentType: 'codex' });
    const claimed = await billing.callTool('claim_item', { uid: tasks['Add currency'], agent_type: 'codex' });
    expect(claimed.isError, claimed.text).toBeFalsy();
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('a direct edit is held, and says who relies on the page and to propose instead', async () => {
    const r = await billing.callTool('update_item', { uid: page, body: `${BODY}- currency\n` });
    expect(r.isError, r.text).toBeFalsy();
    const held = JSON.parse(r.answer) as Paused;
    expect(held.paused).toBe(true);
    expect(held.breakpoint).toEqual({ kind: 'spec', note: NOTE });
    expect(held.reliedOnBy?.map((x) => `${x.title} (${x.plan})`).sort()).toEqual(['Export invoices (Exports)', 'Show totals (Checkout)']);
    expect(held.message).toContain('2 tasks in 2 plans rely on this page: "Show totals" (Checkout), "Export invoices" (Exports).');
    expect(held.message).toContain('propose_spec_change(page_uid, section, text, why) is not held');
    expect(held.message).toContain('await the proposal\'s decision rather than this one');
    expect(await pageBody(page)).toBe(BODY);

    // The inbox says the same, in the person's words.
    const hits = (await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits;
    const hit = hits.find((x) => x.ref === held.ref);
    expect(hit).toMatchObject({ kind: 'spec', action: 'edit', itemUid: page, reliedOn: { tasks: 2, plans: 2 }, answeredAt: null });

    // Restoring an old version is an edit too.
    const restore = JSON.parse((await billing.callTool('restore_item_version', { uid: page, version: 1 })).answer) as Paused;
    expect(restore.paused).toBe(true);
    expect(restore.message).toContain('rely on this page');
  });

  test('a proposal to the guarded page is not held, and carries the person\'s note', async () => {
    const r = await billing.callTool('propose_spec_change', {
      page_uid: page, section: 'fields', text: '## Fields\n\n- amount\n- currency', why: 'Amounts are ambiguous for EU customers.',
    });
    expect(r.isError, r.text).toBeFalsy();
    const made = JSON.parse(r.answer) as { proposal: { uid: string; hitRef: string; status: string; pageBreakpoint: { note: string | null } | null }; next: string };
    expect(made.proposal.status).toBe('open');
    expect(made.proposal.pageBreakpoint?.note).toBe(NOTE);
    expect(made.next).toContain(`A person guards this page with a breakpoint, and said: ${NOTE}`);
    expect(made.next).toContain('The proposal is not held by it');

    // Over REST, as the card reads it.
    const viaRest = await get<{ pageBreakpoint: { note: string | null } | null }>(`/api/spec-proposals/${made.proposal.uid}`);
    expect(viaRest.pageBreakpoint?.note).toBe(NOTE);
    // The proposal waits as its own entry; the held edit is still the person's to answer.
    const waiting = (await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits;
    expect(waiting.find((x) => x.ref === made.proposal.hitRef)?.kind).toBe('proposal');
    expect(waiting.filter((x) => x.kind === 'spec' && x.itemUid === page)).toHaveLength(1);
  });

  test('a guarded page nothing relies on is held as before, without the words', async () => {
    const r = await billing.callTool('update_item', { uid: lonely, body: '# Glossary\n\n- invoice\n' });
    const held = JSON.parse(r.answer) as Paused;
    expect(held.paused).toBe(true);
    expect(held.reliedOnBy).toBeUndefined();
    expect(held.message).not.toContain('rely on this page');
    const hit = (await get<{ hits: Hit[] }>('/api/breakpoint-hits')).hits.find((x) => x.ref === held.ref);
    expect(hit?.reliedOn ?? null).toBeNull();
    // And a proposal to it says nothing of a note that was never left.
    const made = JSON.parse((await billing.callTool('propose_spec_change', { page_uid: lonely, text: '# Glossary\n\n- invoice\n', why: 'Missing term.' })).answer) as { proposal: { pageBreakpoint: { note: string | null } | null }; next: string };
    expect(made.proposal.pageBreakpoint).toEqual(expect.objectContaining({ note: null }));
    expect(made.next).toContain('A person guards this page with a breakpoint. The proposal is not held by it');
  });
});
