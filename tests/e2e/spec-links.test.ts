/**
 * Phase 32 B7.1 — tasks say what spec they rely on (JOURNEYS I1).
 *
 * One spec page, "Invoice format", with a "Fields" and a "Totals" section.
 * Billing's task relies on Fields, Exports' on the whole page, Checkout's
 * on Totals. Asked who relies on the page, CodeTrellis names all three,
 * across plans; asked about Fields, only Billing's and Exports' (the whole
 * page counts for every section). A reference that names nothing, a task,
 * a heading that is not there, or the item itself is refused. A heading
 * renamed later leaves the link and says so; a task deleted takes it away.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n\n## Totals\n\nSum of lines.\n';

interface Links {
  uid: string;
  kind: string;
  relies_on: Array<{ pageUid: string; pageTitle: string; planTitle: string; section: string; sectionTitle: string | null; sectionMissing: boolean }>;
  relied_on_by: Array<{ itemUid: string; title: string; planTitle: string; section: string; sectionTitle: string | null }>;
  words: string | null;
}

test.describe.serial('What a task relies on', () => {
  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;
  let page: string;
  let billingTask: string;
  let exportsTask: string;
  let checkoutTask: string;

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const links = async (uid: string, section?: string) =>
    JSON.parse((await agent.callTool('get_spec_links', { uid, ...(section ? { section } : {}) })).answer) as Links;

  test.beforeAll(async () => {
    h = await setupHarness('spec-links');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'codex' });

    const spec = (await h.client.createPlan({ title: 'Invoicing spec', projectPath: root })).uid;
    page = await post(`/api/plans/${spec}/items`, { kind: 'object', title: 'Invoice format', body: BODY });
    const billing = (await h.client.createPlan({ title: 'Billing v2', projectPath: root })).uid;
    const exportsPlan = (await h.client.createPlan({ title: 'Exports', projectPath: root })).uid;
    const checkout = (await h.client.createPlan({ title: 'Checkout', projectPath: root })).uid;

    // An agent says it at creation; another updates a task; a person sets one over REST.
    const made = JSON.parse((await agent.callTool('add_item', {
      plan_uid: billing, kind: 'action', title: 'Add currency', relies_on: [{ page, section: 'fields' }],
    })).answer) as { uid: string };
    billingTask = made.uid;
    exportsTask = await post(`/api/plans/${exportsPlan}/items`, { kind: 'action', title: 'Export invoices' });
    const upd = await agent.callTool('update_item', { uid: exportsTask, relies_on: [{ page }] });
    expect(upd.isError, upd.text).toBeFalsy();
    checkoutTask = await post(`/api/plans/${checkout}/items`, { kind: 'action', title: 'Show totals' });
    const put = await h.client.raw('PUT', `/api/items/${checkoutTask}/relies-on`, { reliesOn: [{ page, section: 'totals' }] });
    expect(put.ok).toBe(true);
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('a task says what it relies on, by page and heading', async () => {
    const mine = await links(billingTask);
    expect(mine.relies_on).toEqual([expect.objectContaining({
      pageUid: page, pageTitle: 'Invoice format', planTitle: 'Invoicing spec', section: 'fields', sectionTitle: 'Fields', sectionMissing: false,
    })]);
    expect((await links(exportsTask)).relies_on).toEqual([expect.objectContaining({ pageUid: page, section: '', sectionTitle: null })]);
  });

  test('a page names every task relying on it, across plans; a section only those on it or on the whole page', async () => {
    const all = await links(page);
    expect(all.relied_on_by.map((r) => [r.planTitle, r.title, r.section])).toEqual([
      ['Billing v2', 'Add currency', 'fields'],
      ['Checkout', 'Show totals', 'totals'],
      ['Exports', 'Export invoices', ''],
    ]);
    expect(all.words).toBe('Relied on by 3 tasks in 3 plans');
    expect(all.relied_on_by.map((r) => r.sectionTitle)).toEqual(['Fields', 'Totals', null]);

    const fields = await links(page, 'fields');
    expect(fields.relied_on_by.map((r) => r.title).sort()).toEqual(['Add currency', 'Export invoices']);

    // REST says the same.
    const rest = (await (await h.client.raw('GET', `/api/items/${page}/spec-links?section=fields`)).json()) as { reliedOnBy: unknown[]; words: string };
    expect(rest.reliedOnBy).toEqual(fields.relied_on_by);
    expect(rest.words).toBe('Relied on by 2 tasks in 2 plans');
  });

  test('refused: a page that does not exist, a task, a heading not on the page, the item itself', async () => {
    const refuse = async (relies_on: Array<{ page: string; section?: string }>, uid = billingTask) => {
      const r = await agent.callTool('update_item', { uid, relies_on });
      expect(r.isError).toBe(true);
      return r.text;
    };
    expect(await refuse([{ page: 'nope' }])).toMatch(/No page nope/);
    expect(await refuse([{ page: exportsTask }])).toMatch(/is a task, not a page/);
    expect(await refuse([{ page, section: 'currency' }])).toMatch(/has no heading "currency"/);
    expect(await refuse([{ page }], page)).toMatch(/cannot rely on itself/);
    const bad = await h.client.raw('PUT', `/api/items/${checkoutTask}/relies-on`, { reliesOn: [{ page, section: 'nope' }] });
    expect(bad.status).toBe(400);
    // Nothing was changed by a refusal.
    expect((await links(billingTask)).relies_on.map((r) => r.section)).toEqual(['fields']);
  });

  test('a heading renamed later keeps the link and says so; a deleted task takes its link away', async () => {
    expect((await h.client.raw('PUT', `/api/items/${page}`, { body: BODY.replace('## Totals', '## Sums') })).ok).toBe(true);
    const shown = (await links(checkoutTask)).relies_on[0];
    expect(shown).toMatchObject({ section: 'totals', sectionTitle: null, sectionMissing: true });

    expect((await h.client.raw('DELETE', `/api/items/${exportsTask}`)).ok).toBe(true);
    expect((await links(page)).relied_on_by.map((r) => r.title).sort()).toEqual(['Add currency', 'Show totals']);
  });
});
