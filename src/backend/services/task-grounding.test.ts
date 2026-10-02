import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeCriterion } from './task-grounding';

const pass = { ok: true, findings: [{ status: 'pass', message: 'fine' }] };
const fail = { ok: false, findings: [{ status: 'pass', message: 'fine' }, { status: 'fail', message: 'out/summary.docx was written before this item started' }] };

test('each criterion is graded once: changed and sent back first, then what its checks say', () => {
  assert.equal(gradeCriterion({ kind: 'artefact', policy: 'agent', state: 'stale', submitted: true }, pass).grade, 'changed');
  assert.equal(gradeCriterion({ kind: 'artefact', policy: 'agent', state: 'sent_back', submitted: true }, pass).grade, 'sent_back');
  assert.deepEqual(gradeCriterion({ kind: 'artefact', policy: 'agent', state: 'submitted', submitted: true }, fail),
    { grade: 'failing', why: 'out/summary.docx was written before this item started' });
  // Nothing offered and nothing there to check is not "failing": it has not started.
  assert.equal(gradeCriterion({ kind: 'citation', policy: 'propose', state: 'open', submitted: false }, fail).grade, 'no_evidence');
});

test('a test report older than the code reads so, met or not, offered or not (B8.4a)', () => {
  const why = '⚠ tests older than the code: test-results/unit.xml ran 2026-10-01 09:00, before the last change to this item\'s files (2026-10-01 09:30) — run the tests again';
  const older = { ok: false, findings: [{ status: 'fail', message: why, reason: 'tests_older' }] };
  for (const [state, submitted] of [['met', true], ['open', false], ['submitted', true]] as const) {
    assert.deepEqual(gradeCriterion({ kind: 'test', policy: 'agent', state, submitted }, older), { grade: 'tests_older', why });
  }
  // A person's own verdicts come first: changed since, or sent back.
  assert.equal(gradeCriterion({ kind: 'test', policy: 'propose', state: 'stale', submitted: true }, older).grade, 'changed');
});

test('checks passing: met is grounded; a person deciding, or a judgement, waits on a person; passing evidence not yet offered is grounded', () => {
  assert.equal(gradeCriterion({ kind: 'test', policy: 'agent', state: 'met', submitted: true }, pass).grade, 'grounded');
  assert.deepEqual(gradeCriterion({ kind: 'citation', policy: 'propose', state: 'submitted', submitted: true }, pass),
    { grade: 'waiting', why: 'its checks pass; a person decides' });
  assert.equal(gradeCriterion({ kind: 'manual', policy: 'human', state: 'open', submitted: false }, pass).grade, 'waiting');
  assert.equal(gradeCriterion({ kind: 'manual', policy: 'human', state: 'met', submitted: true }, pass).grade, 'grounded');
  assert.equal(gradeCriterion({ kind: 'artefact', policy: 'agent', state: 'open', submitted: false }, pass).grade, 'grounded');
  // A check that could not run says nothing against it, and nothing for it beyond the state.
  assert.equal(gradeCriterion({ kind: 'code', policy: 'agent', state: 'met', submitted: true }, null).grade, 'grounded');
  assert.equal(gradeCriterion({ kind: 'code', policy: 'agent', state: 'open', submitted: false }, null).grade, 'no_evidence');
  assert.equal(gradeCriterion({ kind: 'code', policy: 'propose', state: 'submitted', submitted: true }, null).grade, 'waiting');
});
