/**
 * Check runs (Phase 33 C7, AGENT-CHECKS-AND-REVIEW §3.2): every check, from
 * the CLI, CI, the app or an agent's MCP call, is a run, kept here with where
 * it ran, by whom, the scope, the rulebook's commit, the outcome and its
 * findings. This device's runs, and the latest of each teammate's device read
 * from the plans folder (`task-records/check-runs.ts`).
 *
 * A run is written to the plans folder by the listener `shared-state.ts`
 * sets, only where task state is shared.
 */

import crypto from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import type { CheckRunRecord, CheckRunFinding, CheckRunOutcome } from './task-records/check-run-record';
import { outcomeWords } from './task-records/check-run-record';
import { parseAgentReview, reviewWords, type AgentReview } from '../../shared/lib/agent-review';

/** A run as this device made it, before it has a writer or counter. */
export type NewCheckRun = Omit<CheckRunRecord, 'writer' | 'name' | 'counter'> & { projectRoot: string };

export interface CheckRun {
  id: string;
  /** Made on this device, or read from a teammate's. */
  mine: boolean;
  writer: string;
  counter: number;
  /** Who ran it, as people say it: "Sam Lee", or "ci for Build bot". */
  who: string;
  verified: boolean;
  why: string | null;
  ranIn: string;
  commit: string | null;
  dirty: string[];
  base: string | null;
  rulebook: string | null;
  scope: string | null;
  strict: boolean;
  outcome: CheckRunOutcome;
  says: string[];
  findings: CheckRunFinding[];
  /** C4b: an agent's review, when the run is one. */
  review: AgentReview | null;
  at: number;
  /** One line: "ci for Build bot in GitHub Actions at a1b2c3d: ✗ 2 block". */
  words: string;
}

/** How many of this device's own runs are kept per project. */
const KEEP_MINE = 200;

const parse = <T>(s: unknown, fallback: T): T => {
  if (s === null || s === undefined) return fallback;
  try { return (JSON.parse(String(s)) as T | null) ?? fallback; } catch { return fallback; }
};

let listener: ((run: NewCheckRun) => void) | null = null;
/** Called with every run this device makes: `shared-state.ts` writes it to the plans folder when sharing. */
export function setCheckRunListener(fn: ((run: NewCheckRun) => void) | null): void { listener = fn; }

/** Keep a run this device made, and hand it to the listener. Returns its id. */
export function recordCheckRun(run: NewCheckRun, me = { writer: 'this-device', name: 'you' }): string {
  const id = `local-${crypto.randomUUID()}`;
  insert(run.projectRoot, id, true, { ...run, writer: me.writer, name: me.name, counter: 0 }, null);
  // Only this device's newest are kept; a teammate's are kept one per device.
  getDb().run(
    `DELETE FROM rule_check_runs WHERE project_root = ? AND mine = 1 AND id NOT IN (
       SELECT id FROM rule_check_runs WHERE project_root = ? AND mine = 1 ORDER BY at DESC LIMIT ?)`,
    [run.projectRoot, run.projectRoot, KEEP_MINE],
  );
  markDirty();
  try { listener?.(run); } catch (err) { console.warn('[check-runs] could not share a run:', err); }
  return id;
}

