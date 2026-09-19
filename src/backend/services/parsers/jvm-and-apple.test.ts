/**
 * Unit tests for the C#, Kotlin and Swift parser plugins (Phase 27).
 *
 * One suite for three languages because they share the failure they are
 * guarding against: each grammar packs several distinct declarations
 * into one node type and distinguishes them with an **anonymous**
 * keyword token. Read the named children only and a Kotlin interface
 * files as a class, a Swift struct files as a class, and a Swift
 * extension overwrites the type it extends. None of that errors — it
 * just quietly produces a wrong graph, which is the failure mode this
 * whole phase exists to stop.
 *
 * Doubles as the grammar-compatibility guard, as `go.test.ts` and
 * `ruby.test.ts` do: an incompatible grammar is caught, logged and
 * skipped at load time, so it presents as a silently empty language.
 * This suite fails in seconds instead.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { csharpPlugin } from './csharp';
import { javaPlugin } from './java';
import { kotlinPlugin } from './kotlin';
import { swiftPlugin } from './swift';
import { PARSER_PLUGINS, findUnparsedLanguages } from './index';
import { listTaggedLanguages } from '../project-scanner';
import type { ParsedSymbol } from '../../../shared/types';
import type { ParserPlugin } from './base';

const require_ = createRequire(import.meta.url);
const WTS_ENTRY = require_.resolve('web-tree-sitter');
const WTS_DIR = path.dirname(WTS_ENTRY);
const GRAMMAR_DIR = path.resolve(import.meta.dirname, '../../../../resources/tree-sitter');

const parsers = new Map<string, (src: string) => any>();

before(async () => {
  const mod: any = require_(WTS_ENTRY);
  const Parser = mod.Parser ?? mod.default?.Parser ?? mod;
  const Language = mod.Language ?? Parser.Language;
  await Parser.init({ locateFile: () => path.join(WTS_DIR, 'web-tree-sitter.wasm') });

  for (const plugin of [csharpPlugin, kotlinPlugin, swiftPlugin, javaPlugin]) {
    const language = await Language.load(path.join(GRAMMAR_DIR, plugin.grammarFile));
    const parser = new Parser();
    parser.setLanguage(language);
    parsers.set(plugin.language, (src: string) => parser.parse(src).rootNode);
  }
});

const rootOf = (plugin: ParserPlugin, src: string) => parsers.get(plugin.language)!(src);
const symbolsOf = (plugin: ParserPlugin, src: string): ParsedSymbol[] =>
  plugin.extractSymbols(rootOf(plugin, src));
const importsOf = (plugin: ParserPlugin, src: string) =>
  plugin.extractImports(rootOf(plugin, src));

/** Every symbol, nested ones included, keyed by name. */
function flatten(symbols: ParsedSymbol[], into = new Map<string, ParsedSymbol>()): Map<string, ParsedSymbol> {
  for (const sym of symbols) {
    into.set(sym.name, sym);
    flatten(sym.children, into);
  }
  return into;
}

// ============================================================
// C#
// ============================================================

describe('C# grammar', () => {
  test('the committed wasm loads and parses valid C#', () => {
    const root = rootOf(csharpPlugin, 'namespace N;\npublic class A { }\n');
    assert.equal(root.type, 'compilation_unit');
    assert.equal(root.hasError, false);
  });
});

