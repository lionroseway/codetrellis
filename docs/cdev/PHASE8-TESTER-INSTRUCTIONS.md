# Phase 8 — Audio Context: Tester Instructions

## What was built

Phase 8 delivers the "AI in collaboration" audio pipeline. When a user is in a meeting or discussion, they press a hotkey — recent audio is buffered and available to their AI agent via MCP. CodeTrellis never transcribes; multi-modal models handle audio directly.

### Components

1. **Audio buffer service** (`src/backend/services/audio-buffer-service.ts`)
   - In-memory rolling buffer of timestamped WebM/Opus audio chunks
   - Default max: 120 seconds; configurable on start
   - Evicts oldest chunks when buffer exceeds max duration
   - Buffer preserved after stop (readable until next start clears it)

2. **MCP tools** (`src/backend/mcp/tools/audio-tools.ts`)
   - `start_audio_capture({ max_buffer_seconds? })` — begin capture
   - `stop_audio_capture({})` — stop capture, preserve buffer
   - `push_audio_chunk({ audio_base64, duration_ms })` — push chunk (used by frontend)
   - `get_audio_context({ seconds? })` — retrieve recent audio as base64
   - `get_audio_status({})` — check capture state and buffer fullness

3. **REST endpoints** (in `src/backend/server.ts`)
   - `POST /api/audio/start` — start capture
   - `POST /api/audio/stop` — stop capture
   - `GET /api/audio/status` — buffer status
   - `POST /api/audio/chunk` — push audio chunk
   - `GET /api/audio/recent?seconds=N` — get recent audio

4. **Frontend** (`src/frontend/components/audio/AudioCaptureBar.tsx`)
   - Toggle button with red pulse animation when active
   - Hotkey: `Ctrl+Shift+M` (Mac: `Cmd+Shift+M`)
   - Shows buffered seconds and chunk count
   - Handles mic permission errors gracefully

## How to test

### Prerequisites

- `npm run dev` running (web mode)
- A browser with microphone access (Chrome recommended)
- An MCP client connected (Claude Code, or the test harness)

### Manual testing

1. **Start capture via UI**
   - Look for the audio capture bar (bottom of workspace or top bar)
   - Click "Start audio capture" or press `Ctrl/Cmd+Shift+M`
   - Grant microphone permission when prompted
   - Verify the button turns red with a pulse animation
   - Speak for a few seconds; verify "Xs buffered · N chunks" updates

2. **Verify agent access**
   - With capture running, have an agent call `get_audio_status`
   - Verify it shows `capturing: true` and a non-zero `bufferedSeconds`
   - Have the agent call `get_audio_context` (optionally with `seconds: 5`)
   - Verify it returns `audioBase64`, `durationSeconds`, `mimeType`

3. **Stop and verify preservation**
   - Click "Stop capture" or press `Ctrl/Cmd+Shift+M` again
   - Call `get_audio_context` — should still return the buffered audio
   - Call `get_audio_status` — `capturing: false` but `bufferedSeconds > 0`

4. **Restart clears buffer**
   - Start capture again
   - Immediately call `get_audio_status` — `bufferedSeconds` should be 0

5. **Error handling**
   - Deny microphone permission → verify error message shows
   - Try `push_audio_chunk` when not capturing → verify error response

### Automated tests

```bash
npx playwright test --config playwright.harness.config.ts cdev-phase8
```

3 tests, all passing:
- Buffer accepts chunks and returns recent audio via MCP
- get_audio_context returns audio and get_audio_status reports state
- Start/stop round-trip with buffer clear on restart

## What to look for

1. **Buffer eviction**: With a small `max_buffer_seconds` (e.g., 10), adding more chunks than the buffer can hold should evict the oldest ones. The `chunkCount` in status should reflect only what fits.

2. **Chunk rejection**: Calling `push_audio_chunk` when capture is not active should return an error (`isError: true`).

3. **Multi-modal readiness**: The `audioBase64` returned by `get_audio_context` should be valid base64-encoded WebM/Opus that a multi-modal model could consume. (The test uses synthetic random bytes, but the structure is correct.)

4. **No transcription**: Verify there is no text transcription anywhere in the pipeline. Audio is raw bytes in, raw bytes out to the model.

## Known limitations

- **Browser only**: System audio loopback (capturing Zoom/Meet/Teams output) requires the Electron build with ScreenCaptureKit or a virtual audio device. Currently mic-only.
- **Single buffer**: One global buffer shared across all agents. No per-agent or per-meeting isolation yet.
- **No persistence**: Buffer is in-memory only. Refreshing the backend clears it.
- **Chunk size**: Frontend sends 2-second chunks at 64kbps. Roughly 16KB per chunk, ~960KB for a full 120-second buffer.
