import { getDb } from './database';
import { markDirty } from './persistence';
import { costOf, PRICING_VERSION, type TokenCounts } from './pricing';

/**
 * Time and cost budgets — Phase 23.
 *
 * See [docs/PHASE-23-BUDGETS.md](../../../docs/PHASE-23-BUDGETS.md).
 *
 * Three numbers per plan: what was **estimated**, what was **actually**
 * spent, and a **forecast** of where it lands. Plus one consequence — a
 * ceiling that warns, and that a well-behaved agent checks before
 * claiming more work.
 *
 * ## Why this belongs here and not in an agent
 *
 * Agents can count their own tokens. What they cannot answer is "how
 * much has *this plan* cost across three agents and two days, and which
 * item ate it". CodeTrellis sits at exactly that join — the only
 * component that sees every agent's activity attributed to one shared
 * plan. That makes it structural, not a feature.
 *
 * ## Time is measured in turns, not tool calls
 *
 * Summing `durationMs` across tool calls undercounts badly: an agent's
 * wall-clock is mostly model thinking *between* calls. So activity is
 * accumulated into a turn (first call to last, same 30s rule the
 * Timeline uses) and the turn's span is the time. That works for every
 * MCP client — Codex, Cursor, aider — not just the ones that report
 * tokens.
 *
 * ## Cost is only claimed where it is known
 *
 * Token counts come from the Claude Code session JSONL. For any other
 * agent we have none, and `costOf` returns null rather than zero. Time
 * for everyone, cost where the agent reports it.
 */

/** Same threshold as the Timeline's turn grouping, for the same reason. */
export const TURN_GAP_MS = 30_000;

/**
 * A turn left open by an agent that simply stopped is flushed after
 * this long, so its time is recorded rather than lost.
 */
export const OPEN_TURN_FLUSH_MS = 2 * 60_000;

/** Fraction of a ceiling at which we warn. */
export const WARN_AT = 0.8;

export interface OpenTurn {
  sessionId: string;
  planUid: string | null;
  itemUid: string | null;
  agentType: string | null;
  agentModel: string | null;
  startedAt: number;
  lastActivityAt: number;
  tokens: TokenCounts;
}

export interface TimeEntry {
  planUid: string;
  itemUid: string | null;
  sessionId: string | null;
  agentType: string | null;
  agentModel: string | null;
  startedAt: number;
  endedAt: number;
  tokens: TokenCounts;
  costUsd: number | null;
}

export interface PlanBudget {
  planUid: string;
  minutes: number | null;
  costUsd: number | null;
  exempt: boolean;
  notifiedAt: number | null;
}

export interface BudgetReport {
  planUid: string;
  budget: PlanBudget | null;
  /** Measured wall-clock across every recorded turn. */
  spentMinutes: number;
  /** Null when no agent in this plan ever reported a model. */
  spentCostUsd: number | null;
  /** Summed from the plan's items, where authored. */
  estimateMinutes: number | null;
  estimateCostUsd: number | null;
  /** Projection to completion. Null when there is nothing to project from. */
  forecastMinutes: number | null;
  forecastCostUsd: number | null;
  /**
   * Share of items RESOLVED — what the forecast projects against.
   *
   * Resolved, not done: `skipped` is terminal too. Counting only `done`
   * meant a plan of five done and five skipped items reported 0.5 and
   * forecast twice the time already spent on work that was finished.
   */
  completionRatio: number | null;
  /** Per-agent split, for a plan worked by more than one. */
  byAgent: Array<{ agentType: string; minutes: number; costUsd: number | null }>;
  /** Items over their estimate, worst first. */
  overruns: Array<{ itemUid: string; estimateMinutes: number; spentMinutes: number }>;
  /**
   * The price table the cost figures were actually priced under —
   * `'mixed'` when the total spans more than one.
   *
   * It used to be the CURRENT table's version unconditionally, which is
   * the one claim the field exists to prevent: a total accrued half
   * before and half after a price change was stamped with the new
   * version, asserting a provenance it did not have. See
   * `pricingVersions` for the unreduced answer.
   */
  pricingVersion: string;
  /** Every distinct price table contributing to `spentCostUsd`, sorted. */
  pricingVersions: string[];
}

