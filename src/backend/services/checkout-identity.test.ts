/**
 * Which checkout holds a doc or plan (Phase 32 A1.7b, bug 46).
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { heldByAnotherCheckout } from './checkout-identity';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-identity-')));
const main = path.join(tmp, 'app');
const wt = path.join(tmp, 'app-wt');
fs.mkdirSync(main);
fs.mkdirSync(wt);
fs.symlinkSync(main, path.join(tmp, 'link-to-app'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('heldByAnotherCheckout', () => {
  test('another checkout that still exists holds it: leave the row alone', () => {
    assert.equal(heldByAnotherCheckout(main, wt), true);
  });

  test('the same checkout re-importing its own file is not "another"', () => {
    assert.equal(heldByAnotherCheckout(main, main), false);
    assert.equal(heldByAnotherCheckout(main, path.join(tmp, 'link-to-app')), false, 'compared by real path');
  });

  test('a holder whose folder is gone gives the row up to the next checkout', () => {
    assert.equal(heldByAnotherCheckout(path.join(tmp, 'moved-away'), wt), false);
  });

  test('no holder, or one that is not an absolute path, holds nothing', () => {
    assert.equal(heldByAnotherCheckout(null, wt), false);
    assert.equal(heldByAnotherCheckout(undefined, wt), false);
    assert.equal(heldByAnotherCheckout('.', wt), false);
  });
});
