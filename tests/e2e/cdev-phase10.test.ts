/**
 * CDev Phase 10 — multi-device desktop-to-desktop tests.
 *
 * Five scenarios matching the IMPLEMENTATION.md spec:
 *
 *   1. State sync — local snapshot collected, remote-state endpoint returns structure.
 *
 *   2. Remote terminals — list_remote_terminals MCP tool returns valid structure.
 *
 *   3. Remote audio — get_remote_audio MCP tool returns valid structure.
 *
 *   4. Remote input — list_remote_input_requests returns empty initially,
 *      respond_remote_input handles unknown request gracefully.
 *
 *   5. Peer manager status — includes Phase 10 service flags.
 *
 * These tests exercise the API surface via MCP tools (not REST),
 * matching the harness pattern from Phase 8/9. Real two-instance
 * WebRTC connections require separate processes — deferred to
 * integration tests. These verify the tool surface and initial state.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

test.describe('CDev Phase 10 — multi-device', () => {
  test.setTimeout(120_000);

  test('peer manager status includes Phase 10 service flags', async () => {
    const h = await setupHarness('cdev-phase10-status');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      const res = await agent.callTool('get_peer_status', {});
      expect(res.isError).not.toBe(true);
      const status = JSON.parse(res.text);

      // Phase 9 fields
      expect(status.running).toBe(true);
      expect(status.instanceId).toBeTruthy();

      // Phase 10 fields
      expect(typeof status.stateSync).toBe('boolean');
      expect(typeof status.remoteTerminals).toBe('boolean');
      expect(typeof status.remoteAudio).toBe('boolean');
      expect(typeof status.remoteInteraction).toBe('boolean');

      // All services should be running
      expect(status.stateSync).toBe(true);
      expect(status.remoteTerminals).toBe(true);
      expect(status.remoteAudio).toBe(true);
      expect(status.remoteInteraction).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('get_remote_state returns valid structure (empty when no peers)', async () => {
    const h = await setupHarness('cdev-phase10-state');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      const res = await agent.callTool('get_remote_state', {});
      expect(res.isError).not.toBe(true);
      const data = JSON.parse(res.text);

      // No peers connected → peerCount should be 0
      expect(data.peerCount).toBe(0);
      expect(typeof data.states).toBe('object');
    } finally {
      await h.teardown();
    }
  });

  test('list_remote_terminals returns valid structure (empty when no peers)', async () => {
    const h = await setupHarness('cdev-phase10-terminals');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });
      // Phase 30: driving a terminal on a paired device is command execution, so it needs `terminal`.
      await h.client.grantMcpCapabilities(['read', 'write', 'project', 'files', 'terminal']);

      const res = await agent.callTool('list_remote_terminals', {});
      expect(res.isError).not.toBe(true);
      const data = JSON.parse(res.text);

      expect(data.count).toBe(0);
      expect(Array.isArray(data.terminals)).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('get_remote_audio returns valid structure', async () => {
    const h = await setupHarness('cdev-phase10-audio');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });
      // Phase 30: remote audio is the user's microphone, one device removed — `capture`.
      await h.client.grantMcpCapabilities(['read', 'write', 'project', 'files', 'capture']);

      const res = await agent.callTool('get_remote_audio', {});
      expect(res.isError).not.toBe(true);
      const data = JSON.parse(res.text);

      expect(data.count).toBe(0);
      expect(Array.isArray(data.peers)).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('remote input requests — empty initially, respond handles unknown gracefully', async () => {
    const h = await setupHarness('cdev-phase10-input');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // List should be empty
      const listRes = await agent.callTool('list_remote_input_requests', {});
      expect(listRes.isError).not.toBe(true);
      const listData = JSON.parse(listRes.text);
      expect(listData.count).toBe(0);
      expect(Array.isArray(listData.requests)).toBe(true);

      // Respond to a non-existent request should return sent=false
      const respondRes = await agent.callTool('respond_remote_input', {
        request_id: 'nonexistent-request',
        response: 'test response',
      });
      expect(respondRes.isError).not.toBe(true);
      const respondData = JSON.parse(respondRes.text);
      expect(respondData.sent).toBe(false);
    } finally {
      await h.teardown();
    }
  });
});
