import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFreezeChange, formatUntil } from './freeze-words';

const off = { active: false, reason: null, until: null, allowedPlanUids: [] };
const on = { active: true, reason: 'Release 2.0', until: '2026-10-03T17:00:00.000Z', allowedPlanUids: [] };

test('freezing, with the reason and the end', () => {
  assert.equal(describeFreezeChange(null, on), 'froze the project ("Release 2.0") until 2026-10-03 17:00 UTC');
  assert.equal(describeFreezeChange(off, { ...on, reason: null, until: null }), 'froze the project with no end');
});

test('lifting, which also clears the exemptions — not worth saying', () => {
  assert.equal(describeFreezeChange({ ...on, allowedPlanUids: ['p1'] }, { ...off }), 'lifted the freeze');
});

test('exempting a plan, which is how an agent lets itself through', () => {
  assert.equal(describeFreezeChange(on, { ...on, allowedPlanUids: ['p1'] }), 'exempted 1 plan');
  assert.equal(describeFreezeChange({ ...on, allowedPlanUids: ['p1', 'p2'] }, { ...on, allowedPlanUids: [] }), 'removed the exemption for 2 plans');
});

test('changing a live freeze', () => {
  assert.equal(
    describeFreezeChange(on, { ...on, reason: 'Incident', until: null }),
    'changed the reason to "Incident", removed the end date',
  );
});

test('an unparseable date is shown as given', () => {
  assert.equal(formatUntil('soon'), 'soon');
});
