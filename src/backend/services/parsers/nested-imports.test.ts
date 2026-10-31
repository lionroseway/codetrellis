/**
 * Unit tests for where each parser plugin looks for an import.
 *
 * A package rule (and an imports or a symbol rule) reads what these return, so
 * an import a plugin does not reach is a breach nobody is told about. Python's
 * were the first found: 30 recorded where 57 files imported the package. This
 * holds the rest, including the languages that need no walk at all, because the
 * grammar refusing a nested import is what makes reading only the top enough.
 * Needs real trees, so the grammars are loaded directly, as go.test.ts does.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ParserPlugin } from './base';
import { rustPlugin } from './rust';
import { csharpPlugin } from './csharp';
import { typescriptPlugin, tsxPlugin, javascriptPlugin } from './typescript';
import { goPlugin } from './go';
import { javaPlugin } from './java';
import { kotlinPlugin } from './kotlin';
import { swiftPlugin } from './swift';
import { phpPlugin } from './php';
import { rubyPlugin } from './ruby';

const require_ = createRequire(import.meta.url);
const WTS_ENTRY = require_.resolve('web-tree-sitter');
const WTS_DIR = path.dirname(WTS_ENTRY);
const GRAMMARS = path.resolve(import.meta.dirname, '../../../../resources/tree-sitter');

const parsers = new Map<ParserPlugin, any>();
const plugins = [rustPlugin, csharpPlugin, typescriptPlugin, tsxPlugin, javascriptPlugin, goPlugin, javaPlugin, kotlinPlugin, swiftPlugin, phpPlugin, rubyPlugin];

before(async () => {
  const mod: any = require_(WTS_ENTRY);
  const Parser = mod.Parser ?? mod.default?.Parser ?? mod;
  const Language = mod.Language ?? Parser.Language;
  await Parser.init({ locateFile: () => path.join(WTS_DIR, 'web-tree-sitter.wasm') });
  for (const plugin of plugins) {
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(GRAMMARS, plugin.grammarFile)));
    parsers.set(plugin, parser);
  }
});

const importsOf = (plugin: ParserPlugin, src: string) => plugin.extractImports(parsers.get(plugin).parse(src).rootNode);
const sourcesOf = (plugin: ParserPlugin, src: string) => importsOf(plugin, src).map((i) => i.source);

describe('Rust', () => {
  const rust = (src: string) => sourcesOf(rustPlugin, src);

  test('the top level, as it always was', () => {
    assert.deepEqual(importsOf(rustPlugin, 'use serde::Deserialize;\nuse tokio::{fs, io};\nuse foo::*;\n'), [
      { source: 'serde::Deserialize', specifiers: ['Deserialize'], isDefault: false, isNamespace: false },
      { source: 'tokio', specifiers: ['tokio'], isDefault: false, isNamespace: false },
      { source: 'foo::*', specifiers: ['*'], isDefault: false, isNamespace: false },
    ]);
  });

  test('in a function, a test module however deep, an impl and a trait', () => {
    assert.deepEqual(rust([
      'fn f() { use in_fn::X; }',
      '#[cfg(test)]',
      'mod tests {',
      '    use super::*;',
      '    use in_mod::mock;',
      '    mod deeper { use in_deeper::Y; }',
      '}',
      'impl T { fn m(&self) { use in_method::Z; } }',
      'trait R { fn d() { use in_trait::W; } }',
    ].join('\n')), ['in_fn::X', 'super::*', 'in_mod::mock', 'in_deeper::Y', 'in_method::Z', 'in_trait::W']);
  });

  test('in any block, because a block is an expression and `use` may open one', () => {
    assert.deepEqual(rust(`fn f() {
      if a { use in_if::A; }
      let x = { use in_let::B; 1 };
      let c = |y| { use in_closure::C; y };
      g(|| { use in_argument::D; });
      match z { _ => { use in_match::E; } }
    }`), ['in_if::A', 'in_let::B', 'in_closure::C', 'in_argument::D', 'in_match::E']);
  });

  test('a visibility is not part of the path: `pub use a` is crate a, not crate `pub use a`', () => {
    assert.deepEqual(rust('pub use a::X;\npub(crate) use b::Y;\nmod m { pub use c::Z; }\n'), ['a::X', 'b::Y', 'c::Z']);
  });

  test('an alias is not part of the path, and the name kept is the original', () => {
    assert.deepEqual(importsOf(rustPlugin, 'use a::b as c;\nuse d as e;\n').map((i) => [i.source, i.specifiers]), [['a::b', ['b']], ['d', ['d']]]);
  });

  test('a list with no path before it names each of its crates', () => {
    assert.deepEqual(rust('use {a::x, b::{y, z}, c as d /* note */, ::e::w};\n'), ['a::x', 'b', 'c', '::e::w']);
  });

  test('extern crate imports a crate, wherever it is', () => {
    assert.deepEqual(rust('extern crate a;\nextern crate b as c;\nmod m { extern crate d; }\n'), ['a', 'b', 'd']);
  });

  test('deliberately not read: a macro body, which the grammar holds as tokens, and comments and strings', () => {
    assert.deepEqual(rust([
      'cfg_if::cfg_if! { if #[cfg(unix)] { use in_macro::M; } }',
      'macro_rules! m { () => { use in_rules::R; } }',
      '// use in_comment::C;',
      'const S: &str = "use in_string::S;";',
    ].join('\n')), []);
  });

  test('nesting deeper than the call stack does not throw, and what follows it is still found', () => {
    const deep = `fn f() { let x = ${'('.repeat(20_000)}1${')'.repeat(20_000)}; use after_deep::A; }\n`;
    assert.deepEqual(rust(deep), ['after_deep::A']);
  });
});

