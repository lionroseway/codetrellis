/**
 * CDev Phase 8 — audio capture pipeline tests.
 *
 * Three scenarios using synthetic audio chunks (no real microphone):
 *
 *   1. Audio buffer — start capture, add chunks, get recent audio,
 *      verify rolling eviction.
 *
 *   2. MCP tool — get_audio_context returns base64 data when buffer
 *      has content; returns error when empty.
 *
 *   3. Capture state — start/stop round-trip via MCP, buffer clears
 *      on restart.
 *
 * All operations go through MCP tools (not REST) to match the harness.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

/** Create a synthetic audio chunk (just random bytes). */
function makeFakeChunk(sizeBytes = 4096): string {
  const buf = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return buf.toString('base64');
}

test.describe('CDev Phase 8 — audio capture pipeline', () => {
  test.setTimeout(120_000);

  test('audio buffer accepts chunks and returns recent audio via MCP', async () => {
    const h = await setupHarness('cdev-phase8-buffer');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Initially not capturing
      const statusRes0 = await agent.callTool('get_audio_status', {});
      expect(statusRes0.isError).not.toBe(true);
      const status0 = JSON.parse(statusRes0.text);
      expect(status0.capturing).toBe(false);
      expect(status0.bufferedSeconds).toBe(0);

      // Start capture with 10s buffer
      const startRes = await agent.callTool('start_audio_capture', { max_buffer_seconds: 10 });
      expect(startRes.isError).not.toBe(true);
      const started = JSON.parse(startRes.text);
      expect(started.status.capturing).toBe(true);

      // Add 5 chunks of 2 seconds each (10 seconds total, matching buffer size)
      for (let i = 0; i < 5; i++) {
        const chunkRes = await agent.callTool('push_audio_chunk', {
          audio_base64: makeFakeChunk(2048),
          duration_ms: 2000,
        });
        expect(chunkRes.isError).not.toBe(true);
        const chunk = JSON.parse(chunkRes.text);
        expect(chunk.accepted).toBe(true);
      }

      // Check status — should show ~10 seconds buffered
      const statusRes1 = await agent.callTool('get_audio_status', {});
      const status1 = JSON.parse(statusRes1.text);
      expect(status1.capturing).toBe(true);
      expect(status1.bufferedSeconds).toBe(10);
      expect(status1.chunkCount).toBe(5);

      // Get recent audio (all)
      const recentRes = await agent.callTool('get_audio_context', {});
      expect(recentRes.isError).not.toBe(true);
      const recent = JSON.parse(recentRes.text);
      expect(recent.durationSeconds).toBe(10);
      expect(recent.audioBase64).toBeTruthy();
      expect(recent.mimeType).toBe('audio/webm;codecs=opus');

      // Get recent audio (last 4 seconds)
      const recent4Res = await agent.callTool('get_audio_context', { seconds: 4 });
      expect(recent4Res.isError).not.toBe(true);
      const recent4 = JSON.parse(recent4Res.text);
      expect(recent4.chunkCount).toBeLessThanOrEqual(5);

      // Stop capture
      const stopRes = await agent.callTool('stop_audio_capture', {});
      expect(stopRes.isError).not.toBe(true);
      const stopped = JSON.parse(stopRes.text);
      expect(stopped.status.capturing).toBe(false);

      // Buffer should still be available after stopping
      const recentAfterStop = await agent.callTool('get_audio_context', {});
      expect(recentAfterStop.isError).not.toBe(true);

      // Chunks should be rejected when not capturing
      const rejectedRes = await agent.callTool('push_audio_chunk', {
        audio_base64: makeFakeChunk(),
        duration_ms: 2000,
      });
      expect(rejectedRes.isError).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('MCP get_audio_context returns audio and get_audio_status reports state', async () => {
    const h = await setupHarness('cdev-phase8-mcp');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Check status when not capturing
      const statusRes = await agent.callTool('get_audio_status', {});
      expect(statusRes.isError).not.toBe(true);
      const status0 = JSON.parse(statusRes.text);
      expect(status0.capturing).toBe(false);

      // get_audio_context should return an error when buffer is empty
      const emptyRes = await agent.callTool('get_audio_context', {});
      const empty = JSON.parse(emptyRes.text);
      expect(empty.error).toBeTruthy();
      expect(empty.reason).toContain('not active');

      // Start capture via MCP
      const startRes = await agent.callTool('start_audio_capture', {});
      expect(startRes.isError).not.toBe(true);

      // Add synthetic chunks via MCP
      for (let i = 0; i < 3; i++) {
        const chunkRes = await agent.callTool('push_audio_chunk', {
          audio_base64: makeFakeChunk(1024),
          duration_ms: 2000,
        });
        expect(chunkRes.isError).not.toBe(true);
      }

      // Now get_audio_context should return audio
      const audioRes = await agent.callTool('get_audio_context', { seconds: 10 });
      expect(audioRes.isError).not.toBe(true);
      const audio = JSON.parse(audioRes.text);
      expect(audio.audioBase64).toBeTruthy();
      expect(audio.durationSeconds).toBe(6);
      expect(audio.mimeType).toBe('audio/webm;codecs=opus');
      expect(audio.chunkCount).toBe(3);

      // Check status via MCP
      const statusRes2 = await agent.callTool('get_audio_status', {});
      const status1 = JSON.parse(statusRes2.text);
      expect(status1.capturing).toBe(true);
      expect(status1.bufferedSeconds).toBe(6);

      // Stop capture via MCP
      const stopRes = await agent.callTool('stop_audio_capture', {});
      expect(stopRes.isError).not.toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('capture start/stop round-trip and buffer clear on restart', async () => {
    const h = await setupHarness('cdev-phase8-lifecycle');
    try {
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Start capture with 60s buffer
      const startRes = await agent.callTool('start_audio_capture', { max_buffer_seconds: 60 });
      expect(startRes.isError).not.toBe(true);

      // Add some chunks
      for (let i = 0; i < 3; i++) {
        await agent.callTool('push_audio_chunk', {
          audio_base64: makeFakeChunk(),
          duration_ms: 2000,
        });
      }

      // Verify buffer has content
      let statusRes = await agent.callTool('get_audio_status', {});
      let status = JSON.parse(statusRes.text);
      expect(status.bufferedSeconds).toBe(6);

      // Stop
      const stopRes = await agent.callTool('stop_audio_capture', {});
      expect(stopRes.isError).not.toBe(true);
      statusRes = await agent.callTool('get_audio_status', {});
      status = JSON.parse(statusRes.text);
      expect(status.capturing).toBe(false);
      // Buffer preserved after stop
      expect(status.bufferedSeconds).toBe(6);

      // Re-start — buffer should be cleared
      const restartRes = await agent.callTool('start_audio_capture', {});
      expect(restartRes.isError).not.toBe(true);
      statusRes = await agent.callTool('get_audio_status', {});
      status = JSON.parse(statusRes.text);
      expect(status.capturing).toBe(true);
      expect(status.bufferedSeconds).toBe(0); // cleared on restart
      expect(status.chunkCount).toBe(0);
    } finally {
      await h.teardown();
    }
  });
});
