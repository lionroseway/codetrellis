/**
 * Guard for the syntax-highlighting language maps (Phase 27).
 *
 * `prism-react-renderer` bundles a cut-down Prism, and a grammar it does
 * not contain fails *silently*: the renderer returns the source as one
 * plain token and nothing reports it. Six language tags had been mapped
 * to grammars that were never in the bundle. This suite is the thing
 * that would have caught it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Prism } from 'prism-react-renderer';
import { resolvePrismLanguage, unhighlightablePrismTags, knownPrismTags } from './prism-lang';
import { languageExtensionFor, languageForPath, highlightableLanguages } from './codemirror-lang';

describe('prism language map', () => {
  test('never names a grammar the bundle does not ship', () => {
    assert.deepEqual(unhighlightablePrismTags(), []);
  });

  test('an unknown tag resolves to plain rather than throwing', () => {
    assert.equal(resolvePrismLanguage('klingon'), 'plain');
    assert.equal(resolvePrismLanguage(undefined), 'plain');
  });

  test('the Phase 27 languages resolve to a real grammar', () => {
    // Kotlin and Swift are in the bundle outright; C# borrows `clike`,
    // which is correct for its comments, strings, numbers and keywords.
    assert.equal(resolvePrismLanguage('kotlin'), 'kotlin');
    assert.equal(resolvePrismLanguage('swift'), 'swift');
    assert.equal(resolvePrismLanguage('csharp'), 'clike');
    for (const tag of ['kotlin', 'swift', 'csharp']) {
      const grammar = resolvePrismLanguage(tag);
      assert.ok((Prism.languages as Record<string, unknown>)[grammar], `${tag} → ${grammar} missing`);
    }
  });

  test('ruby stays plain — a wrong grammar is worse than none', () => {
    // Ruby has no bundled grammar and is not C-family, so borrowing
    // `clike` would mis-tokenise it rather than under-tokenise it.
    assert.equal(resolvePrismLanguage('ruby'), 'plain');
  });

  test('every tag the map knows resolves to something usable', () => {
    for (const tag of knownPrismTags()) {
      const grammar = resolvePrismLanguage(tag);
      assert.ok(
        grammar === 'plain' || (Prism.languages as Record<string, unknown>)[grammar],
        `${tag} → ${grammar}`,
      );
    }
  });
});

describe('codemirror language map', () => {
  test('the Phase 27 languages have a diff-editor grammar', () => {
    for (const lang of ['csharp', 'kotlin', 'swift']) {
      assert.ok(languageExtensionFor(lang), `${lang} has no CodeMirror extension`);
      assert.ok(highlightableLanguages().includes(lang));
    }
  });

  test('extensions map to the same tags the scanner uses', () => {
    assert.equal(languageForPath('Invoice.cs'), 'csharp');
    assert.equal(languageForPath('Invoice.kt'), 'kotlin');
    assert.equal(languageForPath('build.gradle.kts'), 'kotlin');
    assert.equal(languageForPath('Invoice.swift'), 'swift');
  });

  test('a language with no grammar returns null, not a wrong one', () => {
    assert.equal(languageExtensionFor('ruby'), null);
    assert.equal(languageExtensionFor('klingon'), null);
    assert.equal(languageExtensionFor(null), null);
  });
});