describe('C# symbols', () => {
  test('both namespace forms produce identical symbols', () => {
    const fileScoped = symbolsOf(csharpPlugin, `
namespace Acme.Billing;

public class Invoice
{
    public void Post(decimal amount) { }
}
`);
    const block = symbolsOf(csharpPlugin, `
namespace Acme.Billing
{
    public class Invoice
    {
        public void Post(decimal amount) { }
    }
}
`);
    // The C# 10 syntax is a spelling change, not a structural one. If
    // the graph differed between these two files, upgrading a project's
    // language version would rewrite its architecture diagram.
    assert.deepEqual(
      [...flatten(fileScoped).keys()].sort(),
      [...flatten(block).keys()].sort(),
    );
    assert.deepEqual([...flatten(fileScoped).keys()].sort(), ['Invoice', 'Invoice.Post']);
  });

  test('a namespace is not itself a symbol', () => {
    const names = [...flatten(symbolsOf(csharpPlugin, 'namespace Acme.Billing;\nclass A { }\n')).keys()];
    assert.ok(!names.some((n) => n.includes('Acme')), `namespace leaked into symbols: ${names}`);
  });

  test('interfaces, records, structs and enums keep their own kinds', () => {
    const syms = flatten(symbolsOf(csharpPlugin, `
public interface IPoster { void Post(decimal amount); }
public enum Status { Open, Closed }
public record struct Money(decimal Amount, string Currency);
public struct Point { public int X; }
`));
    assert.equal(syms.get('IPoster')?.kind, 'interface');
    assert.equal(syms.get('Status')?.kind, 'enum');
    assert.equal(syms.get('Money')?.kind, 'class');
    assert.ok(syms.get('Money')?.modifiers.includes('record'));
    assert.ok(syms.get('Point')?.modifiers.includes('struct'));
    // Enum members and positional record properties are reachable.
    assert.ok(syms.has('Status.Open'));
    assert.ok(syms.has('Money.Amount'));
    assert.ok(syms.has('Point.X'));
  });

  test('members are qualified by their type', () => {
    const syms = flatten(symbolsOf(csharpPlugin, `
public class Invoice
{
    private decimal _total, _paid;
    public decimal Total => _total;
    public Invoice(decimal seed) { }
    public void Post(decimal amount) { }
}
`));
    // `Post` and `Total` are on half the types in a real C# codebase.
    assert.ok(syms.has('Invoice.Post'));
    assert.ok(syms.has('Invoice.Total'));
    assert.ok(syms.has('Invoice.Invoice'));
    // Two fields declared in one statement are two symbols.
    assert.ok(syms.has('Invoice._total'));
    assert.ok(syms.has('Invoice._paid'));
  });

  test('visibility is recorded — it is the architectural boundary', () => {
    const syms = flatten(symbolsOf(csharpPlugin, 'public static class Ext { internal static void F() { } }'));
    assert.deepEqual(syms.get('Ext')?.modifiers, ['public', 'static']);
    assert.deepEqual(syms.get('Ext.F')?.modifiers, ['internal', 'static']);
  });

  test('a type nested in a type is named the way C# refers to it', () => {
    const syms = flatten(symbolsOf(csharpPlugin, 'class Outer { class Inner { void F() { } } }'));
    assert.ok(syms.has('Outer.Inner'));
    assert.ok(syms.has('Outer.Inner.F'));
  });
});

describe('C# imports', () => {
  test('an alias records the namespace, not the alias, as the source', () => {
    const [imp] = importsOf(csharpPlugin, 'using Alias = Acme.Billing.Helpers;');
    // The alias identifier comes FIRST in the node, so "the first
    // identifier" would store `Alias` as the import source and the edge
    // would point nowhere.
    assert.equal(imp.source, 'Acme.Billing.Helpers');
    assert.deepEqual(imp.specifiers, ['Alias']);
    assert.equal(imp.isNamespace, false);
  });

  test('plain, global and static usings all record the namespace', () => {
    const imports = importsOf(csharpPlugin, `
using System;
using System.Collections.Generic;
global using System.Text;
using static Acme.MathHelpers;
`);
    assert.deepEqual(imports.map((i) => i.source), [
      'System', 'System.Collections.Generic', 'System.Text', 'Acme.MathHelpers',
    ]);
    assert.ok(imports.every((i) => i.isNamespace));
  });
});

// ============================================================
// Kotlin
// ============================================================

describe('Kotlin grammar', () => {
  test('the committed wasm loads and parses valid Kotlin', () => {
    const root = rootOf(kotlinPlugin, 'package a.b\n\nclass Foo {\n    fun bar() {}\n}\n');
    assert.equal(root.type, 'source_file');
    assert.equal(root.hasError, false);
  });
});

