/**
 * Session-persistence plan / Track A — power-status broadcast shape.
 *
 * Emitted by the backend `power-service` whenever any input changes
 * (settings update, mobile-connected flip, agent-active window flip,
 * AC power change). Consumed by:
 *  - Desktop TopBar awake indicator
 *  - Desktop Settings panel "Power & Connectivity" section
 *  - Mobile companion settings + status badge (via mobile-rpc-service)
 *  - Electron main process (via IPC) to start / stop the
 *    `powerSaveBlocker` and any `caffeinate -s` child process
 */

/** Why the assertion is currently held (null = not held). */
export type PowerReason =
  | 'mobile-connected'
  | 'agent-active'
  | 'always'
  | null;

/** AC adapter state. `'unknown'` covers web mode (no Electron) and
 *  desktops with no battery. Treat unknown as plugged-in for gate
 *  purposes — don't punish stationary users with the safety net. */
export type AcState = 'plugged' | 'battery' | 'unknown';

/** Process platform exposed in status so mobile UI can platform-gate
 *  options like the lid-close toggle. */
export type PowerPlatform = 'darwin' | 'win32' | 'linux' | 'web';

export interface PowerStatus {
  /** Whether the OS sleep-prevent assertion is currently engaged. */
  shouldBlock: boolean;
  /** Which active trigger is keeping it engaged, or null if not held. */
  reason: PowerReason;
  /** AC adapter state at the moment of this emit. */
  ac: AcState;
  /** Platform the desktop process is running on. */
  platform: PowerPlatform;
  /** ISO timestamp of this status emission. */
  updatedAt: string;
}
