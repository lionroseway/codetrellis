/**
 * The fixture must be in the state the demo expects to find it.
 *
 * `npm run demo` edits files in `tests/fixtures/sample-app` and restores
 * them on the way out. If a commit is made while a run is in flight,
 * `git add -A` sweeps the mutation into the fixture permanently — which
 * is exactly what commit 85e69fb did to `money.go`.
 *
 * The consequence was quiet and expensive. The work scene's edit is a
 * `String.replace`, which returns the original unchanged when it matches
 * nothing. So "do the work" wrote the same bytes back, git reported no
 * change, no line was annotated, and the verdict scene rendered a file
 * with nothing marked while narrating what the marks meant. Every layer
 * reported success; only a cropped screenshot disagreed.
 *
 * This asserts the pre-edit form is what is committed. It fails the
 * moment a run's mutation is committed, which is the only point at which
 * anyone can still tell what happened.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE = path.resolve(process.cwd(), 'tests/fixtures/sample-app');

/**
 * What each scene searches for. These are the literal strings the demo
 * replaces; if one is absent the corresponding scene does nothing.
 */
const PRE_EDIT_FORMS: Array<{ file: string; mustContain: string; scene: string }> = [
  {
    scene: 'work',
    file: 'services/shared-go/money/money.go',
    mustContain: 'func normalise(minor int64) int64 { return minor }',
  },
];

/** Marks the demo appends. Their presence means a run was committed. */
const RUN_ARTEFACTS: Array<{ file: string; mustNotContain: string }> = [
  { file: 'services/notifier/app.rb', mustNotContain: '# demo: unplanned tweak' },
  { file: 'services/api/app/config.py', mustNotContain: '# demo: unplanned tweak' },
  {
    file: 'services/shared-go/money/money.go',
    mustNotContain: '// normalise rounds half-up so every service agrees.',
  },
];

describe('the sample-app fixture is pristine', () => {
  for (const { file, mustContain, scene } of PRE_EDIT_FORMS) {
    test(`${file} still has what the "${scene}" scene edits`, () => {
      const body = fs.readFileSync(path.join(FIXTURE, file), 'utf-8');
      assert.ok(
        body.includes(mustContain),
        `${file} no longer contains the line the "${scene}" scene replaces.\n`
          + `Its edit is a no-op, so that scene now proves nothing.\n`
          + `Expected to find: ${mustContain}`,
      );
    });
  }

  for (const { file, mustNotContain } of RUN_ARTEFACTS) {
    test(`${file} carries no leftovers from a demo run`, () => {
      const body = fs.readFileSync(path.join(FIXTURE, file), 'utf-8');
      assert.ok(
        !body.includes(mustNotContain),
        `${file} contains "${mustNotContain}" — a demo run was committed into the fixture.\n`
          + 'Restore it, or the scene that writes this line will never change anything again.',
      );
    });
  }
});
