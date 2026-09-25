/**
 * The bundled spell-check dictionaries: which languages a person gets, and
 * that installing puts real files where Chromium looks. That Chromium then
 * fetches nothing is proved in real Electron by `tools/spellcheck-check`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseLanguages, installDictionaries, bundledDictionaryDir } from './spellcheck';

const REPO = path.resolve(__dirname, '../..');
const BUNDLED = ['en-AU', 'en-CA', 'en-GB', 'en-US'];

describe('choosing the languages', () => {
  test('a preferred language that is bundled is used as it is', () => {
    assert.deepEqual(chooseLanguages(BUNDLED, ['en-GB']), ['en-GB']);
    assert.deepEqual(chooseLanguages(BUNDLED, ['en-gb', 'en-US']), ['en-GB', 'en-US']);
  });

  test('a base language, or a regional one not bundled, gets a bundled variant', () => {
    assert.deepEqual(chooseLanguages(BUNDLED, ['en']), ['en-US']);
    assert.deepEqual(chooseLanguages(BUNDLED, ['en-NZ']), ['en-US']);
    assert.deepEqual(chooseLanguages(['fr-CA', 'fr-FR'], ['fr']), ['fr-FR']);
  });

  test('a base language adds nothing when a variant of it is already chosen', () => {
    assert.deepEqual(chooseLanguages(BUNDLED, ['en-US', 'en']), ['en-US']);
    assert.deepEqual(chooseLanguages(BUNDLED, ['en-GB', 'en']), ['en-GB']);
  });

  test('a language that is not bundled is never asked for — English stands in', () => {
    assert.deepEqual(chooseLanguages(BUNDLED, ['fr-FR', 'fr']), ['en-US']);
    assert.deepEqual(chooseLanguages(BUNDLED, ['fr-FR', 'en-CA']), ['en-CA']);
  });

  test('with nothing bundled, nothing is chosen', () => {
    assert.deepEqual(chooseLanguages([], ['en-US']), []);
  });
});

describe('installing', () => {
  test('every bundled dictionary lands in <userData>/Dictionaries, and a damaged copy is replaced', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-spellcheck-'));
    try {
      const bundle = bundledDictionaryDir(REPO, undefined, false);
      const installed = installDictionaries(bundle, userData);
      assert.deepEqual([...installed].sort(), BUNDLED);
      const target = path.join(userData, 'Dictionaries', 'en-US-10-1.bdic');
      assert.equal(fs.statSync(target).size, fs.statSync(path.join(bundle, 'en-US-10-1.bdic')).size);

      fs.writeFileSync(target, 'truncated');
      installDictionaries(bundle, userData);
      assert.equal(fs.statSync(target).size, fs.statSync(path.join(bundle, 'en-US-10-1.bdic')).size);
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('a missing bundle installs nothing rather than throwing', () => {
    assert.deepEqual(installDictionaries(path.join(os.tmpdir(), 'no-such-bundle'), os.tmpdir()), []);
  });

  test('the packaged location is <resources>/spellcheck', () => {
    assert.equal(bundledDictionaryDir('/app', '/res', true), path.join('/res', 'spellcheck'));
  });
});
