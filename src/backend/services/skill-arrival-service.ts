/**
 * Phase 32 C1.4 — a skill that arrives in a plan file is flagged once, and
 * held back from agents until a person accepts it.
 *
 * A skill is instructions an agent follows with full trust, and plan files
 * arrive through git from anyone who can push. So when a plan-file import
 * adds a recommended or required skill an item did not have before, the
 * arrival is recorded with who added it and in which commit (as `git log`
 * says; an edit not committed yet says so), and until a person accepts it:
 *
 *   - no agent is told to use it (get_brief, claim_item, get_next_item and
 *     the copied prompt all leave it out);
 *   - the plan's readiness list and the item's skills say it is waiting.
 *
 * Skills added in the app are not arrivals: the person adding them is the
 * one who would accept them, and CodeTrellis re-importing its own write of
 * the plan file finds the same skills as before, so records nothing.
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDb } from './database';
import type { Skill } from '../../shared/types';

export interface SkillArrival {
  itemUid: string;
  skill: string;
  /** The commit's author, or null when the change is not committed yet. */
  addedBy: string | null;
  /** The short sha, or null when the change is not committed yet. */
  commit: string | null;
  arrivedAt: number;
}

function rowsOf<T>(sql: string, params: Array<string | number> = []): T[] {
  const res = getDb().exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

const wanted = (s: Skill) => s.required || s.use === 'recommended';

/**
 * Who last committed `file`, and in which commit; nulls when git has no
 * commit for it or the file has uncommitted changes (a hand edit, a pull
 * not yet committed locally). Fixed arguments, the file's own folder.
 */
export function lastCommitOf(file: string): { addedBy: string | null; commit: string | null } {
  const run = (args: string[]) => execFileSync('git', ['-C', path.dirname(file), ...args], {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
  }).trim();
  try {
    const name = path.basename(file);
    if (run(['status', '--porcelain', '--', name])) return { addedBy: null, commit: null };
    const [addedBy, commit] = run(['log', '-1', '--format=%an%x1f%h', '--', name]).split('\x1f');
    return commit ? { addedBy: addedBy || null, commit } : { addedBy: null, commit: null };
  } catch {
    return { addedBy: null, commit: null };
  }
}

/**
 * After a plan-file import wrote an item: each wanted skill it did not have
 * before is an arrival, recorded once (a second import of the same file
 * finds it already waiting).
 */
export function noteArrivals(input: { itemUid: string; before: readonly Skill[]; after: readonly Skill[]; file: string; now?: number }): string[] {
  const had = new Set(input.before.filter(wanted).map((s) => s.name));
  const arrived = input.after.filter((s) => wanted(s) && !had.has(s.name)).map((s) => s.name);
  if (arrived.length === 0) return [];
  const pending = pendingArrivals(input.itemUid);
  const fresh = arrived.filter((n) => !pending.has(n));
  if (fresh.length === 0) return [];
  const { addedBy, commit } = lastCommitOf(input.file);
  const at = input.now ?? Date.now();
  try {
    for (const skill of fresh) {
      getDb().run(
        'INSERT INTO skill_arrivals (item_uid, skill, added_by, commit_sha, arrived_at) VALUES (?, ?, ?, ?, ?)',
        [input.itemUid, skill, addedBy, commit, at],
      );
    }
  } catch {
    return [];
  }
  return fresh;
}

/** The item's skills still waiting for a person, by name. */
export function pendingArrivals(itemUid: string): Map<string, SkillArrival> {
  try {
    const rows = rowsOf<{ skill: string; added_by: string | null; commit_sha: string | null; arrived_at: number }>(
      'SELECT skill, added_by, commit_sha, arrived_at FROM skill_arrivals WHERE item_uid = ? AND accepted_at IS NULL ORDER BY arrived_at',
      [itemUid],
    );
    return new Map(rows.map((r) => [r.skill, { itemUid, skill: r.skill, addedBy: r.added_by, commit: r.commit_sha, arrivedAt: Number(r.arrived_at) }]));
  } catch {
    return new Map();
  }
}

/** Every waiting skill on a plan's items that the item still has, oldest first, with the item's title. */
export function planArrivals(planUid: string): Array<SkillArrival & { itemTitle: string }> {
  try {
    const rows = rowsOf<{ item_uid: string; title: string; skills: string | null; skill: string; added_by: string | null; commit_sha: string | null; arrived_at: number }>(
      `SELECT a.item_uid, i.title, i.skills, a.skill, a.added_by, a.commit_sha, a.arrived_at
         FROM skill_arrivals a JOIN plan_items i ON i.uid = a.item_uid
        WHERE i.plan_uid = ? AND a.accepted_at IS NULL ORDER BY a.arrived_at`,
      [planUid],
    );
    return rows
      .filter((r) => {
        // A skill removed from the item since it arrived is no longer waiting on anyone.
        try { return (JSON.parse(r.skills ?? '[]') as Skill[]).some((s) => s.name === r.skill); } catch { return false; }
      })
      .map((r) => ({ itemUid: r.item_uid, itemTitle: r.title, skill: r.skill, addedBy: r.added_by, commit: r.commit_sha, arrivedAt: Number(r.arrived_at) }));
  } catch {
    return [];
  }
}

/** A person accepts a waiting skill: from now on agents are told it. False when nothing was waiting. */
export function acceptArrival(input: { itemUid: string; skill: string; by: string; byType: string; now?: number }): boolean {
  if (!pendingArrivals(input.itemUid).has(input.skill)) return false;
  getDb().run(
    'UPDATE skill_arrivals SET accepted_at = ?, accepted_by = ?, accepted_by_type = ? WHERE item_uid = ? AND skill = ? AND accepted_at IS NULL',
    [input.now ?? Date.now(), input.by, input.byType, input.itemUid, input.skill],
  );
  return true;
}
