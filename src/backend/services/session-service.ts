import { getDb } from './database';
import { markDirty } from './persistence';
import type { AgentSessionInfo, AgentCapability } from '../../shared/types';

export function registerSession(sessionId: string, agentType: string, model?: string, capabilities?: AgentCapability[], hostTerminalId?: string): void {
  const now = Date.now();
  getDb().run(
    `INSERT OR REPLACE INTO agent_sessions (session_id, agent_type, model, capabilities, host_terminal_id, connected_at, last_seen, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    [sessionId, agentType, model || null, JSON.stringify(capabilities ?? []), hostTerminalId || null, now, now]
  );
  markDirty();
}

/** Look up the host terminal ID for an MCP session (for self-write detection). */
export function getHostTerminalId(sessionId: string): string | null {
  const result = getDb().exec(
    `SELECT host_terminal_id FROM agent_sessions WHERE session_id = ?`,
    [sessionId]
  );
  if (!result[0]?.values[0]) return null;
  return (result[0].values[0][0] as string) ?? null;
}

/** Phase 17.N — Update capabilities for an existing session. */
export function updateCapabilities(sessionId: string, capabilities: AgentCapability[]): void {
  getDb().run(
    `UPDATE agent_sessions SET capabilities = ?, last_seen = ? WHERE session_id = ?`,
    [JSON.stringify(capabilities), Date.now(), sessionId]
  );
  markDirty();
}

/** Phase 17.N — Get capabilities for a session. */
export function getSessionCapabilities(sessionId: string): AgentCapability[] {
  const result = getDb().exec(
    `SELECT capabilities FROM agent_sessions WHERE session_id = ?`,
    [sessionId]
  );
  if (!result[0]?.values[0]) return [];
  try {
    return JSON.parse(result[0].values[0][0] as string ?? '[]');
  } catch { return []; }
}

export function setActivePlan(sessionId: string, planUid: string): void {
  getDb().run(
    `UPDATE agent_sessions SET active_plan_uid = ?, last_seen = ? WHERE session_id = ?`,
    [planUid, Date.now(), sessionId]
  );
  markDirty();
}

export function heartbeat(sessionId: string): void {
  getDb().run(`UPDATE agent_sessions SET last_seen = ? WHERE session_id = ?`, [Date.now(), sessionId]);
}

export function getActiveSessions(): AgentSessionInfo[] {
  const result = getDb().exec(
    `SELECT session_id, agent_type, model, active_plan_uid, connected_at, last_seen, status, capabilities
     FROM agent_sessions WHERE status = 'active' ORDER BY connected_at DESC`
  );
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => ({
    sessionId: r[0], agentType: r[1], model: r[2], activePlanUid: r[3],
    connectedAt: r[4], lastSeen: r[5], status: r[6] as 'active' | 'inactive',
    capabilities: (() => { try { return JSON.parse(r[7] as string ?? '[]'); } catch { return []; } })(),
  }));
}

export function disconnectSession(sessionId: string): void {
  getDb().run(`UPDATE agent_sessions SET status = 'inactive', last_seen = ? WHERE session_id = ?`, [Date.now(), sessionId]);
  markDirty();
}

export function cleanStaleSessions(timeoutMs = 60000): void {
  const cutoff = Date.now() - timeoutMs;
  getDb().run(`UPDATE agent_sessions SET status = 'inactive' WHERE status = 'active' AND last_seen < ?`, [cutoff]);
}

// --- Periodic sweep ---------------------------------------------------------

let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Start a server-side periodic sweep that marks stale active sessions
 * inactive independent of any frontend poll. Without this,
 * `cleanStaleSessions` only runs when the frontend hits
 * `/api/onboarding-state`; with a backgrounded tab, ghost agents pile
 * up in the ConnectedAgents widget.
 *
 * Idempotent — calling twice keeps a single timer.
 */
export function startSessionSweep(intervalMs = 30_000, timeoutMs = 60_000): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    try {
      cleanStaleSessions(timeoutMs);
    } catch (err) {
      console.warn('[Session] periodic sweep failed:', err);
    }
  }, intervalMs);
  // Allow the process to exit without waiting on this timer (matters
  // for tests and CLI scripts).
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

/** Stop the sweep. Used in test teardown. */
export function stopSessionSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Re-label a session's agent type, but only if it still carries the type it
 * was given at connect time. Used to replace the user-agent guess with the
 * client's own `clientInfo.name`; the guard means an explicit
 * `register_session` — which may have run first — is never overwritten.
 *
 * Returns true if the row changed.
 */
export function retypeSession(sessionId: string, fromType: string, toType: string): boolean {
  const before = getDb().exec(
    `SELECT agent_type FROM agent_sessions WHERE session_id = ?`,
    [sessionId],
  );
  const current = before[0]?.values?.[0]?.[0];
  if (current !== fromType) return false;
  getDb().run(
    `UPDATE agent_sessions SET agent_type = ? WHERE session_id = ? AND agent_type = ?`,
    [toType, sessionId, fromType],
  );
  markDirty();
  return true;
}
