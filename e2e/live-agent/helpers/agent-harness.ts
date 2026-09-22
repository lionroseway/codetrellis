/**
 * Agent harness — helpers for spawning terminals, injecting prompts,
 * waiting for WebSocket events, and collecting terminal output.
 *
 * Works with both real Claude (via terminal inject) and mock agents
 * (via MCP client).
 */

import { type APIRequestContext } from '@playwright/test';
import WebSocket from 'ws';
import { authHeaders } from '../../helpers/setup';

const API = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001/ws';

// ─────────────────────────────────────────────────
// Terminal helpers
// ─────────────────────────────────────────────────

/**
 * Spawn a terminal with a given preset.  Returns the terminal ID.
 */
export async function spawnTerminal(
  request: APIRequestContext,
  opts: { preset?: string; cwd: string },
): Promise<string> {
  const res = await request.post(`${API}/terminals`, {
    data: {
      preset: opts.preset ?? 'shell',
      cwd: opts.cwd,
      cols: 120,
      rows: 30,
    },
  });
  const data = await res.json();
  return data.id;
}

/**
 * Inject text into a terminal via the inject API.
 * Equivalent to the user typing in the terminal.
 */
export async function injectPrompt(
  request: APIRequestContext,
  termId: string,
  text: string,
): Promise<void> {
  await request.post(`${API}/terminals/${termId}/inject`, {
    data: { text },
  });
}

/**
 * Kill a terminal session.
 */
export async function killTerminal(
  request: APIRequestContext,
  termId: string,
): Promise<void> {
  await request.delete(`${API}/terminals/${termId}`);
}

// ─────────────────────────────────────────────────
// WebSocket event helper
// ─────────────────────────────────────────────────

export interface WsEventCollector {
  /** Wait for a broadcast event matching type + optional payload fields. */
  waitForEvent(
    eventType: string,
    match?: Record<string, unknown>,
    timeout?: number,
  ): Promise<Record<string, unknown>>;

  /** Get all events collected so far. */
  getEvents(): Array<{ type: string; payload: unknown }>;

  /** Close the WebSocket connection. */
  close(): void;
}

/**
 * Open a WebSocket connection to the backend and collect broadcast
 * events.  Provides `waitForEvent()` for assertions.
 */
export function createWsCollector(): Promise<WsEventCollector> {
  return new Promise((resolve, reject) => {
    const events: Array<{ type: string; payload: any }> = [];
    const waiters: Array<{
      type: string;
      match?: Record<string, unknown>;
      resolve: (evt: Record<string, unknown>) => void;
      reject: (err: Error) => void;
    }> = [];

    // The WebSocket authenticates (Phase 19): send the token, or 401.
    const ws = new WebSocket(WS_URL, { headers: authHeaders() });

    ws.on('open', () => {
      resolve({
        waitForEvent(eventType, match, timeout = 30_000) {
          // Check already-collected events first
          const existing = events.find(
            (e) => e.type === eventType && matchPayload(e.payload, match),
          );
          if (existing) {
            return Promise.resolve(existing.payload);
          }

          return new Promise<Record<string, unknown>>((res, rej) => {
            const timer = setTimeout(() => {
              rej(new Error(
                `Timed out waiting for WS event "${eventType}" ` +
                `(match: ${JSON.stringify(match)}) after ${timeout}ms. ` +
                `Events received: [${events.map((e) => e.type).join(', ')}]`,
              ));
            }, timeout);

            waiters.push({
              type: eventType,
              match,
              resolve: (evt) => { clearTimeout(timer); res(evt); },
              reject: (err) => { clearTimeout(timer); rej(err); },
            });
          });
        },

        getEvents() {
          return [...events];
        },

        close() {
          for (const w of waiters) {
            w.reject(new Error('WsCollector closed'));
          }
          waiters.length = 0;
          ws.close();
        },
      });
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const type = msg.type as string;
        const payload = msg.payload ?? msg;
        events.push({ type, payload });

        // Check waiters
        for (let i = waiters.length - 1; i >= 0; i--) {
          const w = waiters[i];
          if (w.type === type && matchPayload(payload, w.match)) {
            waiters.splice(i, 1);
            w.resolve(payload);
          }
        }
      } catch {
        // Not JSON — ignore
      }
    });

    ws.on('error', (err) => reject(err));
  });
}

function matchPayload(
  payload: any,
  match?: Record<string, unknown>,
): boolean {
  if (!match) return true;
  if (!payload || typeof payload !== 'object') return false;
  for (const [key, value] of Object.entries(match)) {
    if (payload[key] !== value) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────
// Plan lookup
// ─────────────────────────────────────────────────

/**
 * Find a plan UID by title.  Polls briefly if it hasn't appeared yet.
 */
export async function getPlanUidByTitle(
  request: APIRequestContext,
  title: string,
  maxAttempts = 10,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await request.get(`${API}/plans`);
    const plans = await res.json();
    const found = plans.find((p: any) => p.title === title);
    if (found) return found.uid;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Plan "${title}" not found after ${maxAttempts} attempts`);
}
