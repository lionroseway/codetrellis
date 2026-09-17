/**
 * Unit tests for the Ruby parser plugin (Phase 27).
 *
 * Doubles as the grammar compatibility guard, the same way
 * `go.test.ts` does: an incompatible grammar is caught, logged and
 * skipped at load time, so it presents as a silently empty language
 * rather than a crash. This suite fails in seconds instead.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { rubyPlugin } from './ruby';
import { findUnparsedLanguages } from './index';
import { listTaggedLanguages } from '../project-scanner';
import type { ParsedSymbol } from '../../../shared/types';

const require_ = createRequire(import.meta.url);
const WTS_ENTRY = require_.resolve('web-tree-sitter');
const WTS_DIR = path.dirname(WTS_ENTRY);
const GRAMMAR = path.resolve(import.meta.dirname, '../../../../resources/tree-sitter/tree-sitter-ruby.wasm');

let parse: (src: string) => any;

before(async () => {
  const mod: any = require_(WTS_ENTRY);
  const Parser = mod.Parser ?? mod.default?.Parser ?? mod;
  const Language = mod.Language ?? Parser.Language;
  await Parser.init({ locateFile: () => path.join(WTS_DIR, 'web-tree-sitter.wasm') });
  const language = await Language.load(GRAMMAR);
  const parser = new Parser();
  parser.setLanguage(language);
  parse = (src: string) => parser.parse(src).rootNode;
});

const symbolsOf = (src: string): ParsedSymbol[] => rubyPlugin.extractSymbols(parse(src));
const importsOf = (src: string) => rubyPlugin.extractImports(parse(src));
const byName = (syms: ParsedSymbol[]) => new Map(syms.map((s) => [s.name, s]));

describe('grammar', () => {
  test('the committed wasm loads and parses valid Ruby', () => {
    const root = parse("class Foo\n  def bar\n  end\nend\n");
    assert.equal(root.type, 'program');
    assert.equal(root.hasError, false);
  });
});

describe('symbols', () => {
  test('methods are qualified the way Ruby writes them', () => {
    const m = byName(symbolsOf(`
class Invoice
  def self.open_invoices
  end

  def post(amount)
  end
end
`));
    // Ruby codebases are full of call / run / perform / to_s on
    // different classes; flat names would collide constantly.
    assert.ok(m.has('Invoice#post'), 'instance method uses #');
    assert.ok(m.has('Invoice.open_invoices'), 'class method uses .');
    assert.ok(!m.has('post'), 'the unqualified form must not leak');
  });

  test('nested modules and classes carry their full path', () => {
    const m = byName(symbolsOf(`
module Billing
  class Invoice
    def post
    end
  end
end
`));
    assert.ok(m.has('Billing'));
    assert.ok(m.has('Billing::Invoice'));
    assert.ok(m.has('Billing::Invoice#post'));
  });

  test('a superclass is recorded as a modifier', () => {
    const m = byName(symbolsOf('class Invoice < ApplicationRecord\nend\n'));
    assert.equal(m.get('Invoice')?.kind, 'class');
    assert.ok(m.get('Invoice')?.modifiers.includes('extends:ApplicationRecord'));
  });

  test('a module is not a class', () => {
    const m = byName(symbolsOf('module Helpers\nend\n'));
    assert.equal(m.get('Helpers')?.kind, 'interface');
    assert.ok(m.get('Helpers')?.modifiers.includes('module'));
  });

  test('attr_* declares real, referenceable methods', () => {
    const m = byName(symbolsOf(`
class Invoice
  attr_reader :total, :status
  attr_accessor :note
end
`));
    // These genuinely define methods in Ruby — a reader looking for
    // Invoice#total should find it.
    assert.ok(m.has('Invoice#total'));
    assert.ok(m.has('Invoice#status'));
    assert.ok(m.has('Invoice#note'));
    assert.equal(m.get('Invoice#total')?.kind, 'method');
    assert.ok(m.get('Invoice#note')?.modifiers.includes('attr_accessor'));
  });

  test('constants are symbols; local assignments are not', () => {
    const m = byName(symbolsOf('RATE = 0.2\nthing = 3\n'));
    assert.ok(m.has('RATE'));
    assert.ok(!m.has('thing'));
  });

  test('a top-level method needs no qualifier', () => {
    const m = byName(symbolsOf("def helper\nend\n"));
    assert.ok(m.has('helper'));
  });
});

describe('imports', () => {
  const SRC = `
require 'json'
require_relative '../lib/ledger'
require 'active_support/core_ext'
load 'tasks/thing.rb'
`;

  test('every require form is extracted', () => {
    assert.deepEqual(importsOf(SRC).map((i) => i.source), [
      'json',
      '../lib/ledger',
      'active_support/core_ext',
      'tasks/thing.rb',
    ]);
  });

  test('require_relative is flagged, because the source alone cannot say so', () => {
    // Ruby is the first language here where `require_relative 'x'` and
    // `require 'x'` are identical strings with different meanings.
    const m = new Map(importsOf(SRC).map((i) => [i.source, i.isRelative]));
    assert.equal(m.get('../lib/ledger'), true);
    assert.equal(m.get('json'), false);
  });

  test('quotes are stripped', () => {
    for (const imp of importsOf(SRC)) {
      assert.ok(!imp.source.includes("'"), imp.source);
      assert.ok(!imp.source.includes('"'), imp.source);
    }
  });
});

describe('the structural guard', () => {
  test('no language the scanner tags is left without a parser', () => {
    // This is the test that would have caught Ruby. It has now been the
    // same bug three times — a hand-maintained list falling out of sync
    // with another one, failing silently every time.
    assert.deepEqual(findUnparsedLanguages(listTaggedLanguages()), []);
  });

  test('the guard actually detects a gap', () => {
    assert.deepEqual(findUnparsedLanguages(['typescript', 'elixir']), ['elixir']);
  });

  test('deliberately unparsed tags are not reported', () => {
    // SQL has no import graph and is handled ahead of the tree-sitter
    // dispatch; markup and data formats are tagged for display only.
    assert.deepEqual(findUnparsedLanguages(['sql', 'json', 'markdown', 'yaml']), []);
  });
});
