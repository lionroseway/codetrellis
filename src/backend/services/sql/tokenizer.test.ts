/**
 * The tokenizer must not throw. Ever.
 *
 * It runs inside `extractEmbeddedSql`, which runs over every string literal in
 * every parsed file. A throw there is not a bad token — it takes the whole
 * file's SQL callsites with it, silently, because the caller treats a failed
 * extraction as "this file has no SQL".
 *
 * `:#` did exactly that. `isWordStart` accepted `#` (MySQL and T-SQL use it in
 * identifiers) while the pattern built from it used `\w`, which does not. The
 * guard passed, the match returned null, and a non-null assertion turned that
 * into a TypeError. Ruby makes it ordinary rather than exotic: `"notifier:#{id}"`
 * contains `:#`, and this PR adds Ruby as a parsed language.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from './tokenizer';

describe('tokenizer resilience', () => {
  test('a guard and its pattern disagreeing does not throw', () => {
    // The original crash, both spellings.
    assert.doesNotThrow(() => tokenize(':#'));
    assert.doesNotThrow(() => tokenize('@#'));
  });

  test('the Ruby interpolation that made this reachable is tokenised', () => {
    assert.doesNotThrow(() => tokenize('notifier:#{id}'));
    assert.doesNotThrow(() => tokenize('SELECT * FROM t WHERE k = "queue:#{id}"'));
  });

  test('real bind parameters still tokenise as parameters', () => {
    assert.equal(tokenize(':id')[0].type, 'param');
    assert.equal(tokenize('@name')[0].type, 'param');
    assert.equal(tokenize(':id')[0].value, ':id');
  });

  test('assorted junk produces tokens rather than exceptions', () => {
    for (const s of ['::', '@@', ':', '@', '$', '$$', '?', '%', ':#{}', '@#$%']) {
      assert.doesNotThrow(() => tokenize(s), `tokenize(${JSON.stringify(s)}) threw`);
    }
  });
});
