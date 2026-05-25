/**
 * CDev Phase 6 — team history & governance tests.
 *
 * Four scenarios:
 *
 *   1. Team activity feed — scan a project, create a plan + export to
 *      disk, commit the manifest, then query the team activity REST
 *      endpoint. Confirm entries appear for the committed plan.
 *
 *   2. Plan history rail — create a plan via MCP, export + commit,
 *      mutate + re-export + commit, then query get_plan_history and
 *      get_plan_at_commit MCP tools.
 *
 *   3. Freeze periods — set/get freeze via MCP tools, check plan
 *      exemption logic, lift freeze.
 *
 *   4. Conflict detection — verify the detect_conflicts tool returns
 *      no conflicts on a clean repo (can't test real merge in a
 *      harness easily, but the wiring must work).
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { setupHarness } from '../harness';

test.describe('CDev Phase 6 — team history & governance', () => {
  test.setTimeout(120_000);

  test('team activity feed returns entries for committed manifest changes', async () => {
    const h = await setupHarness('cdev-phase6-activity');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Create a plan and export it to disk.
      const planRes = await agent.callTool('create_plan', {
        title: 'Activity test plan',
        description: 'Tests team activity feed.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);
      expect(plan.uid).toBeTruthy();

      // Add an item so there's more content.
      await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'action',
        title: 'Test action',
        status: 'pending',
      });

      // Export plan to disk (creates .codetrellis/plans/).
      await agent.callTool('export_plan_to_files', {
        plan_uid: plan.uid,
        project_root: h.fixture.projectPath,
      });

      // Commit the manifest.
      const commitRes = await agent.callTool('commit_manifest_changes', {
        project_root: h.fixture.projectPath,
        subject: 'add activity test plan',
        paths: ['.codetrellis/'],
        agent: { agent_type: 'claude-code', model: 'opus-4-7' },
      });
      expect(commitRes.isError).not.toBe(true);
      const commit = JSON.parse(commitRes.text);
      expect(commit.sha).toBeTruthy();

      // Query team activity via REST.
      const actRes = await h.client.raw('GET',
        `/api/team-activity?project=${encodeURIComponent(h.fixture.projectPath)}&limit=50`,
      );
      expect(actRes.ok).toBe(true);
      const activity = await actRes.json() as { total: number; entries: any[] };
      expect(activity.total).toBeGreaterThan(0);

      // Should find at least a plan entry.
      const planEntry = activity.entries.find((e: any) => e.entityType === 'plan');
      expect(planEntry).toBeTruthy();
      expect(planEntry.action).toBe('created');
      expect(planEntry.commitHash).toBe(commit.sha);

      // Also test via MCP tool.
      const mcpRes = await agent.callTool('get_team_activity', {
        project_path: h.fixture.projectPath,
        limit: 50,
      });
      expect(mcpRes.isError).not.toBe(true);
      const mcpActivity = JSON.parse(mcpRes.text);
      expect(mcpActivity.total).toBeGreaterThan(0);
    } finally {
      await h.teardown();
    }
  });

  test('plan history rail lists commits and reconstructs plan state', async () => {
    const h = await setupHarness('cdev-phase6-history');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Create plan + item.
      const planRes = await agent.callTool('create_plan', {
        title: 'History test plan',
        description: 'Tests plan history rail.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);

      await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'object',
        title: 'Architecture overview',
        status: 'pending',
      });

      // Export + commit (commit 1).
      await agent.callTool('export_plan_to_files', {
        plan_uid: plan.uid,
        project_root: h.fixture.projectPath,
      });
      const c1Res = await agent.callTool('commit_manifest_changes', {
        project_root: h.fixture.projectPath,
        subject: 'initial plan state',
        paths: ['.codetrellis/'],
      });
      const c1 = JSON.parse(c1Res.text);

      // Add another item.
      const addRes = await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'action',
        title: 'Implement auth module',
        status: 'in_progress',
      });
      expect(addRes.isError).not.toBe(true);

      // Export + commit (commit 2).
      const exp2 = await agent.callTool('export_plan_to_files', {
        plan_uid: plan.uid,
        project_root: h.fixture.projectPath,
      });
      expect(exp2.isError).not.toBe(true);

      const c2Res = await agent.callTool('commit_manifest_changes', {
        project_root: h.fixture.projectPath,
        subject: 'add auth module action',
        paths: ['.codetrellis/'],
      });
      expect(c2Res.isError).not.toBe(true);
      const c2 = JSON.parse(c2Res.text);

      // Derive the plan slug.
      const slugTitle = 'history-test-plan';
      const slugUid = plan.uid.split('-')[0];
      const planSlug = `${slugTitle}-${slugUid}`;

      // Query plan history via MCP.
      const histRes = await agent.callTool('get_plan_history', {
        project_path: h.fixture.projectPath,
        plan_slug: planSlug,
      });
      expect(histRes.isError).not.toBe(true);
      const hist = JSON.parse(histRes.text);
      expect(hist.total).toBeGreaterThanOrEqual(2);

      // Get plan at commit 1 — should have 1 item.
      const snap1Res = await agent.callTool('get_plan_at_commit', {
        project_path: h.fixture.projectPath,
        plan_slug: planSlug,
        commit_hash: c1.sha,
      });
      expect(snap1Res.isError).not.toBe(true);
      const snap1 = JSON.parse(snap1Res.text);
      expect(snap1.plan).toBeTruthy();
      expect(snap1.plan.title).toBe('History test plan');
      expect(snap1.items.length).toBe(1);
      expect(snap1.items[0].title).toBe('Architecture overview');

      // Get plan at commit 2 — should have 2 items.
      const snap2Res = await agent.callTool('get_plan_at_commit', {
        project_path: h.fixture.projectPath,
        plan_slug: planSlug,
        commit_hash: c2.sha,
      });
      expect(snap2Res.isError).not.toBe(true);
      const snap2 = JSON.parse(snap2Res.text);
      expect(snap2.items.length).toBe(2);

      // Diff between commits.
      const diffRes = await agent.callTool('diff_plan_between_commits', {
        project_path: h.fixture.projectPath,
        plan_slug: planSlug,
        base_commit: c1.sha,
        head_commit: c2.sha,
      });
      expect(diffRes.isError).not.toBe(true);
      const diff = JSON.parse(diffRes.text);
      expect(diff.added.length).toBe(1);
      expect(diff.added[0].title).toBe('Implement auth module');
    } finally {
      await h.teardown();
    }
  });

  test('freeze period set/get/exempt round-trip via MCP', async () => {
    const h = await setupHarness('cdev-phase6-freeze');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Initially no freeze.
      const status0 = await agent.callTool('get_freeze_status', {
        project_path: h.fixture.projectPath,
      });
      const s0 = JSON.parse(status0.text);
      expect(s0.active).toBe(false);

      // Create a plan to use in exemption test.
      const planRes = await agent.callTool('create_plan', {
        title: 'Freeze test plan',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);

      // Activate freeze.
      const setRes = await agent.callTool('set_freeze', {
        project_path: h.fixture.projectPath,
        active: true,
        reason: 'Release v2.0 freeze',
        until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
      expect(setRes.isError).not.toBe(true);
      expect(setRes.text).toContain('Freeze activated');
      expect(setRes.text).toContain('Release v2.0 freeze');

      // Check freeze is active.
      const status1 = await agent.callTool('get_freeze_status', {
        project_path: h.fixture.projectPath,
      });
      const s1 = JSON.parse(status1.text);
      expect(s1.active).toBe(true);
      expect(s1.reason).toBe('Release v2.0 freeze');
      expect(s1.remainingMs).toBeGreaterThan(0);

      // Plan should NOT be allowed during freeze.
      const checkRes = await agent.callTool('check_freeze', {
        project_path: h.fixture.projectPath,
        plan_uid: plan.uid,
      });
      const check = JSON.parse(checkRes.text);
      expect(check.allowed).toBe(false);
      expect(check.freezeActive).toBe(true);

      // Exempt the plan.
      const exemptRes = await agent.callTool('exempt_plan_from_freeze', {
        project_path: h.fixture.projectPath,
        plan_uid: plan.uid,
      });
      expect(exemptRes.isError).not.toBe(true);
      expect(exemptRes.text).toContain('exempt');

      // Now the plan should be allowed.
      const checkRes2 = await agent.callTool('check_freeze', {
        project_path: h.fixture.projectPath,
        plan_uid: plan.uid,
      });
      const check2 = JSON.parse(checkRes2.text);
      expect(check2.allowed).toBe(true);

      // Lift freeze.
      const liftRes = await agent.callTool('set_freeze', {
        project_path: h.fixture.projectPath,
        active: false,
      });
      expect(liftRes.text).toContain('lifted');

      // Verify lifted.
      const status2 = await agent.callTool('get_freeze_status', {
        project_path: h.fixture.projectPath,
      });
      const s2 = JSON.parse(status2.text);
      expect(s2.active).toBe(false);

      // Also verify via REST.
      const restRes = await h.client.raw('GET',
        `/api/freeze?project=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      const restFreeze = await restRes.json() as { active: boolean };
      expect(restFreeze.active).toBe(false);
    } finally {
      await h.teardown();
    }
  });

  test('detect_conflicts returns clean on non-merge state', async () => {
    const h = await setupHarness('cdev-phase6-conflicts');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // In a non-merge state, detect_conflicts should return no conflicts.
      const res = await agent.callTool('detect_conflicts', {
        project_path: h.fixture.projectPath,
      });
      expect(res.isError).not.toBe(true);
      const summary = JSON.parse(res.text);
      expect(summary.hasConflicts).toBe(false);
      expect(summary.files).toEqual([]);
      expect(summary.totalConflicts).toBe(0);

      // Also via REST.
      const restRes = await h.client.raw('GET',
        `/api/conflicts?project=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      const restSummary = await restRes.json() as { hasConflicts: boolean };
      expect(restSummary.hasConflicts).toBe(false);
    } finally {
      await h.teardown();
    }
  });
});
