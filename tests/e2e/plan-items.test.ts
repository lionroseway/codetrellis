/**
 * Phase 15 §15.C — unified Object/Action MCP surface harness tests.
 *
 * Exercises the new canonical tools end-to-end through the same SSE
 * wire that real agents use:
 *
 *  - add_item (Object + Action, mixed tree)
 *  - get_item / read_item_full
 *  - update_item (content + structural)
 *  - move_item (re-parent + reorder)
 *  - delete_item (cascade)
 *  - claim_item (atomic; Object errors politely)
 *  - list_items (sidebar tree query)
 *  - get_plan_timeline (event log; filtered + unfiltered)
 *  - restore_item_version
 *  - add_item_comment / list_item_comments
 *  - update_item_progress / set_item_blocked
 *  - add_item_attachment
 *
 * The legacy harness `tests/e2e/task-context.test.ts` exercises the
 * old MCP surface (claim_task, add_subtask, …). Both pass in 15.C
 * because the old tools keep writing to legacy tables and the new
 * tools write to plan_items in parallel.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

/**
 * `list_items` returns a PAGINATED ENVELOPE, not a bare array.
 *
 * Phase A (A7) of the V2 MCP migration added `limit` / `offset` / `status`
 * to `list_items`, which changed the response shape from `PlanItemJson[]` to
 * `{ items, limit, offset, total }`. These tests asserted the old shape and
 * failed with "received value must have a length property" — the behaviour
 * they check is still correct, only the envelope moved.
 */
interface ListItemsEnvelope {
  items: PlanItemJson[];
  limit: number;
  offset: number;
  total: number;
}

interface PlanItemJson {
  uid: string;
  planUid: string;
  parentUid: string | null;
  kind: 'object' | 'action';
  title: string;
  body: string;
  template: string | null;
  status?: string | null;
  progressPercent?: number | null;
  blockedReason?: string | null;
  scopePath?: string | null;
  fileSpecs?: Array<{ path: string; action: string }>;
  sortOrder: number;
}

function parseJson<T = unknown>(text: string): T {
  return JSON.parse(text) as T;
}

