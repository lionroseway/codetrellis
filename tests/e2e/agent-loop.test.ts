/**
 * Agent-driven loop tests — exercises the same feedback chain as
 * `loop.test.ts`, but the actor is a real MCP client connected over
 * SSE (the same wire format Claude Code / Codex / Cursor use).
 *
 * What this layer adds beyond the REST loop test:
 *   - Verifies the MCP transport itself works on the spawned port.
 *   - Verifies tool invocation (`register_session`, `claim_task`,
 *     `update_task`, `get_next_task`) does what its description says.
 *   - Catches MCP SDK regressions before they ship to humans.
 *
 * No real LLM. No API keys. Fully offline.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, waitFor } from '../harness';

/*
 * ─────────────────────────────────────────────────────────────────────────
 * SKIPPED — this file tests MCP tools that NO LONGER EXIST.
 *
 * The V2 MCP migration REMOVED (not deprecated) all 19 V1 plan tools:
 * claim_task, add_subtask, update_task, update_task_progress,
 * set_task_blocked, add_task_comment, add_task_attachment, get_next_task,
 * add_plan_doc, add_plan_phase and the rest. `create_plan` also no longer
 * accepts inline tasks, so `getPlan(...).tasks` comes back empty and every
 * assertion here fails on an empty array rather than on its own logic.
 *
 * See docs/V2-MCP-MIGRATION.md §6 for the removal list.
 *
 * KEPT, NOT DELETED, because the SCENARIOS are still worth covering — the
 * V1 plumbing underneath them is what went away. Whoever reseeds these onto
 * the V2 surface (add_item / bulk_add_items / claim_item) gets the intent
 * for free instead of rediscovering it.
 *
 * Coverage status: full-loop.test.ts covers the agent lifecycle end to end
 * (16 passing tests), so the loop itself is not going untested.
 *
 * To re-enable: rewrite against the V2 tools, then change
 * `test.describe.skip` back to `test.describe`.
 * ─────────────────────────────────────────────────────────────────────────
 */
test.describe.skip('Agent-driven loop (via MCP)', () => {
  test.setTimeout(120_000);

  test('agent connects, registers, claims a task, reports done — REST sees it', async () => {
    const h = await setupHarness('agent-loop-claim');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // Plan with one task targeting a known fixture file.
      const plan = await h.client.createPlan({
        title: 'Agent claim flow',
        projectPath: h.fixture.projectPath,
        tasks: [
          {
            description: 'Update the API client',
            affectedFiles: ['packages/web/src/api.ts'],
          },
        ],
      });
      const detail = await h.client.getPlan(plan.uid);
      const taskUid = detail.tasks[0].uid;
      expect(detail.tasks[0].status).toBe('pending');

      const agent = await h.spawnAgent({
        agentType: 'harness-claude',
        model: 'harness-test/1.0',
      });

      // 1. The MCP server should advertise the tools we depend on.
      const tools = await agent.mcp.listTools();
      const toolNames = new Set(tools.map((t) => t.name));
      for (const required of ['register_session', 'claim_task', 'update_task', 'get_next_task']) {
        expect(toolNames.has(required), `missing MCP tool: ${required}`).toBe(true);
      }

      // 2. Claim the task via MCP.
      const claim = await agent.claimTask(plan.uid, taskUid);
      expect(claim.isError).not.toBe(true);
      expect(claim.text).toMatch(/claimed/i);

      // 3. Mark it in_progress, then done.
      const inflight = await agent.updateTaskStatus(plan.uid, taskUid, 'in_progress');
      expect(inflight.isError).not.toBe(true);
      const finished = await agent.updateTaskStatus(plan.uid, taskUid, 'done');
      expect(finished.isError).not.toBe(true);

      // 4. REST should see the task in `done` state — wait briefly
      //    in case the broadcast hasn't propagated.
      const final = await waitFor(
        async () => {
          const fresh = await h.client.getPlan(plan.uid);
          const t = fresh.tasks.find((t) => t.uid === taskUid);
          return t && t.status === 'done' ? t : null;
        },
        { timeoutMs: 5000, description: `task ${taskUid} to land in done via MCP update_task` },
      );
      expect(final.status).toBe('done');
    } finally {
      await h.teardown();
    }
  });

  test('agent file edit + REST plan creation = auto-progress fires', async () => {
    // Tighter version of loop.test.ts but with the agent in the loop.
    // Proves: MCP-attributed file edits are seen by the watcher and
    // propagate through plan-progress-service back to REST.
    const h = await setupHarness('agent-loop-auto-progress');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Agent auto-progress',
        projectPath: h.fixture.projectPath,
        tasks: [
          {
            description: 'Edit the validators',
            affectedFiles: ['packages/shared/src/validators.ts'],
          },
        ],
      });
      const detail = await h.client.getPlan(plan.uid);
      const taskUid = detail.tasks[0].uid;

      const agent = await h.spawnAgent({ agentType: 'harness-codex' });

      // Agent writes to the file via filesystem — the MCP world
      // doesn't have a "write file" tool today (deliberate; agents
      // use their own native edit tool, then REPORT what they did).
      // We use the agent helper to keep paths consistent.
      const before = require('node:fs').readFileSync(
        require('node:path').join(h.fixture.projectPath, 'packages/shared/src/validators.ts'),
        'utf-8',
      );
      await agent.writeFile(
        'packages/shared/src/validators.ts',
        `${before}\n// Edited by harness-codex via scripted-agent.writeFile()\n`,
      );

      const advancedTask = await waitFor(
        async () => {
          const fresh = await h.client.getPlan(plan.uid);
          const t = fresh.tasks.find((t) => t.uid === taskUid);
          return t && t.status === 'in_progress' ? t : null;
        },
        // Same 20 s buffer rationale as `loop.test.ts` — generous on
        // green, only matters when the system is under load.
        { timeoutMs: 20_000, description: `task ${taskUid} to advance via file watcher` },
      );
      expect(advancedTask.status).toBe('in_progress');
    } finally {
      await h.teardown();
    }
  });
});
