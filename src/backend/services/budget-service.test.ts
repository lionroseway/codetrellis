/**
 * Unit tests for the budget service's pure logic and turn accumulation
 * (Phase 23).
 *
 * Persistence is exercised by the harness; what matters here is the
 * arithmetic and the restraint — particularly that an unknown cost stays
 * unknown rather than becoming a confident zero.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTurnClosed,
  forecast,
  budgetState,
  minutesBetween,
  recordActivity,
  recordTokens,
  noteItemFocus,
  listOpenTurns,
  resetBudgetState,
  TURN_GAP_MS,
  type OpenTurn,
  type PlanBudget,
} from './budget-service';
import { costOf, formatCost, priceFor } from './pricing';

const budget = (over: Partial<PlanBudget> = {}): PlanBudget => ({
  planUid: 'pln_1',
  minutes: null,
  costUsd: null,
  exempt: false,
  notifiedAt: null,
  ...over,
});

describe('pricing', () => {
  test('a known model prices input, output and cache separately', () => {
    const cost = costOf('claude-sonnet-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    // 3 + 15 + 0.3
    assert.ok(cost !== null);
    assert.ok(Math.abs(cost! - 18.3) < 1e-9, `got ${cost}`);
  });

  test('cache reads are not priced as input — for a long session they dominate', () => {
    const asInput = costOf('claude-sonnet-5', { inputTokens: 10_000_000, outputTokens: 0 });
    const asCache = costOf('claude-sonnet-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 10_000_000 });
    assert.ok(asCache! < asInput! / 5, 'cache reads must be much cheaper');
  });

  test('an unknown model yields null, never zero', () => {
    // Zero reads as "this was free". Null reads as "we do not know",
    // which is the truth for an agent that does not report its model.
    assert.equal(costOf('some-other-llm', { inputTokens: 1000, outputTokens: 1000 }), null);
    assert.equal(costOf(null, { inputTokens: 1000, outputTokens: 1000 }), null);
    assert.equal(formatCost(null), '—');
  });

  test('a more specific model row wins over a general one', () => {
    assert.equal(priceFor('claude-opus-5-20260101')?.match, 'claude-opus-5');
  });
});

describe('forecast', () => {
  test('projects from spend and completion', () => {
    assert.equal(forecast(60, 0.5), 120);
  });

  test('a complete plan forecasts what it actually spent', () => {
    assert.equal(forecast(60, 1), 60);
  });

  test('refuses to project from almost nothing', () => {
    // One finished item out of twenty is not a forecast; dividing by it
    // produces a number that looks precise and is noise.
    assert.equal(forecast(60, 0.05), null);
    assert.equal(forecast(60, null), null);
    assert.equal(forecast(0, 0.5), null);
  });
});

describe('budget state', () => {
  test('no ceiling means no state to report', () => {
    assert.equal(budgetState({ budget: null, spentMinutes: 999, spentCostUsd: 999 }), 'none');
    assert.equal(budgetState({ budget: budget(), spentMinutes: 999, spentCostUsd: 999 }), 'none');
  });

  test('warns at 80% and flags over at 100%', () => {
    assert.equal(budgetState({ budget: budget({ minutes: 100 }), spentMinutes: 79, spentCostUsd: null }), 'ok');
    assert.equal(budgetState({ budget: budget({ minutes: 100 }), spentMinutes: 80, spentCostUsd: null }), 'warn');
    assert.equal(budgetState({ budget: budget({ minutes: 100 }), spentMinutes: 101, spentCostUsd: null }), 'over');
  });

  test('the worse of the two dimensions wins', () => {
    // Inside the time budget, well past the cost one.
    const state = budgetState({
      budget: budget({ minutes: 100, costUsd: 10 }),
      spentMinutes: 10,
      spentCostUsd: 12,
    });
    assert.equal(state, 'over');
  });

  test('an unknown cost cannot breach a cost ceiling', () => {
    // Treating null as zero would report "well within budget" for an
    // agent whose spend we cannot see at all.
    assert.equal(
      budgetState({ budget: budget({ costUsd: 10 }), spentMinutes: 0, spentCostUsd: null }),
      'none',
    );
  });

  test('an exempt plan reports exempt regardless of spend', () => {
    assert.equal(
      budgetState({ budget: budget({ minutes: 1, exempt: true }), spentMinutes: 999, spentCostUsd: null }),
      'exempt',
    );
  });
});

describe('turn accumulation', () => {
  beforeEach(() => resetBudgetState());

  const openTurn = (over: Partial<OpenTurn> = {}): OpenTurn => ({
    sessionId: 's1',
    planUid: 'pln_1',
    itemUid: null,
    agentType: null,
    agentModel: null,
    startedAt: 0,
    lastActivityAt: 0,
    tokens: { inputTokens: 0, outputTokens: 0 },
    ...over,
  });

  test('a turn closes only after the gap', () => {
    const turn = openTurn({ lastActivityAt: 1000 });
    assert.equal(isTurnClosed(turn, 1000 + TURN_GAP_MS), false);
    assert.equal(isTurnClosed(turn, 1000 + TURN_GAP_MS + 1), true);
  });

  test('activity within the gap extends one turn', () => {
    recordActivity({ sessionId: 's1', planUid: 'pln_1', timestamp: 1000 });
    recordActivity({ sessionId: 's1', planUid: 'pln_1', timestamp: 5000 });
    const open = listOpenTurns();
    assert.equal(open.length, 1);
    assert.equal(open[0].startedAt, 1000);
    assert.equal(open[0].lastActivityAt, 5000);
  });

  test('concurrent sessions accumulate separately', () => {
    recordActivity({ sessionId: 'a', planUid: 'pln_1', timestamp: 1000 });
    recordActivity({ sessionId: 'b', planUid: 'pln_1', timestamp: 1100 });
    assert.equal(listOpenTurns().length, 2);
  });

  test('claiming an item attributes the open turn to it', () => {
    recordActivity({ sessionId: 's1', planUid: 'pln_1', timestamp: 1000 });
    noteItemFocus('s1', 'itm_9');
    assert.equal(listOpenTurns()[0].itemUid, 'itm_9');
  });

  test('tokens accumulate onto the open turn', () => {
    recordActivity({ sessionId: 's1', planUid: 'pln_1', timestamp: 1000 });
    recordTokens({ sessionId: 's1', tokens: { inputTokens: 100, outputTokens: 20 }, model: 'claude-sonnet-5' });
    recordTokens({ sessionId: 's1', tokens: { inputTokens: 50, cacheReadTokens: 900 } });
    const turn = listOpenTurns()[0];
    assert.equal(turn.tokens.inputTokens, 150);
    assert.equal(turn.tokens.outputTokens, 20);
    assert.equal(turn.tokens.cacheReadTokens, 900);
    assert.equal(turn.agentModel, 'claude-sonnet-5');
  });

  test('tokens with no open turn are dropped, not guessed at', () => {
    // Usage alone does not say which plan it belongs to.
    recordTokens({ sessionId: 'ghost', tokens: { inputTokens: 1000, outputTokens: 1000 } });
    assert.equal(listOpenTurns().length, 0);
  });
});

describe('durations', () => {
  test('minutes are wall-clock between the ends', () => {
    assert.equal(minutesBetween(0, 90_000), 1.5);
  });

  test('a negative span is clamped rather than propagating', () => {
    assert.equal(minutesBetween(5000, 1000), 0);
  });
});