describe('C#', () => {
  const csharp = (src: string) => sourcesOf(csharpPlugin, src);

  test('the top level and its forms, as they always were', () => {
    assert.deepEqual(importsOf(csharpPlugin, 'using System.Text;\nusing A = Acme.Helpers;\nglobal using G.H;\nusing static Acme.Math;\n').map((i) => [i.source, i.specifiers, i.isNamespace]), [
      ['System.Text', ['Text'], true],
      ['Acme.Helpers', ['A'], false],
      ['G.H', ['H'], true],
      ['Acme.Math', ['Math'], true],
    ]);
  });

  test('in a namespace, however nested, in source order', () => {
    assert.deepEqual(csharp('using Top;\nnamespace X { using InNs; using A = InNs2.Sub; namespace Y { using InNested; class C {} } using After; }\n'), ['Top', 'InNs', 'InNs2.Sub', 'InNested', 'After']);
  });

  test('after a file-scoped namespace', () => {
    assert.deepEqual(csharp('namespace X;\nusing InFileNs;\nclass C {}\n'), ['InFileNs']);
  });

  test('in every arm of an #if, at the top and in a namespace, and through a #region', () => {
    assert.deepEqual(csharp('#if NET6_0\nusing InIf;\n#elif NET5_0\nusing InElif;\n#else\nusing InElse;\n#endif\nclass C {}\n'), ['InIf', 'InElif', 'InElse']);
    assert.deepEqual(csharp('namespace X {\n#if DEBUG\nusing InIfNs;\n#endif\n}\n'), ['InIfNs']);
    assert.deepEqual(csharp('#region Usings\nusing InRegion;\n#endregion\nclass C {}\n'), ['InRegion']);
  });

  test('a using statement disposes something, and imports nothing', () => {
    assert.deepEqual(csharp('class C { void M() { using var s = Open(); using (var t = Open()) { } } }\n'), []);
  });
});

