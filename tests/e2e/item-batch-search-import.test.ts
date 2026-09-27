/**
 * bulk_add_items, search_items and import_external (Phase 32 §0.7).
 *
 * The stage review found these three counted as covered because a unit test
 * that phrases tool calls for the Timeline mentions their names; nothing ran
 * them. Running them found what 0.4 fixed elsewhere and not here:
 *  - search_items answered an unknown plan with no results, and put the
 *    query into LIKE unescaped, so "%" matched every item;
 *  - import_external recorded "mcp-agent" as the author whoever called it,
 *    made a plan with no project when none was open, and ignored the
 *    default visibility (bug 48).
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

test.describe.serial('Batch add, search and import', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  let planUid: string;

  const json = async (tool: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(tool, args);
    expect(res.isError, `${tool}: ${res.text}`).not.toBe(true);
    return JSON.parse(res.text);
  };
  const refused = async (tool: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(tool, args);
    expect(res.isError, `${tool} ${JSON.stringify(args)}: ${res.text}`).toBe(true);
    return res.text;
  };
  const linked = async (uid: string) =>
    (await (await h.client.raw('GET', `/api/plans/${uid}/file-status?path=${encodeURIComponent(root)}`)).json()).linked as boolean;

  test.beforeAll(async () => {
    h = await setupHarness('item-batch-search-import');
    root = h.fixture.projectPath;
    agent = await h.spawnAgent({ agentType: 'batch-agent' });
  });

  // First, while nothing is open yet.
  test('import_external with no project open and none named is refused, not filed under no project', async () => {
    expect(await refused('import_external', { text: '- [ ] Something' })).toMatch(/project/i);
    await h.client.scanProject(root);
    planUid = (await json('create_plan', { title: 'Ledger rounding', project_path: root })).uid;
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('bulk_add_items builds a tree in one call, parents by temporary id, in order', async () => {
    const res = await json('bulk_add_items', {
      plan_uid: planUid,
      items: [
        { _temp_uid: 'p', kind: 'object', title: 'Rounding rules' },
        { kind: 'action', parent_uid: 'p', title: 'Round half-up', body: 'Money is rounded half-up at 2dp.' },
        { kind: 'action', parent_uid: 'p', title: 'Document it', body: 'Say so in the docs, with 100% of the cases.' },
      ],
    });
    expect(res.created).toBe(3);
    const [parent, ...children] = res.items as Array<{ uid: string; _temp_uid: string | null }>;
    expect(parent._temp_uid).toBe('p');
    for (const c of children) {
      const item = await (await h.client.raw('GET', `/api/items/${c.uid}`)).json();
      expect(item.parentUid).toBe(parent.uid);
      expect(item.author).toBe('batch-agent');
    }
    expect(await refused('bulk_add_items', { plan_uid: 'no-such-plan', items: [{ kind: 'action', title: 'x' }] })).toMatch(/not found/i);
  });

  test('search_items finds titles and bodies with an excerpt; "%" is a character, not a wildcard; an unknown plan is refused', async () => {
    const hit = await json('search_items', { plan_uid: planUid, query: 'HALF-UP' });
    expect(hit.results.map((r: { title: string }) => r.title).sort()).toEqual(['Round half-up']);
    expect(hit.results[0].excerpt).toContain('half-up');

    const percent = await json('search_items', { plan_uid: planUid, query: '%' });
    expect(percent.results.map((r: { title: string }) => r.title)).toEqual(['Document it']);
    const underscore = await json('search_items', { plan_uid: planUid, query: '_' });
    expect(underscore.results).toEqual([]);

    expect(await refused('search_items', { plan_uid: 'no-such-plan', query: 'x' })).toMatch(/not found/i);
  });

  test('import_external makes a plan with items, authored by the agent that called it, in the open project, shared by default', async () => {
    const res = await agent.callTool('import_external', {
      text: '# Tidy the ledger\n\n- [ ] Remove the old rounding helper in `services/ledger/round.go`\n- [ ] Add a test for half-up\n',
      title: 'Tidy the ledger',
    });
    expect(res.isError, res.text).not.toBe(true);
    const uid = /\(([0-9a-f-]{36})\)/.exec(res.text)?.[1];
    expect(uid, res.text).toBeTruthy();
    const plan = await (await h.client.raw('GET', `/api/plans/${uid}`)).json();
    expect(plan.projectPath).toBe(root);
    expect(plan.author).toBe('batch-agent');
    // The list carries summaries, not authors; each item is read itself.
    const items = await (await h.client.raw('GET', `/api/plans/${uid}/items`)).json() as Array<{ uid: string }>;
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect((await (await h.client.raw('GET', `/api/items/${i.uid}`)).json()).author).toBe('batch-agent');
    }
    expect(await linked(uid!)).toBe(true);
  });
});
