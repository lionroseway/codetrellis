/**
 * References through the real MCP server — `task 9f2c41ab` in place of a uid.
 *
 * The journey this proves: a person copies a task's reference in the app,
 * pastes "task 9f2c41ab isn't right, I've left notes" to an agent, and the
 * agent acts on it with ordinary tools — no uid lookup, no copying a
 * 36-character string by hand.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';
import { formatReference, shortId } from '../../src/shared/lib/references';

test.describe('References — short ids an agent can be handed', () => {
  test.setTimeout(120_000);

  test('every tool that takes a uid accepts a reference; resolve_reference returns the notes', async () => {
    const h = await setupHarness('short-references');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-refs' });

      await agent.callTool('create_plan', { title: 'Board pack', project_path: h.fixture.projectPath, tasks: [] });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Board pack')!;
      const task = JSON.parse((await agent.callTool('add_item', {
        plan_uid: formatReference('plan', plan.uid), // a reference, not the uid
        kind: 'action',
        title: 'Q3 revenue summary',
      })).text) as { uid: string; planUid: string };
      expect(task.planUid).toBe(plan.uid);

      const ref = formatReference('task', task.uid);

      // The person's note, left through the app.
      const note = await h.client.raw('POST', `/api/items/${task.uid}/comments`, {
        body: 'EMEA figure is wrong — see Regional!C14',
        kind: 'note',
      });
      expect(note.ok).toBe(true);

      // The agent is handed only the reference.
      const described = await agent.callTool('resolve_reference', { ref });
      expect(described.isError).toBeFalsy();
      const d = JSON.parse(described.text) as { uid: string; plan: { title: string }; notes: Array<{ body: string }> };
      expect(d.uid).toBe(task.uid);
      expect(d.plan.title).toBe('Board pack');
      expect(d.notes.map((n) => n.body)).toContain('EMEA figure is wrong — see Regional!C14');

      // Ordinary tools take the reference, or a bare 8-char prefix, as a uid.
      const got = await agent.callTool('get_item', { uid: ref });
      expect(got.isError).toBeFalsy();
      expect(JSON.parse(got.text).uid).toBe(task.uid);

      const updated = await agent.callTool('update_item', { uid: shortId(task.uid), status: 'in_progress' });
      expect(updated.isError).toBeFalsy();
      const after = await agent.callTool('get_item', { uid: task.uid });
      expect(JSON.parse(after.text).status).toBe('in_progress');

      // Something that is not there still gets the tool's own "not found".
      const missing = await agent.callTool('get_item', { uid: 'task deadbeef' });
      expect(missing.text).toMatch(/not found/i);
    } finally {
      await h.teardown();
    }
  });
});
