/**
 * Power-service truth-table tests — Plan 9.3.
 *
 * Run with: `npm run test:unit`
 *
 * No vitest / jest — uses built-in `node:test` + `node:assert/strict`
 * via tsx. Tests `evaluatePower(inputs)` directly to keep them pure
 * (no filesystem, no globals, no debounce sleep).
 *
 * The integration path that wires `evaluate()` → debounce → emit lives
 * in the runtime; this file proves the *decision* is right, not the
 * scheduling around it.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { evaluatePower } from './power-service';
import type { PowerSettings } from '../../shared/types';
import type { AcState, PowerPlatform } from '../../shared/types/power';

// --- helpers ------------------------------------------------------------

function settingsOf(opts: {
  whileMobileConnected?: boolean;
  whileAgentActive?: boolean;
  always?: boolean;
  preventLidCloseSleep?: boolean;
  onlyWhenOnAC?: boolean;
}): PowerSettings {
  return {
    triggers: {
      whileMobileConnected: !!opts.whileMobileConnected,
      whileAgentActive: !!opts.whileAgentActive,
      always: !!opts.always,
    },
    preventLidCloseSleep: !!opts.preventLidCloseSleep,
    onlyWhenOnAC: !!opts.onlyWhenOnAC,
  };
}

// --- truth table --------------------------------------------------------

test('evaluatePower — full truth table over toggles + signals + ac', () => {
  // Generate every combination of:
  //   - 3 trigger toggles
  //   - mobileConnected / agentActive booleans
  //   - onlyWhenOnAC
  //   - ac in {plugged, battery, unknown}
  // Assert shouldBlock + reason against the documented precedence:
  //   always > mobile-connected > agent-active
  // and the AC-gate rule:
  //   shouldBlock && onlyWhenOnAC && ac === 'battery' → suppress

  const acStates: AcState[] = ['plugged', 'battery', 'unknown'];
  const platform: PowerPlatform = 'darwin';

  let casesChecked = 0;

  for (const wmc of [false, true]) {
    for (const wac of [false, true]) {
      for (const always of [false, true]) {
        for (const mc of [false, true]) {
          for (const ag of [false, true]) {
            for (const onAc of [false, true]) {
              for (const ac of acStates) {
                const settings = settingsOf({
                  whileMobileConnected: wmc,
                  whileAgentActive: wac,
                  always,
                  onlyWhenOnAC: onAc,
                });
                const status = evaluatePower({
                  settings,
                  mobileConnected: mc,
                  agentActive: ag,
                  ac,
                  platform,
                });

                // Expected reason — precedence-aware
                let expectedReason: typeof status.reason = null;
                if (always) expectedReason = 'always';
                else if (wmc && mc) expectedReason = 'mobile-connected';
                else if (wac && ag) expectedReason = 'agent-active';

                let expectedShouldBlock = expectedReason !== null;
                // AC gate
                if (expectedShouldBlock && onAc && ac === 'battery') {
                  expectedShouldBlock = false;
                  expectedReason = null;
                }

                const caseTag =
                  `wmc=${wmc} wac=${wac} always=${always} ` +
                  `mc=${mc} ag=${ag} onAc=${onAc} ac=${ac}`;

                assert.equal(status.shouldBlock, expectedShouldBlock, `shouldBlock — ${caseTag}`);
                assert.equal(status.reason, expectedReason, `reason — ${caseTag}`);
                assert.equal(status.ac, ac, `ac echoed — ${caseTag}`);
                assert.equal(status.platform, platform, `platform echoed — ${caseTag}`);

                casesChecked++;
              }
            }
          }
        }
      }
    }
  }

  // 6 binary dims (wmc, wac, always, mc, ag, onAc) × 3 AC states = 192
  assert.equal(casesChecked, 192, 'expected 192 truth-table cases');
});

// --- explicit named scenarios -------------------------------------------
//
// Truth table above is comprehensive; these spot-checks are the cases a
// reader would actually try to verify by hand from the docstring.

test('idle: no triggers + no signals = no block', () => {
  const status = evaluatePower({
    settings: settingsOf({}),
    mobileConnected: false,
    agentActive: false,
    ac: 'plugged',
    platform: 'darwin',
  });
  assert.equal(status.shouldBlock, false);
  assert.equal(status.reason, null);
});

test('AC gate suppresses on battery', () => {
  const settings = settingsOf({ always: true, onlyWhenOnAC: true });
  const onBattery = evaluatePower({
    settings,
    mobileConnected: false,
    agentActive: false,
    ac: 'battery',
    platform: 'darwin',
  });
  assert.equal(onBattery.shouldBlock, false, 'battery should suppress');
  assert.equal(onBattery.reason, null);

  const plugged = evaluatePower({
    settings,
    mobileConnected: false,
    agentActive: false,
    ac: 'plugged',
    platform: 'darwin',
  });
  assert.equal(plugged.shouldBlock, true, 'plugged should engage');
  assert.equal(plugged.reason, 'always');
});

test('AC gate treats "unknown" as plugged (web mode / no battery)', () => {
  const settings = settingsOf({ always: true, onlyWhenOnAC: true });
  const status = evaluatePower({
    settings,
    mobileConnected: false,
    agentActive: false,
    ac: 'unknown',
    platform: 'web',
  });
  assert.equal(status.shouldBlock, true, 'unknown must NOT trigger gate');
  assert.equal(status.reason, 'always');
});

test('reason precedence: always > mobile-connected > agent-active', () => {
  // All three triggers on + all signals fresh: expect "always"
  const settings = settingsOf({
    always: true,
    whileMobileConnected: true,
    whileAgentActive: true,
  });
  const status = evaluatePower({
    settings,
    mobileConnected: true,
    agentActive: true,
    ac: 'plugged',
    platform: 'darwin',
  });
  assert.equal(status.reason, 'always', 'always wins when set');

  // No always, both signal-triggers on + both signals fresh: expect "mobile-connected"
  const settings2 = settingsOf({
    whileMobileConnected: true,
    whileAgentActive: true,
  });
  const status2 = evaluatePower({
    settings: settings2,
    mobileConnected: true,
    agentActive: true,
    ac: 'plugged',
    platform: 'darwin',
  });
  assert.equal(status2.reason, 'mobile-connected', 'mobile wins over agent');
});

test('trigger toggled OFF means signal is ignored even when present', () => {
  // whileMobileConnected=false, but mobile IS connected → no block
  const status = evaluatePower({
    settings: settingsOf({ whileAgentActive: true }),
    mobileConnected: true,
    agentActive: false,
    ac: 'plugged',
    platform: 'darwin',
  });
  assert.equal(status.shouldBlock, false);
  assert.equal(status.reason, null);
});
