/**
 * CDev Phase 5 — personal continuity & app polish tests.
 *
 * Three scenarios:
 *
 *   1. First-run wizard gate — fresh settings have firstRunComplete=false;
 *      after completing the wizard via the REST API, the flag flips.
 *   2. Per-item visibility round-trip — create a plan item, toggle its
 *      visibility to local, confirm the API reflects the change, toggle
 *      it back.
 *   3. Personal sync export/import cycle — configure a sync path, export,
 *      peek the sync dir, import on a "fresh" settings state.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, sleep } from '../harness';

test.describe('CDev Phase 5 — personal continuity', () => {
  test.setTimeout(120_000);

  test('first-run check and completion round-trip', async () => {
    const h = await setupHarness('cdev-phase5-firstrun');
    try {
      // On a fresh harness, firstRunComplete should be false.
      const checkRes = await h.client.raw('GET', '/api/settings/first-run-check');
      const check = await checkRes.json() as {
        firstRunComplete: boolean;
        identity: { displayName: string; email: string };
        gitDefaults: { name: string; email: string };
      };
      expect(check.firstRunComplete).toBe(false);
      expect(check.identity.displayName).toBe('');
      expect(check.identity.email).toBe('');

      // Simulate the wizard: set identity + firstRunComplete.
      const identityRes = await h.client.raw('PUT', '/api/settings', {
        identity: { displayName: 'Test User', email: 'test@example.com' },
      });
      expect(identityRes.ok).toBe(true);

      const completeRes = await h.client.raw('PUT', '/api/settings', {
        firstRunComplete: true,
      });
      expect(completeRes.ok).toBe(true);
      const completed = await completeRes.json() as { firstRunComplete: boolean };
      expect(completed.firstRunComplete).toBe(true);

      // Re-check: should now be true.
      const recheck = await (await h.client.raw('GET', '/api/settings/first-run-check')).json() as {
        firstRunComplete: boolean;
        identity: { displayName: string; email: string };
      };
      expect(recheck.firstRunComplete).toBe(true);
      expect(recheck.identity.displayName).toBe('Test User');
      expect(recheck.identity.email).toBe('test@example.com');

      // Verify it persisted to disk.
      const settingsPath = path.join(h.fixture.dataDir, 'settings.json');
      const onDisk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(onDisk.firstRunComplete).toBe(true);
      expect(onDisk.identity.displayName).toBe('Test User');
    } finally {
      await h.teardown();
    }
  });

  test('per-item visibility toggle round-trips through API', async () => {
    const h = await setupHarness('cdev-phase5-visibility');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Create a plan + item.
      const planRes = await agent.callTool('create_plan', {
        title: 'Visibility test plan',
        description: 'Tests per-item visibility toggle.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);

      const itemRes = await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'action',
        title: 'Auth module',
        status: 'pending',
      });
      const item = JSON.parse(itemRes.text);

      // Default visibility should be 'shared'.
      expect(item.visibility).toBe('shared');

      // Toggle to local.
      const updateRes = await agent.callTool('update_item', {
        uid: item.uid,
        visibility: 'local',
      });
      const updated = JSON.parse(updateRes.text);
      expect(updated.visibility).toBe('local');

      // Read back via get_item.
      const readRes = await agent.callTool('get_item', { uid: item.uid });
      const readItem = JSON.parse(readRes.text);
      expect(readItem.visibility).toBe('local');

      // Toggle back to shared.
      const revert = await agent.callTool('update_item', {
        uid: item.uid,
        visibility: 'shared',
      });
      expect(JSON.parse(revert.text).visibility).toBe('shared');
    } finally {
      await h.teardown();
    }
  });

  test('personal sync export and import cycle', async () => {
    const h = await setupHarness('cdev-phase5-sync');
    try {
      // Create a temp directory for the sync target.
      const syncDir = path.join(h.fixture.dataDir, 'sync-target');
      fs.mkdirSync(syncDir, { recursive: true });

      // Configure sync: set the path and mode.
      await h.client.raw('PUT', '/api/settings', {
        identity: { displayName: 'Sync User', email: 'sync@test.dev' },
        data: {
          dataDirOverride: '',
          personalSyncPath: syncDir,
          personalSyncMode: 'selective',
        },
        firstRunComplete: true,
      });

      // Check sync status — should be configured but no sync dir yet.
      const statusRes = await (await h.client.raw('GET', '/api/sync/status')).json() as {
        configured: boolean;
        mode: string;
        syncDirExists: boolean;
      };
      expect(statusRes.configured).toBe(true);
      expect(statusRes.mode).toBe('selective');

      // Export.
      const exportRes = await (await h.client.raw('POST', '/api/sync/export')).json() as {
        exported: boolean;
        syncDir: string | null;
        error?: string;
      };
      expect(exportRes.exported).toBe(true);
      expect(exportRes.syncDir).toBeTruthy();

      // Verify files were written.
      const syncSubDir = path.join(syncDir, 'codetrellis-sync');
      expect(fs.existsSync(path.join(syncSubDir, 'settings.json'))).toBe(true);
      expect(fs.existsSync(path.join(syncSubDir, '.sync-meta.json'))).toBe(true);

      // Verify exported settings don't include machine-local fields.
      const exportedSettings = JSON.parse(
        fs.readFileSync(path.join(syncSubDir, 'settings.json'), 'utf-8'),
      );
      expect(exportedSettings.identity.displayName).toBe('Sync User');
      expect(exportedSettings.data.personalSyncPath).toBe(''); // stripped
      expect(exportedSettings.data.dataDirOverride).toBe(''); // stripped

      // Peek — should report available.
      const peekRes = await (await h.client.raw('GET', '/api/sync/peek')).json() as {
        available: boolean;
        hasSettings: boolean;
        remoteMachine: string | null;
      };
      expect(peekRes.available).toBe(true);
      expect(peekRes.hasSettings).toBe(true);

      // Now simulate "new machine": reset identity in settings.
      await h.client.raw('PUT', '/api/settings', {
        identity: { displayName: '', email: '' },
      });

      // Verify identity is cleared.
      const cleared = await (await h.client.raw('GET', '/api/settings')).json() as {
        identity: { displayName: string; email: string };
      };
      expect(cleared.identity.displayName).toBe('');

      // Import from the sync dir.
      const importRes = await (await h.client.raw('POST', '/api/sync/import')).json() as {
        imported: boolean;
        settingsImported: boolean;
      };
      expect(importRes.imported).toBe(true);
      expect(importRes.settingsImported).toBe(true);

      // Verify identity was restored.
      const restored = await (await h.client.raw('GET', '/api/settings')).json() as {
        identity: { displayName: string; email: string };
        firstRunComplete: boolean;
      };
      expect(restored.identity.displayName).toBe('Sync User');
      expect(restored.identity.email).toBe('sync@test.dev');
      expect(restored.firstRunComplete).toBe(true);
    } finally {
      await h.teardown();
    }
  });
});