for (const [name, plugin] of [['TypeScript', typescriptPlugin], ['TSX', tsxPlugin], ['JavaScript', javascriptPlugin]] as const) {
  describe(`${name}: require and import() count`, () => {
    const sources = (src: string) => sourcesOf(plugin, src);
    const spec = (src: string) => importsOf(plugin, src).map((i) => [i.source, i.specifiers, i.isNamespace]);

    test('require, at the top and at any depth', () => {
      assert.deepEqual(sources(`
const a = require('top');
require('bare');
function f() { return require('in-function'); }
try { require('in-try'); } catch {}
class C { m() { if (x) { const b = require('in-method'); } } }
`), ['top', 'bare', 'in-function', 'in-try', 'in-method']);
    });

    test('import(), where it puts off a dependency: a function, a route table', () => {
      assert.deepEqual(sources(`
async function f() { await import('in-function'); }
const routes = [{ path: '/', component: () => import('in-route-table') }];
const lazy = React.lazy(() => import(/* webpackChunkName: "x" */ 'behind-a-comment'));
`), ['in-function', 'in-route-table', 'behind-a-comment']);
    });

    test('a template with nothing in it is a name; a computed name says nothing', () => {
      assert.deepEqual(sources('require(`plain`);\nimport(`plain-too`);\nrequire(`a${b}`);\nimport(`a${b}`);\nrequire(name);\nimport(name);\nrequire();\nrequire("a" + b);\n'), ['plain', 'plain-too']);
    });

    test('only require itself: not a method of something else, and not require.resolve, which only finds a file', () => {
      assert.deepEqual(sources("require.resolve('resolve');\nloader.require('member');\nrequired('other');\nimportant('other');\n"), []);
    });

    test('the names it takes, where it says, for a symbol rule to read', () => {
      assert.deepEqual(spec(`
const { a, b: c, d = 1 } = require('destructured');
const { e } = await import('destructured-import');
const f = require('member').g;
const h = (await import('member-import')).i;
const j = (await import('default-import')).default;
`), [
        ['destructured', ['a', 'b', 'd'], false],
        ['destructured-import', ['e'], false],
        ['member', ['g'], false],
        ['member-import', ['i'], false],
        ['default-import', ['default'], false],
      ]);
    });

    test('and any, where it does not', () => {
      assert.deepEqual(spec(`
const x = require('whole');
require('side-effect');
const { a, ...rest } = require('with-rest');
import('then').then((m) => m.a);
use(require('as-an-argument'));
const y = await import('awaited');
`).map(([source, specifiers, isNamespace]) => [source, specifiers, isNamespace]), [
        ['whole', ['*'], true],
        ['side-effect', ['*'], true],
        ['with-rest', ['*'], true],
        ['then', ['*'], true],
        ['as-an-argument', ['*'], true],
        ['awaited', ['*'], true],
      ]);
    });

    test('nesting deeper than the call stack does not throw, and what follows it is still found', () => {
      assert.deepEqual(sources(`x = ${'['.repeat(20_000)}${']'.repeat(20_000)};\nrequire('after-deep');\n`), ['after-deep']);
    });
  });
}

describe('TypeScript: what only it can say', () => {
  const ts = (src: string) => sourcesOf(typescriptPlugin, src);

  test('the import statements it always read keep their shape and come first', () => {
    assert.deepEqual(importsOf(typescriptPlugin, "const r = require('req');\nimport a, { b as c } from 'm';\nimport * as d from 'n';\nimport 'side';\nexport * from 'e';\n"), [
      { source: 'm', specifiers: ['a', 'b'], isDefault: true, isNamespace: false },
      { source: 'n', specifiers: ['d'], isDefault: false, isNamespace: true },
      { source: 'side', specifiers: [], isDefault: false, isNamespace: false },
      { source: 'e', specifiers: ['*'], isDefault: false, isNamespace: true, isReexport: true },
      { source: 'req', specifiers: ['*'], isDefault: false, isNamespace: true },
    ]);
  });

  test('import x = require(y) has a source: it was recorded as an empty one', () => {
    assert.deepEqual(importsOf(typescriptPlugin, "import f = require('eq');\n"), [
      { source: 'eq', specifiers: ['f'], isDefault: false, isNamespace: true },
    ]);
  });

  test('in an ambient module, an import and a re-export', () => {
    assert.deepEqual(ts("declare module 'm' { import { r } from 'in-ambient'; export * from 'in-ambient-too'; export const s: number; }\n"), ['in-ambient', 'in-ambient-too']);
  });

  test('an import type names the package, as `import type` does', () => {
    assert.deepEqual(importsOf(typescriptPlugin, "let x: typeof import('whole');\nlet y: import('one').Foo;\n").map((i) => [i.source, i.specifiers]), [['whole', ['*']], ['one', ['Foo']]]);
  });

  test('not read: export import x = require(y), which the grammar cannot parse', () => {
    assert.equal(parsers.get(typescriptPlugin).parse("export import g = require('x');\n").rootNode.hasError, true);
    assert.deepEqual(ts("export import g = require('x');\n"), []);
  });

  test('a namespace alias is not a module, and an as-cast does not hide what is taken', () => {
    assert.deepEqual(ts('namespace N { import q = M.N; }\n'), []);
    assert.deepEqual(importsOf(typescriptPlugin, "const { s } = require('cast') as { s: string };\n").map((i) => i.specifiers), [['s']]);
  });
});