// ── Pure logic ───────────────────────────────────────────────────────

/** A turn is over when nothing has happened for `gapMs`. */
export function isTurnClosed(turn: OpenTurn, now: number, gapMs: number = TURN_GAP_MS): boolean {
  return now - turn.lastActivityAt > gapMs;
}

/**
 * Project total spend from what has been spent so far and how much of
 * the plan is done.
 *
 * Returns null below a floor of completion, because dividing by a very
 * small ratio produces a number that looks precise and is noise. A
 * forecast from one finished item out of twenty is not a forecast.
 */
export function forecast(spent: number, completionRatio: number | null, floor = 0.1): number | null {
  if (spent <= 0) return null;
  if (completionRatio === null || completionRatio < floor) return null;
  if (completionRatio >= 1) return spent;
  return spent / completionRatio;
}

export type BudgetState = 'none' | 'ok' | 'warn' | 'over' | 'exempt';

/**
 * Where a plan stands against its ceiling. Both dimensions are checked
 * and the worse one wins — a plan can be inside its time budget and well
 * past its cost budget.
 */
export function budgetState(report: {
  budget: PlanBudget | null;
  spentMinutes: number;
  spentCostUsd: number | null;
}): BudgetState {
  const b = report.budget;
  if (!b || (b.minutes === null && b.costUsd === null)) return 'none';
  if (b.exempt) return 'exempt';

  const fractions: number[] = [];
  if (b.minutes !== null && b.minutes > 0) fractions.push(report.spentMinutes / b.minutes);
  // An unknown cost cannot breach a cost ceiling. Treating null as zero
  // would quietly report "well within budget" for an agent whose spend
  // we simply cannot see.
  if (b.costUsd !== null && b.costUsd > 0 && report.spentCostUsd !== null) {
    fractions.push(report.spentCostUsd / b.costUsd);
  }
  if (fractions.length === 0) return 'none';

  const worst = Math.max(...fractions);
  if (worst >= 1) return 'over';
  if (worst >= WARN_AT) return 'warn';
  return 'ok';
}

export function minutesBetween(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt) / 60_000;
}

// ── Open-turn accumulation ───────────────────────────────────────────

const openTurns = new Map<string, OpenTurn>();

/**
 * Token reports that arrived for a session with no open turn.
 *
 * This is not a rare edge. The only producer of token data is the Claude Code
 * JSONL watcher, which reports `entry.sessionId` — Claude Code's OWN session
 * UUID, the one naming `~/.claude/projects/<enc>/<uuid>.jsonl`. The only
 * producer of turns is `recordActivity`, keyed by the MCP transport's session
 * id, which the SDK mints per SSE connection with `randomUUID()`. Two
 * namespaces, minted by different processes, that can never coincide — so
 * every token report is dropped and cost reads as zero rather than unknown.
 *
 * Counted rather than correlated, deliberately. A correlation needs either the
 * agent to volunteer its own session id — which works for Claude Code and no
 * other client, against the agent-agnostic premise — or a new project↔session
 * linkage plus a rule for which turn wins when two agents share a project.
 * Both are designs, and guessing one produces a confident wrong cost, which is
 * the specific failure this module's own comments warn about ("an unknown cost
 * is reported as null, never as zero").
 *
 * So the number is surfaced instead: a caller can tell "nothing was spent"
 * from "spending was reported and we could not attribute it".
 */
let unattributedTokenReports = 0;

/** How many token reports could not be matched to a turn. */
export function getUnattributedTokenReports(): number {
  return unattributedTokenReports;
}

/** Reset in-memory state. Tests and project switches. */
export function resetBudgetState(): void {
  openTurns.clear();
  unattributedTokenReports = 0;
}

/** The turns currently open, for diagnostics and tests. */
export function listOpenTurns(): OpenTurn[] {
  return [...openTurns.values()];
}

