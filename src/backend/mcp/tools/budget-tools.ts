/**
 * Budget tools — Phase 23.
 *
 * See [docs/PHASE-23-BUDGETS.md](../../../../docs/PHASE-23-BUDGETS.md).
 *
 * Time and cost per plan, and a ceiling agents are asked to respect.
 *
 * The ceiling is **advisory**, deliberately — the same posture as the
 * stuck sensor. There is no mechanism here that can halt an agent, and
 * building the UI as though there were would be worse than honest
 * advice. `check_budget` mirrors `check_freeze`: a well-behaved agent
 * calls it before claiming more work, and the skill resource says so.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import {
  getBudgetReport,
  setBudget,
  checkBudget,
} from '../../services/budget-service';
import { formatCost, PRICING_VERSION } from '../../services/pricing';

/** Round for display without pretending to more precision than we have. */
function round(n: number | null, places = 1): number | null {
  if (n === null) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function summarise(planUid: string) {
  const report = getBudgetReport(planUid);
  return {
    plan_uid: planUid,
    budget: report.budget
      ? {
          minutes: report.budget.minutes,
          cost_usd: report.budget.costUsd,
          exempt: report.budget.exempt,
        }
      : null,
    spent: {
      minutes: round(report.spentMinutes),
      cost_usd: round(report.spentCostUsd, 4),
      cost_display: formatCost(report.spentCostUsd),
    },
    estimate: {
      minutes: report.estimateMinutes,
      cost_usd: report.estimateCostUsd,
    },
    forecast: {
      minutes: round(report.forecastMinutes),
      cost_usd: round(report.forecastCostUsd, 4),
      // Stated so a caller knows what the projection is based on rather
      // than treating it as a measurement.
      based_on_completion: report.completionRatio,
    },
    by_agent: report.byAgent.map((a) => ({
      agent_type: a.agentType,
      minutes: round(a.minutes),
      cost_usd: round(a.costUsd, 4),
    })),
    overruns: report.overruns.map((o) => ({
      item_uid: o.itemUid,
      estimate_minutes: o.estimateMinutes,
      spent_minutes: round(o.spentMinutes),
    })),
    // Cost figures are only as current as the price table that produced
    // them; saying which one avoids a stale number reading as fresh.
    pricing_version: PRICING_VERSION,
    note: [
      report.spentCostUsd === null
        ? 'No cost recorded: no agent on this plan reported a model we have prices for. Time is still measured.'
        : null,
      // `estimate_minutes` / `estimate_cost_usd` exist on plan_items and no
      // authoring path writes them, so estimate and overruns are structurally
      // empty on every install. Saying so is the difference between 'this plan
      // is within its estimate' and 'nobody set one' — which read identically
      // before, and only one of them is true.
      report.estimateMinutes === null && report.estimateCostUsd === null
        ? 'No estimate recorded: nothing sets per-item estimates yet, so estimate is empty and '
          + 'overruns cannot be computed. This is an absent input, not a plan that is on budget.'
        : null,
    ].filter(Boolean).join(' ') || undefined,
  };
}

export function register(server: McpServer, deps: ToolDeps): void {
  // --- get_budget ---

  server.registerTool(
    'get_budget',
    {
      description:
        'Time and cost for a plan: what has actually been spent, a forecast to completion, and a ' +
        'per-agent split. Time is measured for every agent; cost only where the agent reports a model ' +
        'we have prices for — an unknown cost is reported as null, never as zero. Estimates and ' +
        'overruns are reported only when a plan carries estimates, and nothing records them yet, so ' +
        'today they are always absent — see the note on the response.',
      inputSchema: {
        plan_uid: z.string().describe('UID of the plan.'),
      },
    },
    async ({ plan_uid }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(summarise(plan_uid), null, 2) }],
    }),
  );

  // --- set_budget ---

  server.registerTool(
    'set_budget',
    {
      description:
        'Set or clear a plan budget. Either dimension may be set independently; pass null to clear one. ' +
        'Crossing 80% raises a need-decision channel event (once), and past 100% check_budget returns ' +
        'allowed=false. The ceiling is advisory — it cannot stop an agent, it tells one to stop.',
      inputSchema: {
        plan_uid: z.string(),
        minutes: z.number().int().positive().nullable().optional()
          .describe('Wall-clock minutes across every agent. Null clears.'),
        cost_usd: z.number().positive().nullable().optional()
          .describe('USD ceiling. Null clears.'),
        exempt: z.boolean().optional()
          .describe('Exempt this plan from its ceiling without clearing it — mirrors freeze exemptions.'),
      },
    },
    async ({ plan_uid, minutes, cost_usd, exempt }) => {
      const budget = setBudget({ planUid: plan_uid, minutes, costUsd: cost_usd, exempt });
      const n = deps.broadcast('plan-budget-changed', { planUid: plan_uid, budget });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: true, broadcastTo: n, ...summarise(plan_uid) }, null, 2),
        }],
      };
    },
  );

  // --- check_budget ---

  server.registerTool(
    'check_budget',
    {
      description:
        'Whether more work should start on this plan. Call this before claiming an item, the same way ' +
        'check_freeze is called. Returns allowed=false once the plan is past its ceiling, with a reason ' +
        'to relay to the human. Advisory: nothing here can stop you, so respecting it is the point.',
      inputSchema: {
        plan_uid: z.string(),
      },
    },
    async ({ plan_uid }) => {
      const result = checkBudget(plan_uid);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(
            {
              allowed: result.allowed,
              state: result.state,
              reason: result.reason,
              ...summarise(plan_uid),
            },
            null,
            2,
          ),
        }],
      };
    },
  );
}
