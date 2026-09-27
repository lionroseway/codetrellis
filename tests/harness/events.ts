/**
 * Record the backend's WebSocket broadcasts.
 *
 * Many tools and routes have a UI effect that is ONLY a broadcast —
 * `close_project` closes a tab, `open_project` switches to one. A test
 * that checks the return value alone passes whether or not anything
 * was sent, so "the renderer is told" was unverified. This connects to
 * `/ws` the way the renderer does (token header; no Origin, as a
 * non-browser client) and keeps every message.
 */

import WebSocket from 'ws';
import type { RunningBackend } from './backend';

export interface BackendEvent {
  type: string;
  payload: any;
}

export interface EventStream {
  /** Every message received so far, oldest first. */
  readonly events: readonly BackendEvent[];
  /**
   * Resolve with the first event of `type` (received at any point since
   * the stream opened) that satisfies `match`; reject after `timeoutMs`.
   */
  waitFor(type: string, match?: (payload: any) => boolean, timeoutMs?: number): Promise<any>;
  /** Events of `type` received so far. */
  ofType(type: string): BackendEvent[];
  close(): Promise<void>;
}

export async function openEventStream(backend: RunningBackend): Promise<EventStream> {
  const url = backend.baseUrl.replace(/^http/, 'ws') + '/ws';
  const ws = new WebSocket(url, { headers: { 'x-codetrellis-token': backend.capabilityToken } });
  const events: BackendEvent[] = [];
  const waiters = new Set<() => void>();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as BackendEvent;
      if (msg && typeof msg.type === 'string') events.push(msg);
    } catch { /* not JSON: not a broadcast */ }
    for (const w of [...waiters]) w();
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`/ws upgrade refused: ${res.statusCode}`)));
  });

  const find = (type: string, match?: (p: any) => boolean) =>
    events.find((e) => e.type === type && (!match || match(e.payload)));

  return {
    events,
    ofType: (type) => events.filter((e) => e.type === type),
    waitFor(type, match, timeoutMs = 5000) {
      const hit = find(type, match);
      if (hit) return Promise.resolve(hit.payload);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          const seen = [...new Set(events.map((e) => e.type))].join(', ') || 'none';
          reject(new Error(`No "${type}" broadcast within ${timeoutMs}ms (types seen: ${seen})`));
        }, timeoutMs);
        const check = () => {
          const e = find(type, match);
          if (!e) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(e.payload);
        };
        waiters.add(check);
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once('close', () => resolve());
        ws.close();
      }),
  };
}
