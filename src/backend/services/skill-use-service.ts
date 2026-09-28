/**
 * Phase 32 C1.3 — proof that a task's skill was used.
 *
 * Claude Code records each skill it loads as a `Skill` tool call in its
 * session log, and the watcher reads every tool call. When it sees one, the
 * use is stored against every task a Claude Code session in the same
 * workstream is working (assigned or in progress), since the watcher's
 * session and the MCP session that claimed the task are two views of the
 * same agent, joined by the folder they share.
 *
 * Reading it back: a task's wanted skill is `used` when a use is stored,
 * `not_used` while a Claude Code agent is working the task without one, and
 * `unknown` when anything else is working it, because other clients record
 * no such thing. Nobody on the task yet means no answer at all.
 */

import { getDb } from './database';
import type { PlanItem, Skill, SkillProof } from '../../shared/types';

const MAX_SKILL = 80;

function rowsOf<T>(sql: string, params: Array<string | number> = []): T[] {
  const res = getDb().exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

/** True for the agent types that are Claude Code (the watcher's own client). */
export function isClaudeCode(agentType: string | null | undefined): boolean {
  return !!agentType && /^claude(-code)?\b/i.test(agentType) && !/desktop/i.test(agentType);
}

/**
 * A skill loaded in `workstreamRoot`: stored against each task a Claude Code
 * session there is working. Returns those tasks' uids (none when no task is
 * being worked there, and then nothing is stored).
 */
export function recordSkillUse(input: { skill: string; sessionId: string | null; workstreamRoot: string | null; at?: number }): string[] {
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  const skill = input.skill.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_SKILL);
  if (!skill || !input.workstreamRoot) return [];
  try {
    const items = rowsOf<{ uid: string; agent_type: string | null }>(
      `SELECT i.uid, s.agent_type FROM plan_items i JOIN agent_sessions s ON s.session_id = i.assignee_session
        WHERE s.workstream_root = ? AND i.status IN ('assigned', 'in_progress')`,
      [input.workstreamRoot],
    ).filter((r) => isClaudeCode(r.agent_type)).map((r) => r.uid);
    const at = input.at ?? Date.now();
    for (const uid of items) {
      getDb().run(
        'INSERT INTO skill_uses (item_uid, skill, session_id, workstream_root, at) VALUES (?, ?, ?, ?, ?)',
        [uid, skill, input.sessionId, input.workstreamRoot, at],
      );
    }
    return items;
  } catch {
    return [];
  }
}

/** The skills used on a task, by name, with when each was first used. */
export function skillUsesOf(itemUid: string): Map<string, number> {
  try {
    const rows = rowsOf<{ skill: string; at: number }>('SELECT skill, MIN(at) AS at FROM skill_uses WHERE item_uid = ? GROUP BY skill', [itemUid]);
    return new Map(rows.map((r) => [r.skill, Number(r.at)]));
  } catch {
    return new Map();
  }
}

/** Who is working the task: the agent type of its assignee session, or null. */
function assigneeAgentType(item: Pick<PlanItem, 'uid'>): string | null | undefined {
  try {
    const row = rowsOf<{ session: string | null; agent_type: string | null }>(
      `SELECT i.assignee_session AS session, s.agent_type FROM plan_items i LEFT JOIN agent_sessions s ON s.session_id = i.assignee_session WHERE i.uid = ?`,
      [item.uid],
    )[0];
    if (!row?.session) return undefined;
    return row.agent_type;
  } catch {
    return undefined;
  }
}

/**
 * For each of the task's wanted skills (required or recommended): used, not
 * used, or unknown. Null when no agent has worked the task, so a task nobody
 * has started never reads "not used".
 */
export function skillProof(item: Pick<PlanItem, 'uid'>, skills: readonly Skill[]): Map<string, SkillProof> | null {
  const uses = skillUsesOf(item.uid);
  const agentType = assigneeAgentType(item);
  if (agentType === undefined && uses.size === 0) return null;
  const out = new Map<string, SkillProof>();
  for (const s of skills) {
    if (!s.required && s.use !== 'recommended') continue;
    // A plugin's skill is loaded as `plugin:name`.
    const used = uses.has(s.name) || [...uses.keys()].some((k) => k.endsWith(`:${s.name}`));
    out.set(s.name, used ? 'used' : isClaudeCode(agentType) ? 'not_used' : 'unknown');
  }
  return out;
}