test.describe('Phase 15 §C — unified Object/Action MCP surface', () => {
  test.setTimeout(120_000);

  test('add_item Object + Action mixed tree, get_item, list_items', async () => {
    const h = await setupHarness('plan-items-basic');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-c1' });

      // Use the legacy create_plan to seed a plan row (we don't have
      // create_plan in the new surface yet — plan creation is still
      // owned by the legacy planService).
      await agent.callTool('create_plan', {
        title: 'Item surface plan',
        project_path: h.fixture.projectPath,
        tasks: [],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Item surface plan')!;
      expect(plan).toBeDefined();

      // Create Object at root
      const obj1 = await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'object',
        title: 'Overview',
        body: '# Goal\nShip 2FA.',
        template: 'executive_summary',
      });
      expect(obj1.isError).toBeFalsy();
      const overview = parseJson<PlanItemJson>(obj1.text);
      expect(overview.kind).toBe('object');
      expect(overview.template).toBe('executive_summary');

      // Create Action at root with fileSpecs.edits[]
      const act1 = await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'action',
        title: 'Wire types',
        body: 'Add the AuthProvider interface',
        template: 'leaf',
        scope_path: 'src/auth/',
        file_specs: [
          {
            path: 'types.ts',
            action: 'create',
            description: 'New AuthProvider type',
            edits: [{ instruction: 'Export AuthProvider interface', intent: 'add' }],
          },
        ],
      });
      expect(act1.isError).toBeFalsy();
      const wireAct = parseJson<PlanItemJson>(act1.text);
      expect(wireAct.kind).toBe('action');
      expect(wireAct.status).toBe('pending');
      expect(wireAct.fileSpecs?.[0]?.path).toBe('types.ts');

      // Mixed tree: nest an Object under the Action (its references)
      const ref = await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'object',
        parent_uid: wireAct.uid,
        title: 'References',
        body: '- [Figma](https://design.example)\n- [RFC](https://rfc.example)',
        template: 'references',
      });
      const refsObj = parseJson<PlanItemJson>(ref.text);
      expect(refsObj.parentUid).toBe(wireAct.uid);

      // get_item returns the row
      const fetched = await agent.callTool('get_item', { uid: wireAct.uid });
      const fetchedItem = parseJson<PlanItemJson>(fetched.text);
      expect(fetchedItem.uid).toBe(wireAct.uid);

      // list_items returns 3 items, top-level filter returns 2
      const all = await agent.callTool('list_items', { plan_uid: plan.uid });
      expect(parseJson<ListItemsEnvelope>(all.text).items).toHaveLength(3);

      const top = await agent.callTool('list_items', { plan_uid: plan.uid, parent_uid: '' });
      expect(parseJson<ListItemsEnvelope>(top.text).items).toHaveLength(2);

      const onlyActions = await agent.callTool('list_items', { plan_uid: plan.uid, kind: 'action' });
      expect(parseJson<ListItemsEnvelope>(onlyActions.text).items).toHaveLength(1);
    } finally {
      await h.teardown();
    }
  });

  test('read_item_full returns parent + children + attachments + comments + versions', async () => {
    const h = await setupHarness('plan-items-read-full');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-c2' });

      await agent.callTool('create_plan', {
        title: 'Read full plan',
        project_path: h.fixture.projectPath,
        tasks: [],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Read full plan')!;

      const parent = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', { plan_uid: plan.uid, kind: 'action', title: 'Parent action' })).text,
      );
      const child = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', { plan_uid: plan.uid, kind: 'object', parent_uid: parent.uid, title: 'Child note' })).text,
      );

      // Add a comment + attachment to the parent
      await agent.callTool('add_item_comment', {
        uid: parent.uid,
        kind: 'note',
        body: 'Reminder: cover edge cases.',
      });
      await agent.callTool('add_item_attachment', {
        uid: parent.uid,
        kind: 'url',
        value: 'https://example.com/spec',
        label: 'Spec link',
      });

      const fullRes = await agent.callTool('read_item_full', { uid: parent.uid });
      const full = parseJson<{
        item: PlanItemJson;
        parent: PlanItemJson | null;
        children: PlanItemJson[];
        attachments: Array<{ kind: string; value: string }>;
        comments: Array<{ kind: string; body: string }>;
        versions: Array<{ version: number }>;
      }>(fullRes.text);

      expect(full.item.uid).toBe(parent.uid);
      expect(full.parent).toBe(null);
      expect(full.children).toHaveLength(1);
      expect(full.children[0].uid).toBe(child.uid);
      expect(full.attachments).toHaveLength(1);
      expect(full.attachments[0].value).toBe('https://example.com/spec');
      expect(full.comments).toHaveLength(1);
      expect(full.comments[0].kind).toBe('note');
      expect(full.versions.length).toBeGreaterThanOrEqual(1);
    } finally {
      await h.teardown();
    }
  });

  test('update_item content + structural; move_item emits events', async () => {
    const h = await setupHarness('plan-items-update-move');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-c3' });

      await agent.callTool('create_plan', {
        title: 'Update + move plan',
        project_path: h.fixture.projectPath,
        tasks: [],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Update + move plan')!;

      const a = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', { plan_uid: plan.uid, kind: 'action', title: 'Task A' })).text,
      );
      const b = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', { plan_uid: plan.uid, kind: 'action', title: 'Task B', template: 'phase' })).text,
      );

      // Update body + status (content)
      await agent.callTool('update_item', {
        uid: a.uid,
        body: 'Implement the thing',
        status: 'in_progress',
      });
      const updated = parseJson<PlanItemJson>(
        (await agent.callTool('get_item', { uid: a.uid })).text,
      );
      expect(updated.body).toBe('Implement the thing');
      expect(updated.status).toBe('in_progress');

      // Re-parent Task A under Task B (structural)
      await agent.callTool('move_item', { uid: a.uid, new_parent_uid: b.uid });
      const moved = parseJson<PlanItemJson>(
        (await agent.callTool('get_item', { uid: a.uid })).text,
      );
      expect(moved.parentUid).toBe(b.uid);

      // Timeline must reflect both events
      const tl = await agent.callTool('get_plan_timeline', { plan_uid: plan.uid });
      const events = parseJson<Array<{ eventType: string; itemUid: string }>>(tl.text);
      expect(events.some((e) => e.eventType === 'item_created' && e.itemUid === a.uid)).toBe(true);
      expect(events.some((e) => e.eventType === 'status_changed' && e.itemUid === a.uid)).toBe(true);
      expect(events.some((e) => e.eventType === 'item_moved' && e.itemUid === a.uid)).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('delete_item cascades + restore_item_version brings body back', async () => {
    const h = await setupHarness('plan-items-delete-restore');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-c4' });

      await agent.callTool('create_plan', {
        title: 'Delete + restore plan',
        project_path: h.fixture.projectPath,
        tasks: [],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Delete + restore plan')!;

      const root = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', { plan_uid: plan.uid, kind: 'object', title: 'Doc', body: 'v1' })).text,
      );
      // Edit it twice to build up versions
      await agent.callTool('update_item', { uid: root.uid, body: 'v2' });
      await agent.callTool('update_item', { uid: root.uid, body: 'v3' });

      // Restore to v1
      const restored = await agent.callTool('restore_item_version', { uid: root.uid, version: 1 });
      const restoredItem = parseJson<PlanItemJson>(restored.text);
      expect(restoredItem.body).toBe('v1');

      // Delete with a child
      const child = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', { plan_uid: plan.uid, kind: 'object', parent_uid: root.uid, title: 'Child' })).text,
      );
      const deleted = await agent.callTool('delete_item', { uid: root.uid });
      const deletedResult = parseJson<{ ok: boolean; deleted: string[] }>(deleted.text);
      expect(deletedResult.ok).toBe(true);
      expect(deletedResult.deleted).toContain(root.uid);
      expect(deletedResult.deleted).toContain(child.uid);

      // Both gone from list_items
      const after = parseJson<ListItemsEnvelope>(
        (await agent.callTool('list_items', { plan_uid: plan.uid })).text,
      ).items;
      expect(after.find((i) => i.uid === root.uid)).toBeUndefined();
      expect(after.find((i) => i.uid === child.uid)).toBeUndefined();
    } finally {
      await h.teardown();
    }
  });

  test('claim_item atomic; Object errors politely; conflicts detected on file overlap', async () => {
    const h = await setupHarness('plan-items-claim');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'codex-c5' });
      const otherAgent = await h.spawnAgent({ agentType: 'aider-c5' });

      await agent.callTool('create_plan', {
        title: 'Claim plan',
        project_path: h.fixture.projectPath,
        tasks: [],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Claim plan')!;

      // Object cannot be claimed
      const obj = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', { plan_uid: plan.uid, kind: 'object', title: 'A note' })).text,
      );
      const objClaim = await agent.callTool('claim_item', { uid: obj.uid, agent_type: 'codex' });
      expect(objClaim.text).toMatch(/Only Actions can be claimed/i);

      // Action: first claim wins, second fails
      const action = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', {
          plan_uid: plan.uid,
          kind: 'action',
          title: 'Implement endpoint',
          file_specs: [{ path: 'src/api/endpoint.ts', action: 'create' }],
        })).text,
      );
      const first = await agent.callTool('claim_item', { uid: action.uid, agent_type: 'codex' });
      expect(first.text).toMatch(/claimed/i);

      const second = await otherAgent.callTool('claim_item', { uid: action.uid, agent_type: 'aider' });
      expect(second.text).toMatch(/already claimed|not pending/i);

      // File overlap detection
      const overlap = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', {
          plan_uid: plan.uid,
          kind: 'action',
          title: 'Refactor endpoint',
          file_specs: [{ path: 'src/api/endpoint.ts', action: 'modify' }],
        })).text,
      );
      // Push the first action to in_progress so the overlap check triggers.
      await agent.callTool('update_item', { uid: action.uid, status: 'in_progress' });
      const overlapClaim = await otherAgent.callTool('claim_item', { uid: overlap.uid, agent_type: 'aider' });
      expect(overlapClaim.text).toMatch(/conflicts/i);
    } finally {
      await h.teardown();
    }
  });

  test('item-context: comment kinds + progress + blocked all flow through plan_items', async () => {
    const h = await setupHarness('plan-items-context');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-c6' });

      await agent.callTool('create_plan', {
        title: 'Context plan',
        project_path: h.fixture.projectPath,
        tasks: [],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Context plan')!;
      const action = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', { plan_uid: plan.uid, kind: 'action', title: 'Long task' })).text,
      );

      // 25%, 50% progress
      await agent.callTool('update_item_progress', { uid: action.uid, percent: 25, message: 'Setup done' });
      await agent.callTool('update_item_progress', { uid: action.uid, percent: 50, message: 'Backend wired' });

      // Question + blocker
      await agent.callTool('add_item_comment', {
        uid: action.uid,
        kind: 'question',
        body: 'Should we use cookies or localStorage?',
      });
      await agent.callTool('set_item_blocked', { uid: action.uid, reason: 'Waiting on copy from design.' });

      // Read all comments
      const cmts = parseJson<Array<{ kind: string; metadata?: { progressPercent?: number } }>>(
        (await agent.callTool('list_item_comments', { uid: action.uid })).text,
      );
      expect(cmts.filter((c) => c.kind === 'progress')).toHaveLength(2);
      expect(cmts.filter((c) => c.kind === 'question')).toHaveLength(1);
      expect(cmts.filter((c) => c.kind === 'blocker')).toHaveLength(1);

      // Status flipped + blockedReason persists
      const after = parseJson<PlanItemJson>(
        (await agent.callTool('get_item', { uid: action.uid })).text,
      );
      expect(after.status).toBe('blocked');
      expect(after.blockedReason).toBe('Waiting on copy from design.');
      expect(after.progressPercent).toBe(50);

      // add_item_attachment
      await agent.callTool('add_item_attachment', {
        uid: action.uid,
        kind: 'url',
        value: 'https://design.example/copy',
        label: 'Design copy doc',
      });

      const full = parseJson<{ attachments: Array<{ kind: string; value: string }> }>(
        (await agent.callTool('read_item_full', { uid: action.uid })).text,
      );
      expect(full.attachments).toHaveLength(1);
      expect(full.attachments[0].value).toBe('https://design.example/copy');
    } finally {
      await h.teardown();
    }
  });

  test('get_plan_timeline filters by since_ms and event kinds', async () => {
    const h = await setupHarness('plan-items-timeline');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-c7' });

      await agent.callTool('create_plan', {
        title: 'Timeline plan',
        project_path: h.fixture.projectPath,
        tasks: [],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Timeline plan')!;

      const cutoff = Date.now();
      // Wait a tick so events created below have timestamps strictly > cutoff
      await new Promise((r) => setTimeout(r, 5));

      const a = parseJson<PlanItemJson>(
        (await agent.callTool('add_item', { plan_uid: plan.uid, kind: 'action', title: 'Phase 1' })).text,
      );
      await agent.callTool('update_item', { uid: a.uid, status: 'in_progress' });
      await agent.callTool('move_item', { uid: a.uid, new_sort_order: 5 });

      const all = parseJson<Array<{ eventType: string }>>(
        (await agent.callTool('get_plan_timeline', { plan_uid: plan.uid })).text,
      );
      // item_created + status_changed + reordered = 3 minimum
      expect(all.length).toBeGreaterThanOrEqual(3);

      // Filter to created only
      const onlyCreated = parseJson<Array<{ eventType: string }>>(
        (await agent.callTool('get_plan_timeline', {
          plan_uid: plan.uid,
          kinds: ['item_created'],
        })).text,
      );
      expect(onlyCreated.every((e) => e.eventType === 'item_created')).toBe(true);

      // Filter by since_ms — the cutoff is BEFORE all events, so all
      // events should still appear.
      const sinceCutoff = parseJson<Array<{ eventType: string }>>(
        (await agent.callTool('get_plan_timeline', {
          plan_uid: plan.uid,
          since_ms: cutoff,
        })).text,
      );
      expect(sinceCutoff.length).toBeGreaterThanOrEqual(3);

      // Future since_ms returns empty
      const future = parseJson<unknown[]>(
        (await agent.callTool('get_plan_timeline', {
          plan_uid: plan.uid,
          since_ms: Date.now() + 100_000,
        })).text,
      );
      expect(future).toEqual([]);
    } finally {
      await h.teardown();
    }
  });

  test('all 15 new tools are registered in the MCP tool registry', async () => {
    const h = await setupHarness('plan-items-tool-registry');
    try {
      const agent = await h.spawnAgent({ agentType: 'harness-c8' });
      const tools = await agent.mcp.listTools();
      const names = new Set(tools.map((t) => t.name));
      const expected = [
        'add_item',
        'get_item',
        'read_item_full',
        'update_item',
        'move_item',
        'delete_item',
        'claim_item',
        'list_items',
        'get_plan_timeline',
        'restore_item_version',
        'add_item_comment',
        'list_item_comments',
        'update_item_progress',
        'set_item_blocked',
        'add_item_attachment',
      ];
      for (const tool of expected) {
        expect(names.has(tool), `missing tool: ${tool}`).toBe(true);
      }
    } finally {
      await h.teardown();
    }
  });
});