function insert(projectRoot: string, id: string, mine: boolean, r: CheckRunRecord, verdict: Record<string, unknown> | null): void {
  getDb().run(
    `INSERT OR REPLACE INTO rule_check_runs (project_root, id, mine, writer, counter, name, by_author, by_type, ran_in, commit_sha, dirty, base, rulebook, scope, strict, outcome, says, findings, at, verdict, review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectRoot, id, mine ? 1 : 0, r.writer, r.counter, r.name, r.by.author, r.by.authorType, r.ranIn, r.commit, JSON.stringify(r.dirty),
      r.base, r.rulebook, r.scope, r.strict ? 1 : 0, JSON.stringify(r.outcome), JSON.stringify(r.says), JSON.stringify(r.findings), r.at,
      verdict ? JSON.stringify(verdict) : null, r.review ? JSON.stringify(r.review) : null],
  );
}

/** A teammate's run, read from its record: one per device, a newer one replaces it. */
export function putTeammateCheckRun(projectRoot: string, r: CheckRunRecord, verdict: Record<string, unknown>): void {
  getDb().run('DELETE FROM rule_check_runs WHERE project_root = ? AND mine = 0 AND writer = ? AND counter < ?', [projectRoot, r.writer, r.counter]);
  insert(projectRoot, `${r.writer}-${r.counter}`, false, r, verdict);
  markDirty();
}

/** The newest counter read here from each teammate device, to skip what is already known. */
export function knownCheckRunCounters(projectRoot: string): Map<string, number> {
  const rows = getDb().exec('SELECT writer, MAX(counter) FROM rule_check_runs WHERE project_root = ? AND mine = 0 GROUP BY writer', [projectRoot])[0]?.values ?? [];
  return new Map(rows.map((r) => [String(r[0]), Number(r[1])]));
}

/** Forget teammates' runs in a project (sharing was turned off), or one device's everywhere. */
export function forgetTeammateCheckRuns(q: { projectRoot?: string; writer?: string }): number {
  const where = q.projectRoot ? 'project_root = ? AND mine = 0' : 'writer = ? AND mine = 0';
  const arg = q.projectRoot ?? q.writer ?? '';
  const n = Number(getDb().exec(`SELECT COUNT(*) FROM rule_check_runs WHERE ${where}`, [arg])[0]?.values[0]?.[0] ?? 0);
  if (n) { getDb().run(`DELETE FROM rule_check_runs WHERE ${where}`, [arg]); markDirty(); }
  return n;
}

const COLS = 'id, mine, writer, counter, name, by_author, by_type, ran_in, commit_sha, dirty, base, rulebook, scope, strict, outcome, says, findings, at, verdict, review';

function rowToRun(r: unknown[]): CheckRun {
  const mine = Number(r[1]) === 1;
  const verdict = parse<{ verified?: boolean; who?: string; why?: string }>(r[18], {});
  const name = verdict.verified && verdict.who ? verdict.who : String(r[4]);
  const person = r[6] === 'human' || r[6] === 'unverified' || r[5] === r[4];
  const who = mine ? (person ? 'you' : `${String(r[5])}`) : person ? name : `${String(r[5])} for ${name}`;
  const run: Omit<CheckRun, 'words'> = {
    id: String(r[0]), mine, writer: String(r[2]), counter: Number(r[3]), who,
    verified: mine || verdict.verified === true, why: mine || verdict.verified ? null : verdict.why ?? null,
    ranIn: String(r[7]), commit: (r[8] as string | null) ?? null, dirty: parse<string[]>(r[9], []),
    base: (r[10] as string | null) ?? null, rulebook: (r[11] as string | null) ?? null, scope: (r[12] as string | null) ?? null,
    strict: Number(r[13]) === 1, outcome: parse(r[14], { ok: false, files: 0, blocks: 0, warns: 0 }),
    says: parse<string[]>(r[15], []), findings: parse<CheckRunFinding[]>(r[16], []), at: Number(r[17]),
    review: parseAgentReview(parse<unknown>(r[19], null)),
  };
  return { ...run, words: runWords(run) };
}

/** "ci for Build bot in GitHub Actions at a1b2c3d, against main: ✗ 2 block (unverified: it is not signed)" */
export function runWords(r: Omit<CheckRun, 'words'>): string {
  const at = r.commit ? ` at ${r.commit.slice(0, 7)}` : '';
  const against = r.base ? `, against ${r.base}` : '';
  const scope = r.scope ? `, ${r.scope}` : '';
  // C4b: an agent's review says what it found, in its own words.
  // B5: a review fails a check only on a block-strength agent rule, and then says so first.
  const failed = r.review && r.outcome.blocks > 0 ? `✗ ${r.outcome.blocks} block · ` : '';
  const said = r.review ? `${r.review.agent}'s review${r.review.pass ? ` (${r.review.pass})` : ''}: ${failed}${reviewWords(r.review)}` : outcomeWords(r.outcome);
  return `${r.who} in ${r.ranIn}${at}${against}${scope}: ${said}${r.verified ? '' : ` (unverified: ${r.why ?? 'not signed'})`}`;
}

/** The runs in a project, newest first: this device's and teammates'. */
export function listCheckRuns(projectRoot: string, limit = 50): CheckRun[] {
  const rows = getDb().exec(`SELECT ${COLS} FROM rule_check_runs WHERE project_root = ? ORDER BY at DESC LIMIT ?`, [projectRoot, Math.max(1, Math.min(limit, 500))])[0]?.values ?? [];
  return rows.map(rowToRun);
}

export function getCheckRun(projectRoot: string, id: string): CheckRun | null {
  const r = getDb().exec(`SELECT ${COLS} FROM rule_check_runs WHERE project_root = ? AND id = ?`, [projectRoot, id])[0]?.values[0];
  return r ? rowToRun(r) : null;
}
