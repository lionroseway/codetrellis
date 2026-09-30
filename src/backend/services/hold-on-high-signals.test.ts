/**
 * The opt-in "no open high signals" check (Phase 32 A5.3): a `code`
 * criterion fails while the plan's line of work has an open high overlap,
 * only when the project turns it on; and the project setting survives other
 * sensor updates (it used to be dropped by the merge).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks, type CheckContext } from './criterion-checks';
import { getEffectiveSensorConfig, updateProjectConfig, resetProjectConfigCache } from './project-config-service';

const OVERLAP = {
  heading: 'Changed signature',
  words: "billing-v2 changed createInvoice's signature in src/billing/invoice.ts. checkout-fix imports it, in 1 file: src/checkout/submit.ts.",
};

const ctx = (over: Partial<CheckContext>): CheckContext => ({
  criterion: { uid: 'c1', itemUid: 'i1', kind: 'code' },
  root: os.tmpdir(),
  itemStartedAt: 0,
  lastTargetChangeAt: null,
  evidence: [],
  itemArtefacts: [],
  code: { verdict: 'landed', missing: [] },
  ...over,
});

test('without the setting, a landed change passes whatever overlaps', () => {
  const r = runChecks(ctx({}));
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings.map((f) => f.status), ['pass']);
});

test('with the setting and an open high overlap, the check fails and names it', () => {
  const r = runChecks(ctx({ openHighSignals: [OVERLAP] }));
  assert.equal(r.ok, false);
  const failed = r.findings.find((f) => f.status === 'fail')!;
  assert.match(failed.message, /^A high overlap with other work is still open \(Changed signature\): billing-v2 changed createInvoice's signature/);
  assert.match(failed.message, /Answer it on the Awareness tab, or fix it, and check again\.$/);
});

test('with the setting and nothing open, it passes', () => {
  assert.equal(runChecks(ctx({ openHighSignals: [] })).ok, true);
});

test('only a code criterion is held: a manual one is not', () => {
  const r = runChecks(ctx({ criterion: { uid: 'c1', itemUid: 'i1', kind: 'manual' }, code: undefined, openHighSignals: [OVERLAP] }));
  assert.equal(r.findings.some((f) => f.status === 'fail'), false);
});

test('the setting is off by default, on only when set true, and kept through other sensor updates', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hold-')));
  try {
    resetProjectConfigCache();
    assert.equal(getEffectiveSensorConfig(root).awareness.holdSignOffOnHighSignals, false);
    updateProjectConfig(root, { sensors: { awareness: { holdSignOffOnHighSignals: true, branchWindowDays: 3 } } });
    assert.equal(getEffectiveSensorConfig(root).awareness.holdSignOffOnHighSignals, true);
    // Another sensor's update used to drop the awareness block.
    updateProjectConfig(root, { sensors: { drift: { debounceMs: 500 } } });
    resetProjectConfigCache();
    const after = getEffectiveSensorConfig(root).awareness;
    assert.equal(after.holdSignOffOnHighSignals, true);
    assert.equal(after.branchWindowDays, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    resetProjectConfigCache();
  }
});
