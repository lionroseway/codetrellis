/**
 * Power service — Session-persistence plan / Track A §2.1.
 *
 * Single owner of the OS sleep-prevent assertion decision. Subscribes
 * to three signal sources (set via the `set*` mutators below) and
 * exposes a debounced "should we be blocking sleep right now?" output
 * via `onPowerStatusChange`. The Electron main process listens to that
 * and starts/stops `powerSaveBlocker` accordingly; the desktop UI and
 * mobile companion listen so they can render the awake indicator.
 *
 * Why a single owner: the OS power assertion is a global resource. Two
 * subsystems each toggling it on their own would race. Funnel every
 * input into this service and let it emit ONE truth.
 *
 * Why debounce: a flapping mobile heartbeat (poor cellular, VPN
 * reattach) should not toggle the OS assertion 4×/second. The
 * DEBOUNCE_MS quiet window collapses bursts into a single decision.
 *
 * Hardcoded constants (per plan's "OUT": no user-exposed knobs in v1):
 *   - DEBOUNCE_MS = 5000      → 5s settle time before flipping the OS assertion
 */

import type {
  PowerStatus,
  PowerReason,
  AcState,
  PowerPlatform,
} from '../../shared/types/power';
import { getSettings } from './settings-service';

const DEBOUNCE_MS = 5000;

// --- Inputs --------------------------------------------------------------

let mobileConnected = false;
let agentActive = false;
let acState: AcState = 'unknown';

// --- Outputs / subscribers ----------------------------------------------

const listeners = new Set<(status: PowerStatus) => void>();
let lastEmitted: PowerStatus | null = null;
let pendingEval: ReturnType<typeof setTimeout> | null = null;

// --- Platform detection -------------------------------------------------

function detectPlatform(): PowerPlatform {
  // `process.versions.electron` is truthy only in the Electron main /
  // renderer process. Backend running standalone (web mode `npm run dev`)
  // has no electron version → report 'web' so UI hides Electron-only
  // toggles like lid-close prevent.
  if (!process.versions.electron) return 'web';
  switch (process.platform) {
    case 'darwin': return 'darwin';
    case 'win32': return 'win32';
    case 'linux': return 'linux';
    default: return 'web';
  }
}

const PLATFORM: PowerPlatform = detectPlatform();

// --- State machine ------------------------------------------------------

/**
 * Pure evaluator: given current inputs + settings, compute the status
 * that should be emitted right now. No side effects.
 *
 * Reason precedence when multiple triggers fire (cosmetic — shouldBlock
 * is the same): always > mobile-connected > agent-active. "Always" is
 * the strongest claim ("I want this on no matter what"), so it wins.
 */
function evaluate(): PowerStatus {
  const settings = getSettings().power;

  let reason: PowerReason = null;
  if (settings.triggers.always) {
    reason = 'always';
  } else if (settings.triggers.whileMobileConnected && mobileConnected) {
    reason = 'mobile-connected';
  } else if (settings.triggers.whileAgentActive && agentActive) {
    reason = 'agent-active';
  }

  let shouldBlock = reason !== null;

  // AC gate: if the safety net is on and we're explicitly on battery,
  // suppress the blocker. `'unknown'` is treated as plugged-in (web
  // mode, desktops with no battery) so we don't punish stationary
  // users with the safety net.
  if (shouldBlock && settings.onlyWhenOnAC && acState === 'battery') {
    shouldBlock = false;
    reason = null;
  }

  return {
    shouldBlock,
    reason,
    ac: acState,
    platform: PLATFORM,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Two statuses are "the same" when the user-visible fields match.
 * `updatedAt` is excluded — equality is about whether to RE-emit, and
 * a fresh timestamp alone isn't a real change.
 */
function statusEqual(a: PowerStatus | null, b: PowerStatus): boolean {
  if (!a) return false;
  return a.shouldBlock === b.shouldBlock
    && a.reason === b.reason
    && a.ac === b.ac
    && a.platform === b.platform;
}

function emit(status: PowerStatus): void {
  lastEmitted = status;
  for (const cb of listeners) {
    try { cb(status); } catch (err) {
      console.warn('[Power] subscriber error:', err);
    }
  }
}

/**
 * Mark inputs dirty and schedule a re-evaluation after DEBOUNCE_MS.
 * Repeated calls within the window collapse into one. Net effect: a
 * trigger that flips and flips back inside 5s emits nothing.
 */
function scheduleEvaluate(): void {
  if (pendingEval) clearTimeout(pendingEval);
  pendingEval = setTimeout(() => {
    pendingEval = null;
    const next = evaluate();
    if (!statusEqual(lastEmitted, next)) {
      emit(next);
    }
  }, DEBOUNCE_MS);
}

// --- Signal mutators ----------------------------------------------------
//
// Each signal source (webrtc-service for mobile, channel-event-service
// for agents, Electron powerMonitor for AC) calls the matching mutator.
// No-op on identical value to avoid pointless re-evaluations.

export function setMobileConnected(value: boolean): void {
  if (mobileConnected === value) return;
  mobileConnected = value;
  scheduleEvaluate();
}

export function setAgentActive(value: boolean): void {
  if (agentActive === value) return;
  agentActive = value;
  scheduleEvaluate();
}

export function setAcState(value: AcState): void {
  if (acState === value) return;
  acState = value;
  scheduleEvaluate();
}

/**
 * Settings can change without any of the input signals changing
 * (e.g. user toggles `always` while no mobile is connected and no
 * agent is active). Callers in the settings-update path invoke this
 * to force re-evaluation.
 */
export function notifyPowerSettingsChanged(): void {
  scheduleEvaluate();
}

// --- Read API -----------------------------------------------------------

export function getCurrentPowerStatus(): PowerStatus {
  // Fall back to a fresh evaluation if startPowerService hasn't run
  // yet — callers should still get a sensible answer.
  return lastEmitted ?? evaluate();
}

/**
 * Subscribe to status changes. The current status (if any) is replayed
 * immediately to the new subscriber so UIs don't have to wait for the
 * next change to render. Returns an unsubscribe fn.
 */
export function onPowerStatusChange(cb: (status: PowerStatus) => void): () => void {
  listeners.add(cb);
  if (lastEmitted) {
    try { cb(lastEmitted); } catch (err) {
      console.warn('[Power] subscriber error:', err);
    }
  }
  return () => { listeners.delete(cb); };
}

// --- Lifecycle ----------------------------------------------------------

/**
 * Start the service. Performs an initial synchronous evaluate + emit so
 * subscribers attached after this point can render immediately. Idempotent.
 */
export function startPowerService(): void {
  if (lastEmitted) return;
  const initial = evaluate();
  emit(initial);
}

export function stopPowerService(): void {
  if (pendingEval) {
    clearTimeout(pendingEval);
    pendingEval = null;
  }
  listeners.clear();
  lastEmitted = null;
}
