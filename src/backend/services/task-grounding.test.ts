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
