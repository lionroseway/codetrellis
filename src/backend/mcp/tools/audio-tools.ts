/**
 * MCP tools for Phase 8 — audio context.
 *
 * Tools:
 *   - get_audio_context — retrieve recent audio from the rolling buffer
 *   - get_audio_status — check capture state and buffer fullness
 *
 * CodeTrellis never transcribes — multi-modal models handle the audio
 * directly. The tool returns base64-encoded WebM/Opus audio.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { audioBuffer } from '../../services/audio-buffer-service';

export function registerAudioTools(server: McpServer): void {
  server.tool(
    'start_audio_capture',
    'Start capturing audio from the user\'s microphone. Audio streams into a rolling buffer (default 120 seconds). Use get_audio_context to retrieve the buffered audio.',
    {
      max_buffer_seconds: z.number().optional().describe('Maximum buffer duration in seconds (default: 120)'),
    },
    async ({ max_buffer_seconds }) => {
      audioBuffer.startCapture(max_buffer_seconds);
      const status = audioBuffer.getStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify({ message: 'Audio capture started', status }) }],
      };
    },
  );

  server.tool(
    'stop_audio_capture',
    'Stop audio capture. The buffer is preserved and can still be read via get_audio_context until the next start.',
    {},
    async () => {
      audioBuffer.stopCapture();
      const status = audioBuffer.getStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify({ message: 'Audio capture stopped', status }) }],
      };
    },
  );

  server.tool(
    'push_audio_chunk',
    'Push a chunk of audio data into the capture buffer. Used internally by the frontend — agents should use get_audio_context to read audio.',
    {
      audio_base64: z.string().describe('Base64-encoded audio data (WebM/Opus)'),
      duration_ms: z.number().describe('Duration of this chunk in milliseconds'),
    },
    async ({ audio_base64, duration_ms }) => {
      if (!audioBuffer.isCapturing()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Audio capture is not active' }) }],
          isError: true,
        };
      }
      const data = Buffer.from(audio_base64, 'base64');
      audioBuffer.addChunk(data, duration_ms);
      return {
        content: [{ type: 'text', text: JSON.stringify({ accepted: true, status: audioBuffer.getStatus() }) }],
      };
    },
  );

  server.tool(
    'get_audio_context',
    'Get the most recent audio from the capture buffer. Returns base64-encoded WebM/Opus audio that multi-modal models can process directly. Use this when the user invokes you during a meeting or discussion — the audio provides conversation context without transcription.',
    {
      seconds: z.number().optional().describe(
        'How many seconds of recent audio to return (default: entire buffer, max: buffer size)',
      ),
    },
    async ({ seconds }) => {
      const snapshot = audioBuffer.getRecentAudio(seconds);

      if (!snapshot) {
        const status = audioBuffer.getStatus();
        const reason = status.capturing
          ? 'Audio capture is active but the buffer is empty — no chunks received yet.'
          : 'Audio capture is not active. Ask the user to start audio capture first.';

        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'No audio available', reason, status }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({
          durationSeconds: snapshot.durationSeconds,
          mimeType: snapshot.mimeType,
          startsAt: snapshot.startsAt,
          endsAt: snapshot.endsAt,
          chunkCount: snapshot.chunkCount,
          audioBase64: snapshot.audioBase64,
        }) }],
      };
    },
  );

  server.tool(
    'get_audio_status',
    'Check the audio capture state — whether capture is active, how much audio is buffered, and when capture started. Use this before get_audio_context to verify audio is available.',
    {},
    async () => {
      const status = audioBuffer.getStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify(status) }],
      };
    },
  );
}
