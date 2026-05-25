/**
 * CDev Phase 4.5 — sensor integration tests.
 *
 * Four scenarios exercising the sensor layer end-to-end through the
 * real MCP wire format:
 *
 *   1. Sensor config round-trip — set sensor config via
 *      update_project_config, read it back, confirm defaults merge.
 *   2. Drift → channel — create a plan with fileSpecs, detect a
 *      deviation, confirm a need-decision channel event appears.
 *   3. Doc staleness → channel — create a system doc referencing a
 *      file, commit a change to that file, hit the doc-check endpoint,
 *      confirm a need-decision channel event appears.
 *   4. Stuck sensor — enable stuck detection with low thresholds,
 *      replay identical tool calls, confirm a stuck channel event.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { setupHarness, waitFor, sleep } from '../harness';

test.describe('CDev Phase 4 — sensors', () => {
  test.setTimeout(120_000);

  test('sensor config round-trips through project config', async () => {
    const h = await setupHarness('cdev-sensors-config');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Read defaults — drift and docs enabled, stuck disabled.
      const readRes = await agent.callTool('get_project_config', {
        project_root: h.fixture.projectPath,
      });
      const initial = JSON.parse(readRes.text);
      expect(initial.effective.sensors.drift.enabled).toBe(true);
      expect(initial.effective.sensors.drift.channelEvents).toBe(true);
      expect(initial.effective.sensors.drift.debounceMs).toBe(2000);
      expect(initial.effective.sensors.docs.enabled).toBe(true);
      expect(initial.effective.sensors.stuck.enabled).toBe(false);
      expect(initial.effective.sensors.stuck.repetitionThreshold).toBe(8);

      // Override stuck to enabled with low threshold.
      const updateRes = await agent.callTool('update_project_config', {
        project_root: h.fixture.projectPath,
        sensors: {
          stuck: { enabled: true, repetitionThreshold: 3 },
        },
      });
      const updated = JSON.parse(updateRes.text);
      expect(updated.projectConfig.sensors.stuck.enabled).toBe(true);
      expect(updated.projectConfig.sensors.stuck.repetitionThreshold).toBe(3);

      // Re-read and confirm merge (drift/docs defaults preserved).
      const readRes2 = await agent.callTool('get_project_config', {
        project_root: h.fixture.projectPath,
      });
      const merged = JSON.parse(readRes2.text);
      expect(merged.effective.sensors.drift.enabled).toBe(true);
      expect(merged.effective.sensors.stuck.enabled).toBe(true);
      expect(merged.effective.sensors.stuck.repetitionThreshold).toBe(3);
      // Other stuck defaults preserved.
      expect(merged.effective.sensors.stuck.errorLoopThreshold).toBe(5);
      expect(merged.effective.sensors.stuck.idleMinutes).toBe(15);

      // On-disk config should have the sensors section.
      const configPath = path.join(h.fixture.projectPath, '.codetrellis', 'config.json');
      const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(onDisk.sensors.stuck.enabled).toBe(true);
      expect(onDisk.sensors.stuck.repetitionThreshold).toBe(3);
    } finally {
      await h.teardown();
    }
  });

  test('drift sensor auto-posts channel event on deviation detection', async () => {
    const h = await setupHarness('cdev-sensors-drift');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Set low debounce so the test doesn't wait long.
      await agent.callTool('update_project_config', {
        project_root: h.fixture.projectPath,
        sensors: { drift: { debounceMs: 200 } },
      });

      // Create a plan with a fileSpec so detect_deviations has something
      // to check against.
      const planRes = await agent.callTool('create_plan', {
        title: 'Drift sensor test plan',
        description: 'Tests drift → channel bridge.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);

      await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'action',
        title: 'Add auth service',
        file_specs: [{ path: 'src/auth-service.ts', action: 'create' }],
        status: 'done',
      });

      // Run detect_deviations — the auth-service.ts doesn't exist, so
      // it should find a missing_file deviation.
      const detectRes = await agent.callTool('detect_deviations', {
        plan_uid: plan.uid,
      });
      expect(detectRes.isError).not.toBe(true);
      const detectPayload = JSON.parse(detectRes.text);
      expect(detectPayload.detected).toBeGreaterThan(0);
      expect(detectPayload.deviations.some((d: any) => d.deviationType === 'missing_file')).toBe(true);

      // Wait for debounce to flush, then check channel events.
      await sleep(500);
      const eventsRes = await agent.callTool('list_channel_events', {
        plan_uid: plan.uid,
        event_types: ['need-decision'],
      });
      const events = JSON.parse(eventsRes.text);
      expect(events.length).toBeGreaterThan(0);
      const sensorEvent = events.find(
        (e: any) => e.payload?.source === 'drift-sensor',
      );
      expect(sensorEvent).toBeTruthy();
      expect(sensorEvent.authorType).toBe('sensor');
      expect(sensorEvent.payload.deviations.length).toBeGreaterThan(0);
    } finally {
      await h.teardown();
    }
  });

  test('doc sensor posts channel event when referenced file goes stale', async () => {
    const h = await setupHarness('cdev-sensors-docs');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Create a plan (needed as channel event anchor).
      const planRes = await agent.callTool('create_plan', {
        title: 'Doc sensor test plan',
        description: 'Tests doc staleness → channel bridge.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);

      // Commit the current state so we have a HEAD to stamp against.
      execSync('git add -A && git commit -m "baseline" --allow-empty', {
        cwd: h.fixture.projectPath,
        stdio: 'pipe',
      });

      // Create a system doc referencing a real file, anchored to the plan.
      const targetFile = 'packages/shared/src/index.ts';
      const docRes = await agent.callTool('write_system_doc', {
        project_path: h.fixture.projectPath,
        title: 'Index architecture',
        body: 'Documents the main entry point.',
        references: { files: [targetFile], plans: [plan.uid] },
      });
      expect(docRes.isError).not.toBe(true);
      const doc = JSON.parse(docRes.text);

      // Verify the doc (stamps captured_against_commit to HEAD).
      await agent.callTool('verify_system_doc', { uid: doc.uid });

      // Now change the referenced file and commit so HEAD moves.
      const absTarget = path.join(h.fixture.projectPath, targetFile);
      fs.appendFileSync(absTarget, '\n// sensor test change\n');
      execSync(`git add "${targetFile}" && git commit -m "change target"`, {
        cwd: h.fixture.projectPath,
        stdio: 'pipe',
      });

      // Hit the doc-check REST endpoint (simulates git hook).
      const baseUrl = `http://localhost:${h.backend.backendPort}`;
      const checkUrl = `${baseUrl}/api/sensors/doc-check?project=${encodeURIComponent(h.fixture.projectPath)}`;
      const checkRes = await fetch(checkUrl);
      const checkJson = (await checkRes.json()) as { staleCount: number; eventsSurfaced: number };
      expect(checkJson.staleCount).toBeGreaterThan(0);
      expect(checkJson.eventsSurfaced).toBeGreaterThan(0);

      // Confirm the channel event landed.
      const eventsRes = await agent.callTool('list_channel_events', {
        plan_uid: plan.uid,
        event_types: ['need-decision'],
      });
      const events = JSON.parse(eventsRes.text);
      const docEvent = events.find(
        (e: any) => e.payload?.source === 'doc-sensor',
      );
      expect(docEvent).toBeTruthy();
      expect(docEvent.payload.docSlug).toBeTruthy();
      expect(docEvent.payload.changedFiles).toContain(targetFile);
    } finally {
      await h.teardown();
    }
  });

  test('stuck sensor fires on repetitive tool calls', async () => {
    const h = await setupHarness('cdev-sensors-stuck');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Enable stuck sensor with very low thresholds for testing.
      await agent.callTool('update_project_config', {
        project_root: h.fixture.projectPath,
        sensors: {
          stuck: { enabled: true, repetitionThreshold: 4 },
        },
      });

      // Create a plan (needed for the stuck event anchor).
      const planRes = await agent.callTool('create_plan', {
        title: 'Stuck sensor test plan',
        description: 'Tests stuck detection.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);

      // Replay identical tool calls — the stuck sensor watches the
      // MCP tool-call broadcast, so calling the same tool repeatedly
      // with very similar args should trigger the repetition heuristic.
      //
      // Use `get_plan` with the same plan_uid 5 times (threshold is 4).
      for (let i = 0; i < 5; i++) {
        await agent.callTool('get_plan', { plan_uid: plan.uid });
      }

      // Brief settle for the sensor to process.
      await sleep(500);

      // Check for a stuck channel event.
      const eventsRes = await agent.callTool('list_channel_events', {
        plan_uid: plan.uid,
        event_types: ['stuck'],
      });
      const events = JSON.parse(eventsRes.text);
      const stuckEvent = events.find(
        (e: any) => e.payload?.source === 'stuck-sensor',
      );
      expect(stuckEvent).toBeTruthy();
      expect(stuckEvent.payload.heuristic).toBe('repetition');
      expect(stuckEvent.authorType).toBe('sensor');
    } finally {
      await h.teardown();
    }
  });
});
