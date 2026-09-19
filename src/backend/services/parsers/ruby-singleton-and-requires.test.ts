/**
 * Two Ruby idioms the parser walked straight past, and one extension it
 * claimed but never received.
 *
 * Both parser defects have the same shape as the Phase 27 ones the
 * registry guard was built for: nothing errors, the file parses, and the
 * symbols or edges are simply absent. A class whose whole interface is
 * declared with `class << self` rendered as a node with no members; a
 * dependency required inside a `module` body or behind an `if` guard
 * produced no edge at all.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { rubyPlugin } from './ruby';
import { findUnscannedExtensions } from './index';
import { listTaggedExtensions } from '../project-scanner';
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
const names = (syms: ParsedSymbol[]) => syms.map((s) => s.name).sort();

describe('class << self contributes symbols (m14)', () => {
  const SRC = `
class Invoice
  class << self
    def build(attrs)
    end

    def from_json(raw)
    end

    attr_accessor :registry
  end

  def total
  end
end
`;

  test('the singleton methods are found', () => {
    // Previously: only `Invoice` and `Invoice#total`. The three members
    // declared the idiomatic way were absent, so "go to Invoice.build"
    // answered "no such symbol".
    assert.deepEqual(names(symbolsOf(SRC)), [
      'Invoice',
      'Invoice#total',
      'Invoice.build',
      'Invoice.from_json',
      'Invoice.registry',
    ]);
  });

  test('they are marked as class methods, not instance methods', () => {
    const build = symbolsOf(SRC).find((s) => s.name === 'Invoice.build');
    assert.ok(build, 'Invoice.build is present');
    assert.deepEqual(build!.modifiers, ['class_method']);
  });

  test('def self.x and class << self agree on the spelling', () => {
    // The two ways of saying the same thing must produce the same name,
    // or a reader has to know which one the author chose.
    const syms = names(symbolsOf(`
class Job
  def self.perform(x)
  end
end
`));
    assert.deepEqual(syms, ['Job', 'Job.perform']);
  });

  test('class << other reopens something else and is not claimed', () => {
    // `class << obj` is a different construct: those methods belong to
    // `obj`, not to the enclosing class. Naming them `Wrapper.something`
    // would be a fabrication.
    assert.deepEqual(names(symbolsOf(`
class Wrapper
  OTHER = Object.new
  class << OTHER
    def hidden
    end
  end
end
`)), ['Wrapper', 'Wrapper::OTHER']);
  });
});

describe('requires are found wherever they are written (m15)', () => {
  test('a require inside a module body is an import', () => {
    const srcs = importsOf(`
module Billing
  require 'json'
  require_relative '../lib/ledger'
end
`).map((i) => i.source).sort();
    assert.deepEqual(srcs, ['../lib/ledger', 'json']);
  });

  test('a conditional require is an import', () => {
    // The optional-dependency shape. This is the case where seeing the
    // edge matters MOST, and it was the case most reliably missed.
    const srcs = importsOf(`
begin
  require 'oj'
rescue LoadError
  require 'json'
end

if RUBY_VERSION >= '3.0'
  require 'ostruct'
end
`).map((i) => i.source).sort();
    assert.deepEqual(srcs, ['json', 'oj', 'ostruct']);
  });

  test('a top-level require still works', () => {
    assert.deepEqual(importsOf("require 'set'\n").map((i) => i.source), ['set']);
  });

  test('a call with a receiver named require is not an import', () => {
    // Walking the whole tree widened what `require` could match, so the
    // callee is now pinned to the head of the call. `Kernel.require` is
    // genuinely a require; `loader.require` is somebody's own method.
    assert.deepEqual(importsOf("loader.require 'plugin'\n").map((i) => i.source), []);
  });
});

describe('every parsed extension is one the scanner ingests (m16)', () => {
  test('no plugin claims an extension the scanner drops', () => {
    // `.rake` was in the Ruby plugin and absent from the scanner's
    // LANG_MAP. The language-level guard could not see it — `ruby` was
    // both tagged and parsed, via `.rb` — so a Rakefile was never
    // ingested while the file-watcher happily queued re-parses for it.
    assert.deepEqual(findUnscannedExtensions(listTaggedExtensions()), []);
  });

  test('the check actually reports a missing extension', () => {
    // Guarding the guard: an assertion that can only pass is not one.
    assert.ok(findUnscannedExtensions(['.rb']).includes('.ts'));
  });

  test('.rake is a Ruby file to the scanner', () => {
    assert.ok(listTaggedExtensions().includes('.rake'));
    assert.ok(rubyPlugin.extensions.includes('.rake'));
  });
});
