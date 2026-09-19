/**
 * Unit tests for in-scope checking (Phase 22).
 *
 * The restraint cases matter more than the positive ones: a badge that
 * cries wolf gets ignored, and then the one time it is right nobody
 * looks.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { PlanItem } from '../../shared/types';
import { checkScope, describeScope } from './scope-check';

const item = (status: string, paths: string[]): PlanItem =>
  ({
    uid: `itm_${status}_${paths.join('_')}`,
    status,
    fileSpecs: paths.map((path) => ({ path, action: 'modify' })),
  } as unknown as PlanItem);

describe('scope verdicts', () => {
  test('changes covered by a claimed item are in scope', () => {
    const r = checkScope(['src/auth/session.ts'], [item('in_progress', ['src/auth/session.ts'])]);
    assert.equal(r.verdict, 'in-scope');
    assert.deepEqual(r.outOfScope, []);
  });

  test('a change nothing claims is the finding', () => {
    const r = checkScope(
      ['src/auth/session.ts', 'src/billing/invoice.ts'],
      [item('in_progress', ['src/auth/session.ts'])],
    );
    assert.equal(r.verdict, 'out-of-scope');
    assert.deepEqual(r.outOfScope, ['src/billing/invoice.ts']);
    assert.deepEqual(r.inScope, ['src/auth/session.ts']);
  });

  test('a directory target covers files beneath it', () => {
    const r = checkScope(['src/auth/session.ts', 'src/auth/tokens/rotate.ts'], [item('in_progress', ['src/auth'])]);
    assert.equal(r.verdict, 'in-scope');
  });

  test('a directory target does not match a same-prefix sibling', () => {
    // `auth` must not cover `authentication.ts` — that would quietly
    // wave through exactly the kind of change worth flagging.
    const r = checkScope(['src/authentication.ts'], [item('in_progress', ['src/auth'])]);
    assert.equal(r.verdict, 'out-of-scope');
  });

  test('leading ./ and case differences do not create false findings', () => {
    const r = checkScope(['./src/Auth/Session.ts'], [item('in_progress', ['src/auth/session.ts'])]);
    assert.equal(r.verdict, 'in-scope');
  });
});

describe('restraint', () => {
  test('no recent changes is clean, not green', () => {
    const r = checkScope([], [item('in_progress', ['src/auth'])]);
    assert.equal(r.verdict, 'clean');
  });

  test('nothing in flight means no verdict to give', () => {
    const r = checkScope(['src/anything.ts'], [item('done', ['src/auth'])]);
    assert.equal(r.verdict, 'clean');
    assert.equal(r.claimedItems.length, 0);
  });

  test('an in-flight item with no declared targets is not a violation', () => {
    // Reporting drift against a plan that declared no scope would be
    // noise, and noise teaches people to ignore the badge.
    const r = checkScope(['src/anything.ts'], [item('in_progress', [])]);
    assert.equal(r.verdict, 'clean');
  });

  test('only in-flight items count', () => {
    const r = checkScope(['src/billing/x.ts'], [item('pending', ['src/billing'])]);
    assert.equal(r.verdict, 'clean');
  });
});

describe('descriptions', () => {
  test('each verdict has a readable line', () => {
    assert.equal(describeScope(checkScope([], [])), 'No item in flight');
    assert.equal(
      describeScope(checkScope(['a.ts'], [item('in_progress', ['a.ts'])])),
      '1 file changed, all in scope',
    );
    assert.equal(
      describeScope(checkScope(['b.ts'], [item('in_progress', ['a.ts'])])),
      '1 file changed that no item claims',
    );
  });
});