describe('the languages that need no walk: a nested import does not compile', () => {
  const refuses = (plugin: ParserPlugin, src: string) => {
    const root = parsers.get(plugin).parse(src).rootNode;
    assert.equal(root.hasError, true, 'the grammar parsed a nested import as valid: this plugin now needs a walk');
    assert.deepEqual(plugin.extractImports(root).map((i) => i.source), []);
  };

  test('Go: a file-level declaration, however it is grouped', () => {
    assert.deepEqual(sourcesOf(goPlugin, 'package x\nimport "a"\nimport (\n  b "b"\n  . "c"\n)\n'), ['a', 'b', 'c']);
    refuses(goPlugin, 'package x\nfunc f() { import "in_fn" }\n');
  });

  test('Java: before any type', () => {
    assert.deepEqual(sourcesOf(javaPlugin, 'package x;\nimport a.B;\nimport static c.D.e;\nimport f.*;\nclass Z {}\n'), ['a.B', 'c.D.e', 'f']);
    refuses(javaPlugin, 'class Z { import in_class.Y; }\n');
    // The one grammar here looser than its language: it accepts an import in a
    // block, and gives it a node. JLS §7.3 allows one only in a compilation unit,
    // so javac refuses this file and no code a rule reads looks like it. Not
    // reading it is the decision this test holds.
    assert.equal(parsers.get(javaPlugin).parse('class Z { void m() { import in_method.Y; } }\n').rootNode.hasError, false);
    assert.deepEqual(sourcesOf(javaPlugin, 'class Z { void m() { import in_method.Y; } }\n'), []);
  });

  test('Kotlin: before any declaration, in a script too', () => {
    assert.deepEqual(sourcesOf(kotlinPlugin, '@file:JvmName("X")\npackage x\nimport a.B\nimport c.d as e\nimport f.*\nclass Z\n'), ['a.B', 'c.d', 'f']);
    assert.deepEqual(sourcesOf(kotlinPlugin, 'import a.B\nplugins { id("x") }\n'), ['a.B']);
    refuses(kotlinPlugin, 'class Z { import in_class.Y\n }\n');
    refuses(kotlinPlugin, 'fun m() { import in_fn.Y }\n');
  });

  test('Swift: file scope only, and #if does not hide one, though the grammar has no node for it', () => {
    assert.deepEqual(sourcesOf(swiftPlugin, 'import Foundation\nimport struct Foo.Bar\n@testable import Baz\n'), ['Foundation', 'Foo', 'Baz']);
    assert.deepEqual(sourcesOf(swiftPlugin, '#if canImport(UIKit)\nimport UIKit\n#elseif os(macOS)\nimport AppKit\n#else\nimport Other\n#endif\nclass C {}\n'), ['UIKit', 'AppKit', 'Other']);
    assert.deepEqual(sourcesOf(swiftPlugin, '#if os(iOS)\n#if DEBUG\nimport Nested\n#endif\n#endif\nimport After\n'), ['Nested', 'After']);
    refuses(swiftPlugin, 'func f() { import InFn }\n');
  });
});