function emptyTokens(): TokenCounts {
  return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

/**
 * Record that a session did something at `timestamp`.
 *
 * Called for every MCP tool call. Opens a turn if none is open, extends
 * it otherwise, and closes the previous one when the gap is too long.
 */
export function recordActivity(params: {
  sessionId: string;
  planUid: string | null;
  itemUid?: string | null;
  agentType?: string | null;
  agentModel?: string | null;
  timestamp?: number;
}): void {
  const now = params.timestamp ?? Date.now();
  const existing = openTurns.get(params.sessionId);

  if (existing && !isTurnClosed(existing, now)) {
    existing.lastActivityAt = now;
    if (params.planUid) existing.planUid = params.planUid;
    if (params.itemUid) existing.itemUid = params.itemUid;
    if (params.agentType) existing.agentType = params.agentType;
    if (params.agentModel) existing.agentModel = params.agentModel;
    return;
  }

  if (existing) closeTurn(params.sessionId, existing.lastActivityAt);

  openTurns.set(params.sessionId, {
    sessionId: params.sessionId,
    planUid: params.planUid ?? null,
    itemUid: params.itemUid ?? null,
    agentType: params.agentType ?? null,
    agentModel: params.agentModel ?? null,
    startedAt: now,
    lastActivityAt: now,
    tokens: emptyTokens(),
  });
}

/**
 * Attribute the session's current turn to an item.
 *
 * Called when an agent claims an item or moves one to in_progress —
 * that is the moment we learn what the time is being spent on.
 */
export function noteItemFocus(sessionId: string, itemUid: string, planUid?: string | null): void {
  const turn = openTurns.get(sessionId);
  if (!turn) return;
  turn.itemUid = itemUid;
  if (planUid) turn.planUid = planUid;
}

/**
 * Add token usage to a session's open turn.
 *
 * Usage arrives from the Claude Code JSONL watcher, asynchronously with
 * respect to MCP calls, so it lands on whichever turn is open. If none
 * is, the usage is dropped rather than opening a turn — tokens alone do
 * not tell us which plan they belong to.
 */
export function recordTokens(params: {
  sessionId: string;
  tokens: Partial<TokenCounts>;
  model?: string | null;
}): void {
  const turn = openTurns.get(params.sessionId);
  if (!turn) {
    // See `unattributedTokenReports` above: this is currently EVERY report,
    // because the two session-id namespaces cannot meet.
    unattributedTokenReports += 1;
    return;
  }
  turn.tokens.inputTokens += params.tokens.inputTokens ?? 0;
  turn.tokens.outputTokens += params.tokens.outputTokens ?? 0;
  turn.tokens.cacheWriteTokens = (turn.tokens.cacheWriteTokens ?? 0) + (params.tokens.cacheWriteTokens ?? 0);
  turn.tokens.cacheReadTokens = (turn.tokens.cacheReadTokens ?? 0) + (params.tokens.cacheReadTokens ?? 0);
  if (params.model) turn.agentModel = params.model;
}

/**
 * Close a session's turn and persist it.
 *
 * `endedAt` defaults to the turn's last activity rather than "now",
 * because a turn that ended twenty minutes ago did not take twenty extra
 * minutes. This is also what stops a laptop sleeping mid-turn from
 * producing a fourteen-hour entry.
 */
export function closeTurn(sessionId: string, endedAt?: number): TimeEntry | null {
  const turn = openTurns.get(sessionId);
  if (!turn) return null;
  openTurns.delete(sessionId);

  if (!turn.planUid) return null; // Nothing to attribute it to.

  const entry: TimeEntry = {
    planUid: turn.planUid,
    itemUid: turn.itemUid,
    sessionId: turn.sessionId,
    agentType: turn.agentType,
    agentModel: turn.agentModel,
    startedAt: turn.startedAt,
    endedAt: endedAt ?? turn.lastActivityAt,
    tokens: turn.tokens,
    costUsd: costOf(turn.agentModel, turn.tokens),
  };

  persistEntry(entry);
  return entry;
}

/**
 * Close every turn that has gone quiet. Called on a timer so an agent
 * that simply stopped still has its time recorded.
 */
export function flushIdleTurns(now: number = Date.now()): TimeEntry[] {
  const flushed: TimeEntry[] = [];
  for (const [sessionId, turn] of [...openTurns.entries()]) {
    if (now - turn.lastActivityAt > OPEN_TURN_FLUSH_MS) {
      const entry = closeTurn(sessionId, turn.lastActivityAt);
      if (entry) flushed.push(entry);
    }
  }
  return flushed;
}

// ── Persistence ──────────────────────────────────────────────────────

function persistEntry(entry: TimeEntry): void {
  try {
    const db = getDb();
    db.run(
      `INSERT INTO item_time_entries
         (plan_uid, item_uid, session_id, agent_type, agent_model, started_at, ended_at,
          input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, pricing_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.planUid,
        entry.itemUid,
        entry.sessionId,
        entry.agentType,
        entry.agentModel,
        entry.startedAt,
        entry.endedAt,
        entry.tokens.inputTokens,
        entry.tokens.outputTokens,
        entry.tokens.cacheWriteTokens ?? 0,
        entry.tokens.cacheReadTokens ?? 0,
        entry.costUsd,
        PRICING_VERSION,
      ],
    );
    markDirty();
  } catch (err) {
    console.warn('[Budget] Failed to persist a time entry:', err);
  }
}

export function getBudget(planUid: string): PlanBudget | null {
  try {
    const db = getDb();
    const res = db.exec(
      `SELECT plan_uid, minutes, cost_usd, exempt, notified_at FROM plan_budgets WHERE plan_uid = ?`,
      [planUid],
    );
    const row = res[0]?.values[0];
    if (!row) return null;
    return {
      planUid: row[0] as string,
      minutes: (row[1] as number | null) ?? null,
      costUsd: (row[2] as number | null) ?? null,
      exempt: Boolean(row[3]),
      notifiedAt: (row[4] as number | null) ?? null,
    };
  } catch {
    return null;
  }
}

export function setBudget(params: {
  planUid: string;
  minutes?: number | null;
  costUsd?: number | null;
  exempt?: boolean;
}): PlanBudget {
  const db = getDb();
  const existing = getBudget(params.planUid);
  const next: PlanBudget = {
    planUid: params.planUid,
    minutes: params.minutes !== undefined ? params.minutes : existing?.minutes ?? null,
    costUsd: params.costUsd !== undefined ? params.costUsd : existing?.costUsd ?? null,
    exempt: params.exempt !== undefined ? params.exempt : existing?.exempt ?? false,
    // Raising a ceiling clears the warning watermark, so the next 80%
    // crossing warns again rather than staying silent forever.
    notifiedAt: null,
  };

  db.run(
    `INSERT INTO plan_budgets (plan_uid, minutes, cost_usd, exempt, notified_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(plan_uid) DO UPDATE SET
       minutes = excluded.minutes,
       cost_usd = excluded.cost_usd,
       exempt = excluded.exempt,
       notified_at = excluded.notified_at,
       updated_at = excluded.updated_at`,
    [next.planUid, next.minutes, next.costUsd, next.exempt ? 1 : 0, null, Date.now()],
  );
  markDirty();
  return next;
}

/** Record that the warning fired, so it fires once per ceiling. */
export function markBudgetNotified(planUid: string, at: number = Date.now()): void {
  try {
    getDb().run(`UPDATE plan_budgets SET notified_at = ? WHERE plan_uid = ?`, [at, planUid]);
    markDirty();
  } catch {
    /* best effort */
  }
}

// ── Reporting ────────────────────────────────────────────────────────

interface Rollup {
  spentMinutes: number;
  spentCostUsd: number | null;
  byAgent: Map<string, { minutes: number; costUsd: number | null }>;
  byItem: Map<string, number>;
  /** Distinct price tables the costed rows were stamped with. */
  pricingVersions: Set<string>;
}

function rollup(planUid: string): Rollup {
  const out: Rollup = {
    spentMinutes: 0, spentCostUsd: null, byAgent: new Map(), byItem: new Map(),
    pricingVersions: new Set<string>(),
  };

  let res;
  try {
    res = getDb().exec(
      `SELECT item_uid, agent_type, started_at, ended_at, cost_usd, pricing_version
       FROM item_time_entries WHERE plan_uid = ?`,
      [planUid],
    );
  } catch {
    return out;
  }

  for (const row of res[0]?.values ?? []) {
    const itemUid = row[0] as string | null;
    const agentType = (row[1] as string | null) ?? 'unknown';
    const minutes = minutesBetween(row[2] as number, row[3] as number);
    const cost = row[4] as number | null;
    // Only a row that CONTRIBUTES to the cost total carries provenance
    // for it; a row with no cost was never priced by any table.
    const priced = row[5] as string | null;
    if (cost !== null && priced) out.pricingVersions.add(priced);

    out.spentMinutes += minutes;
    if (cost !== null) out.spentCostUsd = (out.spentCostUsd ?? 0) + cost;

    const agent = out.byAgent.get(agentType) ?? { minutes: 0, costUsd: null };
    agent.minutes += minutes;
    if (cost !== null) agent.costUsd = (agent.costUsd ?? 0) + cost;
    out.byAgent.set(agentType, agent);

    if (itemUid) out.byItem.set(itemUid, (out.byItem.get(itemUid) ?? 0) + minutes);
  }

  return out;
}

interface ItemEstimateRow {
  uid: string;
  status: string | null;
  estimateMinutes: number | null;
  estimateCostUsd: number | null;
}

function itemEstimates(planUid: string): ItemEstimateRow[] {
  try {
    const res = getDb().exec(
      `SELECT uid, status, estimate_minutes, estimate_cost_usd FROM plan_items WHERE plan_uid = ?`,
      [planUid],
    );
    return (res[0]?.values ?? []).map((r: unknown[]) => ({
      uid: r[0] as string,
      status: (r[1] as string | null) ?? null,
      estimateMinutes: (r[2] as number | null) ?? null,
      estimateCostUsd: (r[3] as number | null) ?? null,
    }));
  } catch {
    return [];
  }
}

/** Everything the UI and the MCP tools need about a plan's spend. */
export function getBudgetReport(planUid: string): BudgetReport {
  const spent = rollup(planUid);
  const items = itemEstimates(planUid);

  const estimateMinutes = items.reduce<number | null>(
    (acc, i) => (i.estimateMinutes === null ? acc : (acc ?? 0) + i.estimateMinutes),
    null,
  );
  const estimateCostUsd = items.reduce<number | null>(
    (acc, i) => (i.estimateCostUsd === null ? acc : (acc ?? 0) + i.estimateCostUsd),
    null,
  );

  // `skipped` is terminal: a skipped item will never become done, so
  // leaving it in the unfinished column means the forecast never
  // converges. A plan of five done and five skipped is FINISHED, and
  // used to report a ratio of 0.5 — forecasting twice the time already
  // spent, on a plan with no work left in it.
  const actionable = items.filter((i) => i.status !== null);
  const resolved = actionable.filter((i) => i.status === 'done' || i.status === 'skipped').length;
  const completionRatio = actionable.length > 0 ? resolved / actionable.length : null;

  const pricingVersions = [...spent.pricingVersions].sort();

  const overruns = items
    .filter((i) => i.estimateMinutes !== null && (spent.byItem.get(i.uid) ?? 0) > i.estimateMinutes)
    .map((i) => ({
      itemUid: i.uid,
      estimateMinutes: i.estimateMinutes!,
      spentMinutes: spent.byItem.get(i.uid) ?? 0,
    }))
    .sort((a, b) => b.spentMinutes - b.estimateMinutes - (a.spentMinutes - a.estimateMinutes));

  return {
    planUid,
    budget: getBudget(planUid),
    spentMinutes: spent.spentMinutes,
    spentCostUsd: spent.spentCostUsd,
    estimateMinutes,
    estimateCostUsd,
    forecastMinutes: forecast(spent.spentMinutes, completionRatio),
    forecastCostUsd:
      spent.spentCostUsd === null ? null : forecast(spent.spentCostUsd, completionRatio),
    completionRatio,
    byAgent: [...spent.byAgent.entries()].map(([agentType, v]) => ({ agentType, ...v })),
    overruns,
    // The version the TOTAL was priced under, not the one in force now.
    // With nothing priced yet, the current table is the honest answer:
    // it is what the next row will use.
    pricingVersion:
      pricingVersions.length === 0 ? PRICING_VERSION
        : pricingVersions.length === 1 ? pricingVersions[0]
          : 'mixed',
    pricingVersions,
  };
}

/**
 * Whether more work should start on this plan.
 *
 * **Advisory.** We have no mechanism to halt an agent, and pretending we
 * do would be worse than honest advice — the same posture as the stuck
 * sensor. A well-behaved agent calls this before claiming an item; the
 * MCP skill resource tells it to.
 */
export function checkBudget(planUid: string): {
  allowed: boolean;
  state: BudgetState;
  reason: string;
  report: BudgetReport;
} {
  const report = getBudgetReport(planUid);
  const state = budgetState(report);

  switch (state) {
    case 'over':
      return {
        allowed: false,
        state,
        reason:
          'This plan is past its budget. Stop and ask the human to raise the ceiling or exempt the plan.',
        report,
      };
    case 'warn':
      return {
        allowed: true,
        state,
        reason: 'This plan is past 80% of its budget. Finish what is in flight; do not start more.',
        report,
      };
    case 'exempt':
      return { allowed: true, state, reason: 'This plan is exempt from its budget.', report };
    case 'ok':
      return { allowed: true, state, reason: 'Within budget.', report };
    default:
      return { allowed: true, state, reason: 'No budget set for this plan.', report };
  }
}

// ── Sweep ────────────────────────────────────────────────────────────

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Plans that have a ceiling. Only these are worth checking on a sweep.
 */
function plansWithBudgets(): string[] {
  try {
    const res = getDb().exec(
      `SELECT plan_uid FROM plan_budgets WHERE (minutes IS NOT NULL OR cost_usd IS NOT NULL) AND exempt = 0`,
    );
    return (res[0]?.values ?? []).map((r: unknown[]) => r[0] as string);
  } catch {
    return [];
  }
}

/**
 * One sweep: flush turns that have gone quiet, then warn on any plan
 * that has crossed the warning threshold.
 *
 * Flushing matters because an agent that simply stops leaves its turn
 * open, and unflushed time is time we never recorded — every plan would
 * look cheaper than it was.
 *
 * The warning fires **once** per ceiling, tracked by `notified_at`.
 * Raising the ceiling clears it, so the next crossing warns again. A
 * warning that repeated on every sweep would be noise, and noise trains
 * people to dismiss the thing that matters.
 */
export async function runBudgetSweep(now: number = Date.now()): Promise<void> {
  flushIdleTurns(now);

  for (const planUid of plansWithBudgets()) {
    try {
      const report = getBudgetReport(planUid);
      const state = budgetState(report);
      if (state !== 'warn' && state !== 'over') continue;
      if (report.budget?.notifiedAt) continue;

      const spentCost = report.spentCostUsd;
      const parts: string[] = [];
      if (report.budget?.minutes) {
        parts.push(`${report.spentMinutes.toFixed(0)}m of ${report.budget.minutes}m`);
      }
      if (report.budget?.costUsd && spentCost !== null) {
        parts.push(`$${spentCost.toFixed(2)} of $${report.budget.costUsd.toFixed(2)}`);
      }

      const { postChannelEvent } = await import('./channel-event-service');
      const { dispatchChannelEvent } = await import('./channel-dispatcher-service');

      const event = postChannelEvent({
        planUid,
        eventType: 'need-decision',
        payload: {
          message:
            state === 'over'
              ? `This plan is over budget (${parts.join(', ')}). Raise the ceiling, exempt the plan, or stop.`
              : `This plan has passed 80% of its budget (${parts.join(', ')}).`,
        },
        author: 'codetrellis',
        authorType: 'system',
      });

      markBudgetNotified(planUid, now);
      await dispatchChannelEvent(event);
    } catch (err) {
      console.warn(`[Budget] Sweep failed for plan ${planUid}:`, err);
    }
  }
}

export function startBudgetSweep(intervalMs = 60_000): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void runBudgetSweep();
  }, intervalMs);
  // Never hold the process open for accounting.
  sweepTimer.unref?.();
}

export function stopBudgetSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
