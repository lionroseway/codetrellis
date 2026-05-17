import { getDb } from './database';
import { markDirty } from './persistence';
import type { AgentSessionInfo, AgentCapability } from '../../shared/types';

export function registerSession(sessionId: string, agentType: string, model?: string, capabilities?: AgentCapability[]): void {
  const now = Date.now();
  getDb().run(
    `INSERT OR REPLACE INTO agent_sessions (session_id, agent_type, model, capabilities, connected_at, last_seen, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [sessionId, agentType, model || null, JSON.stringify(capabilities ?? []), now, now]
  );
  markDirty();
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
