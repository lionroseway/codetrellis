/**
 * The running version is package.json's, with no build step in between.
 *
 * Unbundled — as here, and as the `tsx` dev backend runs — there is no
 * stamp, so the rest must read as "unknown" rather than as some earlier
 * build's commit. The packaged half of this is checked against the real
 * artifact by scripts/verify-build-stamp.js, which no unit test can reach.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BUILD_INFO } from './build-info';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

test('BUILD_INFO.version is package.json version', () => {
  assert.equal(BUILD_INFO.version, pkg.version);
});

test('unbundled, the build stamp is empty rather than stale', () => {
  assert.equal(BUILD_INFO.commit, '');
  assert.equal(BUILD_INFO.commitShort, '');
  assert.equal(BUILD_INFO.buildTime, '');
  assert.equal(BUILD_INFO.buildNumber, 0);
});
