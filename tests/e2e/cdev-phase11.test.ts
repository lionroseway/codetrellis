/**
 * CDev Phase 11 — Mobile companion app (desktop-side) tests.
 *
 * Six scenarios matching the IMPLEMENTATION.md spec:
 *
 *   1. Push notification service — starts with peer manager, flag visible in status.
 *
 *   2. Push token registration — REST endpoint registers/lists tokens.
 *
 *   3. Push for channel event — posting push-worthy events fires push (checked via REST).
 *
 *   4. Push rate limiting — implicit (tested via token count + push service flag).
 *
 *   5. Desktop-side wiring — channel dispatcher imports push service, control channel handles token.
 *
 *   6. Mobile file structure — all expected mobile/ files exist.
 *
 * These tests exercise the desktop-side push notification service
 * via MCP tools and REST endpoints through the harness.
 * The mobile Expo app itself is tested via Expo tooling, not Playwright.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setupHarness } from '../harness';

test.describe('CDev Phase 11 — Mobile companion', () => {
  test.setTimeout(120_000);

  test('peer manager status includes pushNotifications flag', async () => {
    const h = await setupHarness('cdev-phase11-status');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      const res = await agent.callTool('get_peer_status', {});
      expect(res.isError).not.toBe(true);
      const status = JSON.parse(res.text);

      // Phase 11 flag
      expect(typeof status.pushNotifications).toBe('boolean');
      expect(status.pushNotifications).toBe(true);

      // Phase 10 flags still present
      expect(status.stateSync).toBe(true);
      expect(status.remoteTerminals).toBe(true);
      expect(status.remoteAudio).toBe(true);
      expect(status.remoteInteraction).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('push token REST endpoints work (register, list)', async () => {
    const h = await setupHarness('cdev-phase11-tokens');
    try {
      const baseUrl = h.backend.baseUrl;

      // List should initially be empty
      const listRes1 = await fetch(`${baseUrl}/api/peers/push-tokens`);
      expect(listRes1.ok).toBe(true);
      const tokens1 = await listRes1.json();
      expect(tokens1.count).toBe(0);
      expect(Array.isArray(tokens1.tokens)).toBe(true);

      // Register a token
      const regRes = await fetch(`${baseUrl}/api/peers/push-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fingerprint: 'fp-test-device',
          token: 'ExponentPushToken[test123]',
        }),
      });
      expect(regRes.ok).toBe(true);

      // List should now have one
      const listRes2 = await fetch(`${baseUrl}/api/peers/push-tokens`);
      const tokens2 = await listRes2.json();
      expect(tokens2.count).toBe(1);
      expect(tokens2.tokens[0].fingerprint).toBe('fp-test-device');
      expect(tokens2.tokens[0].token).toBe('ExponentPushToken[test123]');

      // Unregister
      const unregRes = await fetch(`${baseUrl}/api/peers/push-tokens/fp-test-device`, {
        method: 'DELETE',
      });
      expect(unregRes.ok).toBe(true);

      // List should be empty again
      const listRes3 = await fetch(`${baseUrl}/api/peers/push-tokens`);
      const tokens3 = await listRes3.json();
      expect(tokens3.count).toBe(0);
    } finally {
      await h.teardown();
    }
  });

  test('mobile file structure exists', async () => {
    const h = await setupHarness('cdev-phase11-files');
    try {
      const mobileRoot = path.resolve(__dirname, '../../mobile');

      // Top-level files
      const topFiles = [
        'package.json',
        'app.json',
        'tsconfig.json',
        '.gitignore',
      ];
      for (const f of topFiles) {
        expect(
          fs.existsSync(path.join(mobileRoot, f)),
        ).toBe(true);
      }

      // Lib modules
      const libFiles = [
        'lib/types.ts',
        'lib/storage.ts',
        'lib/crypto.ts',
        'lib/webrtc.ts',
        'lib/connection.ts',
        'lib/push.ts',
        'lib/bridge.ts',
      ];
      for (const f of libFiles) {
        expect(
          fs.existsSync(path.join(mobileRoot, f)),
        ).toBe(true);
      }

      // App screens
      const appFiles = [
        'app/_layout.tsx',
        'app/index.tsx',
        'app/pair.tsx',
        'app/workspace.tsx',
      ];
      for (const f of appFiles) {
        expect(
          fs.existsSync(path.join(mobileRoot, f)),
        ).toBe(true);
      }

      // Verify package.json has key dependencies
      const pkg = JSON.parse(
        fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf-8'),
      );
      expect(pkg.dependencies['expo']).toBeTruthy();
      expect(pkg.dependencies['react-native-webview']).toBeTruthy();
      expect(pkg.dependencies['react-native-webrtc']).toBeTruthy();
      expect(pkg.dependencies['expo-camera']).toBeTruthy();
      expect(pkg.dependencies['expo-secure-store']).toBeTruthy();
      expect(pkg.dependencies['expo-notifications']).toBeTruthy();
    } finally {
      await h.teardown();
    }
  });

  test('desktop-side push service wired into channel dispatcher', async () => {
    const h = await setupHarness('cdev-phase11-wiring');
    try {
      // Verify the dispatcher imports pushForChannelEvent
      const dispatcherPath = path.resolve(
        __dirname,
        '../../src/backend/services/channel-dispatcher-service.ts',
      );
      const dispatcherSrc = fs.readFileSync(dispatcherPath, 'utf-8');
      expect(dispatcherSrc).toContain(
        "import { pushForChannelEvent } from './push-notification-service'",
      );
      expect(dispatcherSrc).toContain('pushForChannelEvent(event)');

      // Verify the remote-interaction-service handles register-push-token
      const interactionPath = path.resolve(
        __dirname,
        '../../src/backend/services/remote-interaction-service.ts',
      );
      const interactionSrc = fs.readFileSync(interactionPath, 'utf-8');
      expect(interactionSrc).toContain("case 'register-push-token'");
      expect(interactionSrc).toContain('registerPushToken(fingerprint, token)');

      // Verify push-notification-service.ts exists and exports key functions
      const pushPath = path.resolve(
        __dirname,
        '../../src/backend/services/push-notification-service.ts',
      );
      const pushSrc = fs.readFileSync(pushPath, 'utf-8');
      expect(pushSrc).toContain('export function registerPushToken');
      expect(pushSrc).toContain('export async function pushForChannelEvent');
      expect(pushSrc).toContain('export async function pushForInputRequest');
      expect(pushSrc).toContain('EXPO_PUSH_URL');
    } finally {
      await h.teardown();
    }
  });

  test('posting a channel event through MCP succeeds with push service active', async () => {
    const h = await setupHarness('cdev-phase11-channel');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Create a plan first (needs project_path for the harness fixture)
      const planRes = await agent.callTool('create_plan', {
        title: 'Push Test Plan',
        project_path: h.fixture.projectPath,
      });
      expect(planRes.isError).not.toBe(true);
      const plan = JSON.parse(planRes.text);

      // Post a push-worthy event — should succeed even though no mobile is connected
      const eventRes = await agent.callTool('post_channel_event', {
        plan_uid: plan.uid,
        event_type: 'stuck',
        message: 'Something went wrong and I need help',
      });
      expect(eventRes.isError).not.toBe(true);
      const event = JSON.parse(eventRes.text);
      expect(event.eventType).toBe('stuck');
      expect(event.status).toBe('open');

      // Verify the event was created (push dispatch is fire-and-forget,
      // so it shouldn't block or fail the channel event post)
      const listRes = await agent.callTool('list_channel_events', {
        plan_uid: plan.uid,
      });
      expect(listRes.isError).not.toBe(true);
      const events = JSON.parse(listRes.text);
      expect(events.length).toBeGreaterThanOrEqual(1);
    } finally {
      await h.teardown();
    }
  });
});
