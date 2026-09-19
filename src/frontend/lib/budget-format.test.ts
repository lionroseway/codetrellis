/**
 * Unit tests for budget formatting and state (Phase 29).
 *
 * Each case below is a place where the obvious implementation says
 * something false about money or time, on a surface whose whole job is
 * to be trusted about both.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stateOf, formatMinutes, formatCost, WARN_AT } from './budget-format';
import { budgetState, type PlanBudget } from '../../backend/services/budget-service';

const budget = (over: Partial<PlanBudget> = {}): PlanBudget => ({
  planUid: 'p', minutes: null, costUsd: null, exempt: false, notifiedAt: null, ...over,
});

describe('formatCost', () => {
  test('an unknown cost is "not reported", never $0.00', () => {
    // `spentCostUsd` is null when no agent on the plan reported a model,
    // so nothing could be priced. Rendering zero would report a plan as
    // free when the truth is its cost is invisible to us.
    assert.equal(formatCost(null), 'not reported');
    assert.notEqual(formatCost(null), '$0.00');
  });

  test('a real zero is still money', () => {
    assert.equal(formatCost(0), '<$0.01');
  });

  test('two decimal places', () => {
    assert.equal(formatCost(1.5), '$1.50');
    assert.equal(formatCost(12.345), '$12.35');
  });
});

describe('formatMinutes', () => {
  test('sub-minute reads as under a minute, not as zero', () => {
    assert.equal(formatMinutes(0.4), '<1m');
  });

  test('hours and minutes', () => {
    assert.equal(formatMinutes(45), '45m');
    assert.equal(formatMinutes(60), '1h');
    assert.equal(formatMinutes(95), '1h 35m');
  });
});

describe('stateOf', () => {
  test('no ceiling is "none", not "ok"', () => {
    // "ok" would claim the plan is inside a budget it does not have.
    assert.equal(stateOf({ budget: null, spentMinutes: 100, spentCostUsd: 5 }), 'none');
    assert.equal(stateOf({ budget: budget(), spentMinutes: 100, spentCostUsd: 5 }), 'none');
  });

  test('exempt wins over everything', () => {
    assert.equal(
      stateOf({ budget: budget({ minutes: 10, exempt: true }), spentMinutes: 1000, spentCostUsd: null }),
      'exempt',
    );
  });

  test('an unknown cost cannot breach a cost ceiling', () => {
    // The dangerous case: reporting "ok" for spend we cannot see. With
    // only a cost ceiling and no priced spend there is nothing to
    // compare, so the honest answer is "none".
    assert.equal(
      stateOf({ budget: budget({ costUsd: 10 }), spentMinutes: 500, spentCostUsd: null }),
      'none',
    );
  });

  test('the worse of the two dimensions wins', () => {
    // Comfortably inside the time budget, far past the cost budget.
    assert.equal(
      stateOf({ budget: budget({ minutes: 1000, costUsd: 10 }), spentMinutes: 10, spentCostUsd: 50 }),
      'over',
    );
  });

  test('the warn boundary is inclusive at 80%', () => {
    assert.equal(stateOf({ budget: budget({ minutes: 100 }), spentMinutes: 79, spentCostUsd: null }), 'ok');
    assert.equal(stateOf({ budget: budget({ minutes: 100 }), spentMinutes: 80, spentCostUsd: null }), 'warn');
    assert.equal(stateOf({ budget: budget({ minutes: 100 }), spentMinutes: 100, spentCostUsd: null }), 'over');
  });
});

describe('the chip agrees with the service', () => {
  test('stateOf matches budgetState across the interesting cases', () => {
    // The chip renders from a report it already has rather than making a
    // second call for a string, so the two implementations must not
    // drift. This is what keeps them honest.
    const cases: Array<{ budget: PlanBudget | null; spentMinutes: number; spentCostUsd: number | null }> = [
      { budget: null, spentMinutes: 10, spentCostUsd: 1 },
      { budget: budget(), spentMinutes: 10, spentCostUsd: 1 },
      { budget: budget({ minutes: 100 }), spentMinutes: 50, spentCostUsd: null },
      { budget: budget({ minutes: 100 }), spentMinutes: 80, spentCostUsd: null },
      { budget: budget({ minutes: 100 }), spentMinutes: 120, spentCostUsd: null },
      { budget: budget({ costUsd: 10 }), spentMinutes: 5, spentCostUsd: null },
      { budget: budget({ costUsd: 10 }), spentMinutes: 5, spentCostUsd: 9 },
      { budget: budget({ minutes: 1000, costUsd: 10 }), spentMinutes: 10, spentCostUsd: 50 },
      { budget: budget({ minutes: 10, exempt: true }), spentMinutes: 1000, spentCostUsd: null },
    ];
    for (const c of cases) {
      assert.equal(
        stateOf(c),
        budgetState(c),
        `drifted for ${JSON.stringify(c)}`,
      );
    }
  });

  test('the warn threshold is the same number on both sides', () => {
    // A mismatch here would colour the chip amber at a different point
    // from where the service fires its one-time warning.
    assert.equal(
      stateOf({ budget: budget({ minutes: 100 }), spentMinutes: WARN_AT * 100, spentCostUsd: null }),
      'warn',
    );
    assert.equal(
      budgetState({ budget: budget({ minutes: 100 }), spentMinutes: WARN_AT * 100, spentCostUsd: null }),
      'warn',
    );
  });
});