describe('Kotlin symbols', () => {
  test('interface, class and enum are told apart', () => {
    // All three are `class_declaration`, and the keyword that
    // distinguishes them is an anonymous token.
    const syms = flatten(symbolsOf(kotlinPlugin, `
interface Poster

class Plain

enum class Status { OPEN, CLOSED }

annotation class Marker
`));
    assert.equal(syms.get('Poster')?.kind, 'interface');
    assert.equal(syms.get('Plain')?.kind, 'class');
    assert.equal(syms.get('Status')?.kind, 'enum');
    assert.equal(syms.get('Marker')?.kind, 'class');
    assert.ok(syms.has('Status.OPEN'));
  });

  test('extension functions carry their receiver', () => {
    const syms = flatten(symbolsOf(kotlinPlugin, 'fun Double.twice(): Double = this * 2\n'));
    assert.ok(syms.has('Double.twice'), `got ${[...syms.keys()]}`);
    assert.ok(syms.get('Double.twice')?.modifiers.includes('extension'));
  });

  test('constructor val/var parameters are properties; plain ones are not', () => {
    const syms = flatten(symbolsOf(kotlinPlugin, 'class Money(val amount: Double, currency: String)\n'));
    assert.ok(syms.has('Money.amount'));
    assert.ok(!syms.has('Money.currency'), 'a plain constructor parameter is not a property');
  });

  test('an unnamed companion is named the way Kotlin names it', () => {
    const syms = flatten(symbolsOf(kotlinPlugin, `
class Holder {
    companion object {
        fun seed() {}
    }
}
`));
    assert.ok(syms.has('Holder.Companion'));
    assert.ok(syms.has('Holder.Companion.seed'));
  });

  test('a property name is the identifier, not the type annotation', () => {
    const syms = flatten(symbolsOf(kotlinPlugin, 'const val RATE: Double = 0.2\n'));
    assert.ok(syms.has('RATE'), `got ${[...syms.keys()]}`);
    assert.ok(syms.get('RATE')?.modifiers.includes('const'));
  });

  test('objects and typealiases are symbols', () => {
    const syms = flatten(symbolsOf(kotlinPlugin, `
object Registry {
    fun lookup(id: String) {}
}

typealias Cents = Int
`));
    assert.ok(syms.get('Registry')?.modifiers.includes('object'));
    assert.ok(syms.has('Registry.lookup'));
    assert.equal(syms.get('Cents')?.kind, 'type');
  });
});

describe('Kotlin imports', () => {
  test('a wildcard import is the package, not a type called by its last segment', () => {
    const [imp] = importsOf(kotlinPlugin, 'import com.acme.ledger.*\n');
    // The star is anonymous and the qualified_identifier reads
    // `com.acme.ledger` either way, so reading children alone would
    // record an import of a type named `ledger`.
    assert.equal(imp.source, 'com.acme.ledger');
    assert.deepEqual(imp.specifiers, ['*']);
    assert.equal(imp.isNamespace, true);
  });

  test('an aliased import keeps both the source and the local name', () => {
    const [imp] = importsOf(kotlinPlugin, 'import kotlinx.coroutines.flow.Flow as KFlow\n');
    assert.equal(imp.source, 'kotlinx.coroutines.flow.Flow');
    assert.deepEqual(imp.specifiers, ['KFlow']);
    assert.equal(imp.isNamespace, false);
  });
});

// ============================================================
// Swift
// ============================================================

describe('Swift grammar', () => {
  test('the committed wasm loads and parses valid Swift', () => {
    const root = rootOf(swiftPlugin, 'import Foundation\n\nstruct A { let x: Int }\n');
    assert.equal(root.type, 'source_file');
    assert.equal(root.hasError, false);
  });
});

describe('Swift symbols', () => {
  test('struct, enum, protocol and extension are told apart', () => {
    const syms = flatten(symbolsOf(swiftPlugin, `
protocol Poster { func post(amount: Double) }

struct Money { let amount: Double }

enum Status: String { case open, closed }

final class Invoice { }

extension Invoice { func describe() -> String { "x" } }
`));
    assert.equal(syms.get('Poster')?.kind, 'interface');
    assert.equal(syms.get('Status')?.kind, 'enum');
    assert.ok(syms.get('Money')?.modifiers.includes('struct'));
    assert.equal(syms.get('Invoice')?.kind, 'class');
    // Both `case open` and `case closed` come from one enum_entry node.
    assert.ok(syms.has('Status.open'));
    assert.ok(syms.has('Status.closed'));
  });

  test('an extension does not overwrite the type it extends', () => {
    const symbols = symbolsOf(swiftPlugin, `
final class Invoice {
    func post() { }
}

extension Invoice {
    func describe() -> String { "x" }
}
`);
    const types = symbols.filter((s) => s.kind === 'class').map((s) => s.name);
    // Two different places in (usually) two different files. If they
    // collapsed to one name, "go to Invoice" would land on whichever
    // the map happened to keep.
    assert.deepEqual(types, ['Invoice', 'Invoice (extension)']);
    // Members of the extension still belong to the type a reader means.
    const names = new Set(symbols.map((s) => s.name));
    assert.ok(names.has('Invoice.post'));
    assert.ok(names.has('Invoice.describe'));
  });

  test('a property name is the identifier, not the pattern text', () => {
    const syms = flatten(symbolsOf(swiftPlugin, 'class C { private var total: Double = 0 }'));
    assert.ok(syms.has('C.total'), `got ${[...syms.keys()]}`);
    assert.ok(!syms.has('C.total: Double'));
  });

  test('init, deinit and subscript are members', () => {
    const syms = flatten(symbolsOf(swiftPlugin, `
class C {
    init(seed: Double) { }
    deinit { }
    subscript(i: Int) -> Int { 0 }
}
`));
    assert.ok(syms.has('C.init'));
    assert.ok(syms.has('C.deinit'));
    assert.ok(syms.has('C.subscript'));
  });
});

