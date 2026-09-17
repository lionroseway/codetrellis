/**
 * Unit tests for the Go parser plugin (Phase 20).
 *
 * Runs under `npm run test:unit`. Unlike the callsite tests these need
 * a real tree-sitter tree, so the grammar is loaded directly rather
 * than through `ast-parser` (which carries backend state we don't want
 * in a unit test).
 *
 * That makes this suite double as the **grammar compatibility guard**:
 * `resources/tree-sitter/tree-sitter-go.wasm` must load under the
 * pinned `web-tree-sitter`, and the node names this plugin reads must
 * still exist. A grammar swap that breaks either fails here in
 * seconds, instead of surfacing as an inexplicably empty graph.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { goPlugin } from './go';
import type { ParsedSymbol } from '../../../shared/types';

const require_ = createRequire(import.meta.url);
// Resolve through the package's `exports` map — the .cjs file is not
// an exported subpath, so only the bare specifier works.
const WTS_ENTRY = require_.resolve('web-tree-sitter');
const WTS_DIR = path.dirname(WTS_ENTRY);
const GRAMMAR = path.resolve(import.meta.dirname, '../../../../resources/tree-sitter/tree-sitter-go.wasm');

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

const symbolsOf = (src: string): ParsedSymbol[] => goPlugin.extractSymbols(parse(src));
const importsOf = (src: string) => goPlugin.extractImports(parse(src));
const byName = (syms: ParsedSymbol[]) => new Map(syms.map((s) => [s.name, s]));

describe('grammar', () => {
  test('the committed wasm loads and parses valid Go without errors', () => {
    const root = parse('package main\n\nfunc main() {}\n');
    assert.equal(root.type, 'source_file');
    assert.equal(root.hasError, false);
  });
});

describe('symbols', () => {
  test('functions, and exportedness from the initial rune', () => {
    const m = byName(symbolsOf(`
package x

func Exported() {}
func unexported() {}
`));
    assert.equal(m.get('Exported')?.kind, 'function');
    assert.ok(m.get('Exported')?.modifiers.includes('exported'));
    assert.ok(!m.get('unexported')?.modifiers.includes('exported'));
  });

  test('methods are qualified by receiver type, pointer or value', () => {
    const m = byName(symbolsOf(`
package x

func (l *Ledger) Post() {}
func (e Entry) Describe() string { return "" }
`));
    assert.ok(m.has('(Ledger).Post'), 'pointer receiver');
    assert.ok(m.has('(Entry).Describe'), 'value receiver');
    // The unqualified form must not leak — collisions across types are
    // the whole reason for qualifying.
    assert.ok(!m.has('Post'));
  });

  test('generic receivers drop their type parameters', () => {
    const m = byName(symbolsOf(`
package x

func (s *Stack[T]) Push(v T) {}
`));
    assert.ok(m.has('(Stack).Push'));
  });

  test('struct, interface, alias and grouped type specs', () => {
    const m = byName(symbolsOf(`
package x

type Ledger struct{ ID string }
type Reader interface{ Read() error }
type (
	Page   []Entry
	Cursor string
)
`));
    assert.equal(m.get('Ledger')?.kind, 'class');
    assert.ok(m.get('Ledger')?.modifiers.includes('struct'));
    assert.equal(m.get('Reader')?.kind, 'interface');
    // Both members of the grouped declaration, not just the first.
    assert.equal(m.get('Page')?.kind, 'type');
    assert.equal(m.get('Cursor')?.kind, 'type');
  });

  test('const and var, including multi-name specs, skipping blanks', () => {
    const m = byName(symbolsOf(`
package x

const MaxRetries = 3
var a, b int
var _ = ignored
`));
    assert.ok(m.get('MaxRetries')?.modifiers.includes('const'));
    assert.ok(m.get('a')?.modifiers.includes('var'));
    assert.ok(m.get('b')?.modifiers.includes('var'), 'second name in the spec');
    assert.ok(!m.has('_'), 'blank identifier is not a symbol');
  });
});

describe('imports', () => {
  const SRC = `
package main

import (
	"fmt"
	"net/http"
	store "github.com/org/billing/internal/store"
	_ "github.com/lib/pq"
	. "github.com/org/dsl"
)

import "os"
`;

  test('every spec form is extracted, grouped and single', () => {
    const sources = importsOf(SRC).map((i) => i.source);
    assert.deepEqual(sources, [
      'fmt',
      'net/http',
      'github.com/org/billing/internal/store',
      'github.com/lib/pq',
      'github.com/org/dsl',
      'os',
    ]);
  });

  test('quotes are stripped from the path', () => {
    for (const imp of importsOf(SRC)) {
      assert.ok(!imp.source.includes('"'), `unquoted: ${imp.source}`);
    }
  });

  test('an alias becomes the specifier, otherwise the last path segment', () => {
    const m = new Map(importsOf(SRC).map((i) => [i.source, i.specifiers]));
    assert.deepEqual(m.get('github.com/org/billing/internal/store'), ['store']);
    assert.deepEqual(m.get('net/http'), ['http']);
  });

  test('a blank import is kept — it is a deliberate side-effect dependency', () => {
    // Driver and codec registration happen entirely through `_` imports.
    // They are invisible in the call graph, which makes them more worth
    // surfacing than an ordinary import, not less.
    const blank = importsOf(SRC).find((i) => i.source === 'github.com/lib/pq');
    assert.ok(blank, 'blank import must not be dropped');
    assert.deepEqual(blank!.specifiers, ['_']);
  });

  test('a dot import is flagged as a namespace import', () => {
    const dot = importsOf(SRC).find((i) => i.source === 'github.com/org/dsl');
    assert.equal(dot?.isNamespace, true);
  });
});