describe('the languages that already walk deeper', () => {
  test('PHP: in a namespace block and after a namespace statement; a trait use is not an import, nor a closure use', () => {
    assert.deepEqual(sourcesOf(phpPlugin, '<?php\nuse Top\\A;\nnamespace X { use InBlock\\Y; }\n'), ['Top\\A', 'InBlock\\Y']);
    assert.deepEqual(sourcesOf(phpPlugin, '<?php\nnamespace X;\nuse InStatement\\Y;\n'), ['InStatement\\Y']);
    assert.deepEqual(sourcesOf(phpPlugin, '<?php\nclass K { use InTrait; }\nfunction f() { $c = function() use ($d) {}; }\n'), []);
  });

  const php = (src: string) => importsOf(phpPlugin, `<?php\n${src}\n`).map((i) => [i.source, i.specifiers]);

  test('PHP: a class, with or without a leading slash or an alias, and several in one use', () => {
    assert.deepEqual(php('use Single;\nuse \\Top\\Lead;\nuse A\\B as C;\nuse First\\X, Second\\Y as Z;'), [
      ['Single', ['Single']],
      ['Top\\Lead', ['Lead']],
      ['A\\B', ['B']], // the original name, as Python and TypeScript keep it: a symbol rule asks about B
      ['First\\X', ['X']],
      ['Second\\Y', ['Y']],
    ]);
  });

  test('PHP: use function and use const name the path, not the keyword', () => {
    assert.deepEqual(php('use function D\\e;\nuse const F\\G as H;\nuse function \\I\\j;'), [
      ['D\\e', ['e']],
      ['F\\G', ['G']],
      ['I\\j', ['j']],
    ]);
  });

  test('PHP: a group is one import per member, however it is written', () => {
    assert.deepEqual(php('use A\\{B, C as D};'), [['A\\B', ['B']], ['A\\C', ['C']]]);
    assert.deepEqual(php('use A\\B\\{C, D\\E};'), [['A\\B\\C', ['C']], ['A\\B\\D\\E', ['E']]]);
    assert.deepEqual(php('use function A\\{b, c};'), [['A\\b', ['b']], ['A\\c', ['c']]]);
    assert.deepEqual(php('use A\\{function b, const C, D\\E,};'), [['A\\b', ['b']], ['A\\C', ['C']], ['A\\D\\E', ['E']]]);
    assert.deepEqual(php('use A\\{ /* note */ B, // and\n C };'), [['A\\B', ['B']], ['A\\C', ['C']]]);
  });

  test('PHP: not read: a group with a leading slash, valid PHP that the grammar cannot parse', () => {
    assert.equal(parsers.get(phpPlugin).parse('<?php\nuse \\A\\B\\{C, D\\E};\n').rootNode.hasError, true);
    assert.deepEqual(php('use \\A\\B\\{C, D\\E};'), []);
  });

  test('PHP: a group in a namespace block', () => {
    assert.deepEqual(php('namespace X { use A\\{B, C}; use function D\\e; }'), [['A\\B', ['B']], ['A\\C', ['C']], ['D\\e', ['e']]]);
  });

  test('PHP: deliberately not read: require, which includes a file rather than importing a name', () => {
    assert.deepEqual(sourcesOf(phpPlugin, "<?php\nrequire_once 'vendor/autoload.php';\nfunction g() { require 'in_fn.php'; }\n"), []);
  });

  test('Ruby: in a method, a begin, an if and a class', () => {
    assert.deepEqual(sourcesOf(rubyPlugin, "require 'top'\ndef f\n  require 'in_def'\nend\nbegin\n  require 'in_begin'\nrescue LoadError\nend\nif x then require 'in_if' end\nclass C; require 'in_class'; end\n"), ['top', 'in_def', 'in_begin', 'in_if', 'in_class']);
  });
});