describe('Swift imports', () => {
  test('a submodule import records the module, not the declaration', () => {
    const [imp] = importsOf(swiftPlugin, 'import struct BillingCore.Money\n');
    // The edge goes to the module; `Money` is what was taken from it.
    assert.equal(imp.source, 'BillingCore');
    assert.deepEqual(imp.specifiers, ['Money']);
    assert.equal(imp.isNamespace, false);
  });

  test('@testable import still records the module', () => {
    const imports = importsOf(swiftPlugin, '@testable import BillingCore\n');
    assert.deepEqual(imports.map((i) => i.source), ['BillingCore']);
  });
});

// ============================================================
// Java — changed by this phase, and previously untested
// ============================================================

describe('Java symbols', () => {
  test('members are qualified and flat', () => {
    // Java's members used to be bare (`post`, `run`) and nested, so they
    // collided in search and were invisible in every per-file view. This
    // suite exists because that change had no test to break.
    const symbols = javaPlugin.extractSymbols(rootOf(javaPlugin, `
package com.acme.billing;

public class Invoice {
    public Invoice(int seed) { }
    public void post(int amount) { }
}

interface Poster {
    void post(int amount);
}
`));
    const names = new Set(symbols.map((s) => s.name));

    assert.ok(names.has('Invoice.post'));
    assert.ok(names.has('Poster.post'));
    assert.ok(!names.has('post'), 'the unqualified form must not leak');
    assert.ok(names.has('Invoice.Invoice'));

    for (const sym of symbols) {
      assert.deepEqual(sym.children, [], `${sym.name} still carries children`);
    }
  });

  test('imports still resolve to the dotted path, wildcards included', () => {
    const imports = javaPlugin.extractImports(rootOf(javaPlugin, `
import com.acme.billing.Ledger;
import static com.acme.billing.Math.abs;
import com.acme.billing.*;
`));
    assert.deepEqual(imports.map((i) => i.source), [
      'com.acme.billing.Ledger', 'com.acme.billing.Math.abs', 'com.acme.billing',
    ]);
    assert.equal(imports[2].isNamespace, true);
  });
});

// ============================================================
// The registry guard
// ============================================================

describe('registry', () => {
  test('every language the scanner tags has a parser behind it', () => {
    // The same assertion `ruby.test.ts` makes, re-made here because
    // this change adds three languages to the scanner's LANG_MAP and
    // three plugins, and nothing in the build connects the two.
    assert.deepEqual(findUnparsedLanguages(listTaggedLanguages()), []);
  });

  test('every plugin emits a flat symbol list', () => {
    // `parent_symbol_id` is written by `insertSymbol` and then filtered
    // out by `getFileSymbols`, both per-file symbol counts and the MCP
    // plan-item lookup. A nested member is findable by search, missing
    // from its own file and uncounted — half-present, silently. The
    // contract is flat qualified names; this is what enforces it.
    const sources: Record<string, string> = {
      csharp: 'class Outer { void F() { } class Inner { void G() { } } }',
      kotlin: 'class Outer {\n    fun f() {}\n}\n',
      swift: 'class Outer {\n    func f() { }\n}\n',
      java: 'class Outer { void f() { } }',
    };
    for (const plugin of [csharpPlugin, kotlinPlugin, swiftPlugin, javaPlugin]) {
      const symbols = plugin.extractSymbols(rootOf(plugin, sources[plugin.language]));
      assert.ok(symbols.length > 1, `${plugin.language} produced ${symbols.length} symbols`);
      for (const sym of symbols) {
        assert.deepEqual(sym.children, [], `${plugin.language}: ${sym.name} still carries children`);
      }
    }
  });

  test('each new plugin owns its extensions exactly once', () => {
    const owners = new Map<string, string[]>();
    for (const plugin of PARSER_PLUGINS) {
      for (const ext of plugin.extensions) {
        owners.set(ext, [...(owners.get(ext) ?? []), plugin.language]);
      }
    }
    for (const ext of ['.cs', '.kt', '.kts', '.swift']) {
      assert.equal(owners.get(ext)?.length, 1, `${ext} is claimed by ${owners.get(ext)}`);
    }
  });
});
