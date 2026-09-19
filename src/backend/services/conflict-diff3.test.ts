/**
 * Field-level conflict resolution was unreachable for anyone running
 * `merge.conflictStyle = diff3`.
 *
 * Under diff3 (and zdiff3) git writes a third block into every conflict:
 *
 *   <<<<<<< HEAD
 *   ours
 *   ||||||| merged common ancestors
 *   the base
 *   =======
 *   theirs
 *   >>>>>>> branch
 *
 * The extractor knew three markers and not the fourth, so for `ours` it
 * kept the `|||||||` line AND the whole base block. Our side then never
 * parsed as YAML, `parseYamlConflictFields` returned null for every
 * conflicted manifest, and the UI told the user their file "could not be
 * broken into fields — it is not YAML or JSON" about a file that was
 * perfectly good YAML. The whole feature was off for a common global git
 * setting, and it said so in a way that pointed at the wrong thing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractConflictSide } from './plan-conflict-service';

const TWO_WAY = `title: A plan
<<<<<<< HEAD
status: active
=======
status: draft
>>>>>>> theirs
author: saif
`;

const DIFF3 = `title: A plan
<<<<<<< HEAD
status: active
||||||| merged common ancestors
status: proposed
=======
status: draft
>>>>>>> theirs
author: saif
`;

describe('conflict sides under diff3 (m19)', () => {
  test('our side excludes the base block', () => {
    const ours = extractConflictSide(DIFF3, 'ours');
    assert.equal(ours, 'title: A plan\nstatus: active\nauthor: saif\n');
    // Explicitly: neither the marker nor the ancestor's value survives.
    assert.ok(!ours!.includes('|||||||'));
    assert.ok(!ours!.includes('proposed'));
  });

  test('their side is unchanged', () => {
    assert.equal(extractConflictSide(DIFF3, 'theirs'), 'title: A plan\nstatus: draft\nauthor: saif\n');
  });

  test('the base is discarded, not offered as a third choice', () => {
    // It is the common ancestor: the one value NEITHER person chose.
    for (const side of ['ours', 'theirs'] as const) {
      assert.ok(!extractConflictSide(DIFF3, side)!.includes('proposed'), side);
    }
  });

  test('the ordinary two-way form still works', () => {
    assert.equal(extractConflictSide(TWO_WAY, 'ours'), 'title: A plan\nstatus: active\nauthor: saif\n');
    assert.equal(extractConflictSide(TWO_WAY, 'theirs'), 'title: A plan\nstatus: draft\nauthor: saif\n');
  });

  test('both sides parse as YAML, which is the point', () => {
    // The failure was not "a marker leaked through" — it was that our
    // side stopped being YAML, which is what made the whole field-level
    // UI unreachable.
    const { parse } = require('yaml');
    assert.equal((parse(extractConflictSide(DIFF3, 'ours')!) as { status: string }).status, 'active');
    assert.equal((parse(extractConflictSide(DIFF3, 'theirs')!) as { status: string }).status, 'draft');
  });
});
