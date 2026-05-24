/**
 * CDev Phase 1.5 — integration test for the channels foundation.
 *
 * Exercises the cross-cutting Phase 1 flow end-to-end through the same
 * MCP wire format real agents use:
 *
 *   1. Scan a fixture project — identity auto-seeds from git config (Bugfix B).
 *   2. update_project_config + get_project_config — per-project override
 *      resolves in the effective surface (1.1).
 *   3. create_plan via MCP with effective `shared` defaultVisibility →
 *      plan.yaml lands on disk immediately (Bugfix D + 1.1).
 *   4. Agent posts a `stuck` via MCP — channel YAML appears under
 *      .codetrellis/plans/<slug>/channels/<uid>.yaml with agent-bound
 *      attribution (Bugfix A + 1.3).
 *   5. Agent posts a `steer` threaded to the stuck — the thread tool
 *      returns both events chronologically (1.3).
 *   6. Hand-craft an external channel YAML file → file watcher
 *      re-imports it within the test window (1.3 + 1.3 watcher).
 *   7. resolve_channel_event → DB and disk both reflect the new status.
 *   8. commit_manifest_changes with agent attribution → git log shows
 *      `[cdev]` subject + Co-Authored-By trailer using the seeded
 *      identity (1.2 + Bugfix B).
 *
 * If anything in this chain breaks, the channels demo (and the rest
 * of the Phase 1 story) is impacted.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { setupHarness } from '../harness';

test.describe('CDev Phase 1 channels — end-to-end', () => {
  test.setTimeout(180_000);

  test('full Phase 1 flow: config → plan → channel events → external import → resolve → committed', async () => {
    const h = await setupHarness('cdev-channels-e2e');
    try {
      // Make sure the fixture has a recognisable git identity so the
      // auto-seed has something to find.
      execSync('git config user.name "E2E Tester"', { cwd: h.fixture.projectPath });
      execSync('git config user.email "e2e-tester@cdev.example"', { cwd: h.fixture.projectPath });

      // 1. Scan the project — triggers identity auto-seed (Bugfix B).
      await h.client.scanProject(h.fixture.projectPath);

      const settings = await h.client.raw('GET', '/api/settings');
      const settingsJson = await settings.json();
      expect(settingsJson.identity.email).toBe('e2e-tester@cdev.example');
      expect(settingsJson.identity.displayName).toBe('E2E Tester');

      // Spawn the agent (connect + register_session). spawnAgent uses
      // the real MCP wire format.
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // 2. Per-project config (1.1) — read empty, write override, read effective.
      const initialConfig = await agent.callTool('get_project_config', { project_root: h.fixture.projectPath });
      const initial = JSON.parse(initialConfig.text);
      expect(initial.projectConfig).toEqual({});
      expect(initial.effective.plans.defaultVisibility).toBe('shared');

      const overrideRes = await agent.callTool('update_project_config', {
        project_root: h.fixture.projectPath,
        plans: { defaultVisibility: 'shared' },
      });
      expect(overrideRes.isError).not.toBe(true);

      expect(fs.existsSync(path.join(h.fixture.projectPath, '.codetrellis', 'config.json'))).toBe(true);

      const after = JSON.parse((await agent.callTool('get_project_config', { project_root: h.fixture.projectPath })).text);
      expect(after.projectConfig.plans.defaultVisibility).toBe('shared');
      expect(after.effective.plans.defaultVisibility).toBe('shared');

      // 3. Create a plan via MCP — Bugfix D auto-exports because
      //    effective default visibility is 'shared'.
      const createRes = await agent.callTool('create_plan', {
        title: 'Phase 1 shakedown',
        description: 'Drives the channels round-trip.',
        project_path: h.fixture.projectPath,
      });
      const create = JSON.parse(createRes.text);
      expect(create.exported).toBe(true);
      const planUid: string = create.uid;
      const slugPrefix = planUid.split('-')[0];
      const planDir = path.join(h.fixture.projectPath, '.codetrellis', 'plans');
      const candidates = fs.readdirSync(planDir).filter((n) => n.endsWith(`-${slugPrefix}`));
      expect(candidates.length).toBe(1);
      const planSlugDir = path.join(planDir, candidates[0]);
      expect(fs.existsSync(path.join(planSlugDir, 'plan.yaml'))).toBe(true);

      // 4. Post a stuck via MCP. Bugfix A: attribution should resolve
      //    to the registered agent — authorType = 'claude-code',
      //    agentModel = 'opus-4-7'.
      const stuckRes = await agent.callTool('post_channel_event', {
        plan_uid: planUid,
        event_type: 'stuck',
        message: 'Repeatedly failing to load the dataset.',
        attempted: ['parse with utf-8', 'parse with latin-1'],
      });
      const stuck = JSON.parse(stuckRes.text);
      expect(stuck.authorType).toBe('claude-code');
      expect(stuck.agentModel).toBe('opus-4-7');
      expect(stuck.author).toBe('e2e-tester@cdev.example');

      const channelsDir = path.join(planSlugDir, 'channels');
      const stuckPath = path.join(channelsDir, `${stuck.uid}.yaml`);
      await waitFor(() => fs.existsSync(stuckPath), 'stuck event YAML appeared on disk');
      const stuckYaml = parseYaml(fs.readFileSync(stuckPath, 'utf-8'));
      expect(stuckYaml.eventType).toBe('stuck');
      expect(stuckYaml.payload.attempted).toEqual(['parse with utf-8', 'parse with latin-1']);

      // 5. Post a steer threaded under the stuck.
      const steerRes = await agent.callTool('post_channel_event', {
        plan_uid: planUid,
        event_type: 'steer',
        message: 'Try chunked streaming with utf-8-sig.',
        responds_to: stuck.uid,
      });
      const steer = JSON.parse(steerRes.text);
      expect(steer.respondsTo).toBe(stuck.uid);

      const threadRes = await agent.callTool('get_channel_thread', { root_event_uid: stuck.uid });
      const thread = JSON.parse(threadRes.text);
      expect(thread.length).toBe(2);
      expect(thread[0].uid).toBe(stuck.uid);
      expect(thread[1].uid).toBe(steer.uid);

      // 6. External arrival — hand-craft a channel YAML, drop it in
      //    channels/, wait for the watcher to import it.
      const externalUid = 'external-event-' + Date.now();
      const externalRecord = {
        uid: externalUid,
        itemUid: null,
        eventType: 'weigh-in',
        payload: { message: 'External weigh-in from a teammate via git pull.' },
        author: 'teammate@cdev.example',
        authorType: 'human',
        agentModel: null,
        respondsTo: null,
        status: 'open',
        createdAt: new Date(Date.now() - 5_000).toISOString(),
        updatedAt: new Date(Date.now() - 5_000).toISOString(),
      };
      fs.writeFileSync(path.join(channelsDir, `${externalUid}.yaml`), stringifyYaml(externalRecord), 'utf-8');

      await waitFor(async () => {
        const listRes = await agent.callTool('list_channel_events', { plan_uid: planUid });
        const events = JSON.parse(listRes.text) as Array<{ uid: string }>;
        return events.some((e) => e.uid === externalUid);
      }, 'external channel event imported by watcher');

      // 7. Resolve the stuck — DB + disk both updated.
      const resolveRes = await agent.callTool('resolve_channel_event', { event_uid: stuck.uid });
      const resolved = JSON.parse(resolveRes.text);
      expect(resolved.status).toBe('resolved');

      await waitFor(() => {
        const updated = parseYaml(fs.readFileSync(stuckPath, 'utf-8'));
        return updated.status === 'resolved';
      }, 'stuck YAML status updated to resolved');

      // 8. Commit the manifest with an agent-attributed [cdev] message.
      const commitRes = await agent.callTool('commit_manifest_changes', {
        project_root: h.fixture.projectPath,
        subject: 'Channel round-trip shakedown',
        paths: ['.codetrellis'],
        agent: { agent_type: 'claude-code', model: 'opus-4-7' },
      });
      const commit = JSON.parse(commitRes.text);
      expect(commit.sha).toMatch(/^[a-f0-9]{40}$/);

      const subject = execSync('git log -1 --format=%s', { cwd: h.fixture.projectPath, encoding: 'utf-8' }).trim();
      expect(subject).toBe('[cdev] Channel round-trip shakedown');

      const body = execSync('git log -1 --format=%B', { cwd: h.fixture.projectPath, encoding: 'utf-8' });
      expect(body).toContain('agent: claude-code · model: opus-4-7');
      expect(body).toMatch(/Co-Authored-By: E2E Tester's claude-code <agent@cdev\.example>/);

      const authorName = execSync('git log -1 --format=%an', { cwd: h.fixture.projectPath, encoding: 'utf-8' }).trim();
      const authorEmail = execSync('git log -1 --format=%ae', { cwd: h.fixture.projectPath, encoding: 'utf-8' }).trim();
      expect(authorName).toBe('E2E Tester');
      expect(authorEmail).toBe('e2e-tester@cdev.example');
    } finally {
      await h.teardown();
    }
  });
});

async function waitFor(predicate: () => boolean | Promise<boolean>, description: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}${lastErr ? ` (last error: ${lastErr})` : ''}`);
}
