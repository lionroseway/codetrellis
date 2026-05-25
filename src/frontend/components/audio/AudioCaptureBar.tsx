/**
 * AudioCaptureBar — Phase 8.1 / 8.2.
 *
 * A compact bar that lets the user toggle audio capture from their
 * microphone. When active, audio chunks stream to the backend's
 * rolling buffer. Agents can then call `get_audio_context` to receive
 * the recent audio for multi-modal processing.
 *
 * Placement: bottom of the plan workspace or in the top bar.
 * Hotkey: Ctrl/Cmd+Shift+M to toggle.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Radio } from 'lucide-react';

interface CaptureStatus {
  capturing: boolean;
  bufferedSeconds: number;
  chunkCount: number;
  maxBufferSeconds: number;
  startedAt: string | null;
}

const CHUNK_INTERVAL_MS = 2000; // send a chunk every 2 seconds

export function AudioCaptureBar() {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll status periodically when capturing
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, []);

  // Hotkey: Ctrl/Cmd+Shift+M
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        if (status?.capturing) {
          stopCapture();
        } else {
          startCapture();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [status?.capturing]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/audio/status');
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  };

  const startCapture = useCallback(async () => {
    setError(null);
    try {
      // Request mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      });
      streamRef.current = stream;

      // Tell backend to start capturing
      await fetch('/api/audio/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxBufferSeconds: 120 }),
      });

      // Set up MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        if (event.data.size === 0) return;

        try {
          const arrayBuffer = await event.data.arrayBuffer();
          const base64 = btoa(
            String.fromCharCode(...new Uint8Array(arrayBuffer)),
          );

          await fetch('/api/audio/chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64,
              durationMs: CHUNK_INTERVAL_MS,
            }),
          });
        } catch { /* chunk delivery failure — buffer continues */ }
      };

      recorder.start(CHUNK_INTERVAL_MS);

      // Refresh status
      await fetchStatus();
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access denied'
          : `Failed to start capture: ${err}`,
      );
    }
  }, []);

  const stopCapture = useCallback(async () => {
    // Stop MediaRecorder
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Stop media stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    // Tell backend to stop
    await fetch('/api/audio/stop', { method: 'POST' });
    await fetchStatus();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const capturing = status?.capturing ?? false;

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-xs border-t ${
      capturing
        ? 'bg-red-950/20 border-red-900/30'
        : 'bg-zinc-900/40 border-zinc-800/40'
    }`}>
      <button
        onClick={capturing ? stopCapture : startCapture}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
          capturing
            ? 'bg-red-900/40 text-red-300 hover:bg-red-900/60'
            : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-300'
        }`}
      >
        {capturing ? (
          <>
            <Radio size={11} className="animate-pulse" />
            Stop capture
          </>
        ) : (
          <>
            <Mic size={11} />
            Start audio capture
          </>
        )}
      </button>

      {capturing && status && (
        <span className="text-[10px] text-zinc-500">
          {status.bufferedSeconds}s buffered
          <span className="text-zinc-600"> · </span>
          {status.chunkCount} chunks
        </span>
      )}

      {!capturing && (
        <span className="text-[10px] text-zinc-600">
          <kbd className="px-1 py-0.5 rounded bg-zinc-800/60 text-zinc-500 text-[9px]">
            {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+⇧+M
          </kbd>
        </span>
      )}

      {error && (
        <span className="flex items-center gap-1 text-[10px] text-red-400">
          <MicOff size={9} />
          {error}
        </span>
      )}
    </div>
  );
}
