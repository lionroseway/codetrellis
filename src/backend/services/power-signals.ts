/**
 * Power signals — wires the three input sources (mobile-connected,
 * agent-active, AC power) into `power-service`. Kept separate from
 * power-service.ts so the state machine stays a pure
 * inputs→outputs unit and the import graph between services
 * (webrtc / channel-event / electron-IPC) doesn't bleed into it.
 *
 * Call `startPowerSignals()` once at backend startup AFTER
 * `startPowerService()`. Returns a teardown fn that unsubscribes all
 * wired signals (used by tests + clean shutdown).
 */

import {
  onConnectionStateChange,
  connectedPeerCount,
} from './webrtc-service';
import {
  setMobileConnected,
  setAgentActive,
} from './power-service';
import { addBroadcastTarget } from '../server';

/** Window after the last observed tool-call event during which the
 *  "agent-active" signal stays true. 5 min matches the plan body and
 *  is the v1 hardcoded value (no user-tunable knob in v1). */
const AGENT_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

let teardowns: Array<() => void> = [];
let running = false;

/**
 * Mobile-connected signal — flips true when ≥1 peer is currently
 * connected (heartbeat fresh — webrtc-service's heartbeat machinery
 * already drops dead peers from this count). For v1 we treat any
 * connected peer as the mobile signal since the only peer type today
 * is the CodeTrellis Companion app. When other peer types ship,
 * filter via `getPeerConnections()` + paired-device deviceType.
 */
function wireMobileConnected(): () => void {
  const recompute = () => {
    setMobileConnected(connectedPeerCount() > 0);
  };
  // Set initial state synchronously so startup status is correct.
  recompute();
  // Re-evaluate on every connection-state transition. Cheap; the
  // power-service no-ops on identical values, so multiple events that
  // don't flip the boolean cost nothing downstream.
  return onConnectionStateChange(() => recompute());
}

/**
 * Agent-active signal — taps the existing `agent-event` broadcast that
 * the MCP server emits for every `tool_call` / `tool_error`. Maintains
 * a sliding window: any tool event marks the agent active and (re)arms
 * a 5-minute timer; if no further tool events arrive before it fires,
 * the agent is marked inactive.
 *
 * We hook in via `addBroadcastTarget` (the same path Electron uses to
 * receive broadcasts) — clean, doesn't require modifying the MCP
 * server, picks up every tool event already going out.
 */
function wireAgentActive(): () => void {
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const unsub = addBroadcastTarget(({ type, payload }) => {
    if (type !== 'agent-event') return;
    const evt = payload as { type?: string } | null | undefined;
    if (!evt || (evt.type !== 'tool_call' && evt.type !== 'tool_error')) return;

    setAgentActive(true);
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      setAgentActive(false);
      resetTimer = null;
    }, AGENT_ACTIVE_WINDOW_MS);
  });

  return () => {
    unsub();
    if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
    setAgentActive(false);
  };
}

/**
 * Start all wired signals. Idempotent.
 */
export function startPowerSignals(): void {
  if (running) return;
  running = true;
  teardowns.push(wireMobileConnected());
  teardowns.push(wireAgentActive());
  // 2.4 AC power is wired in `src/electron/main.ts` (powerMonitor
  // events) and bridges into power-service via setAcState. No signal
  // to wire here for web mode.
}

export function stopPowerSignals(): void {
  if (!running) return;
  running = false;
  for (const fn of teardowns) {
    try { fn(); } catch (err) { console.warn('[PowerSignals] teardown error:', err); }
  }
  teardowns = [];
}
