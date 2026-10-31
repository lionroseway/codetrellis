/**
 * Unit tests for the Python parser plugin's imports.
 *
 * Python imports wherever it likes, and only reading the top level left a
 * package rule silently under-reporting: `pypi:langchain_ollama` recorded 30
 * breaches where 57 files imported it, the other 27 inside a function or a
 * `try:`. Needs a real tree, so the grammar is loaded directly, as go.test.ts
 * does.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pythonPlugin } from './python';

const require_ = createRequire(import.meta.url);
const WTS_ENTRY = require_.resolve('web-tree-sitter');
const WTS_DIR = path.dirname(WTS_ENTRY);
const GRAMMAR = path.resolve(import.meta.dirname, '../../../../resources/tree-sitter/tree-sitter-python.wasm');

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

const importsOf = (src: string) => pythonPlugin.extractImports(parse(src));
const sourcesOf = (src: string) => importsOf(src).map((i) => i.source);

describe('Python imports, at any depth', () => {
  test('the top level, as it always was', () => {
    assert.deepEqual(importsOf('import os.path\nimport numpy as np\nfrom a.b import c, d as e\nfrom . import sibling\nfrom ..pkg import y\nfrom m import *\n'), [
      { source: 'os.path', specifiers: ['path'], isDefault: false, isNamespace: true },
      { source: 'numpy', specifiers: ['np'], isDefault: false, isNamespace: true },
      { source: 'a.b', specifiers: ['c', 'd'], isDefault: false, isNamespace: false },
      { source: '.', specifiers: ['sibling'], isDefault: false, isNamespace: false },
      { source: '..pkg', specifiers: ['y'], isDefault: false, isNamespace: false },
      { source: 'm', specifiers: ['*'], isDefault: false, isNamespace: true },
    ]);
  });

  test('in a function, a method, a nested function and a decorated one', () => {
    assert.deepEqual(sourcesOf([
      'def f():',
      '    from in_function import g',
      'async def h():',
      '    import in_async',
      'class C:',
      '    import in_class_body',
      '    def m(self):',
      '        import in_method',
      '        def inner():',
      '            import in_nested',
      '@decorator',
      'def d():',
      '    import in_decorated',
      '',
    ].join('\n')), ['in_function', 'in_async', 'in_class_body', 'in_method', 'in_nested', 'in_decorated']);
  });

  test('in each arm of a try', () => {
    assert.deepEqual(sourcesOf([
      'try:',
      '    import in_try',
      'except ImportError:',
      '    import in_except',
      'else:',
      '    import in_else',
      'finally:',
      '    import in_finally',
      '',
    ].join('\n')), ['in_try', 'in_except', 'in_else', 'in_finally']);
  });

  test('under if TYPE_CHECKING, and in each arm of an if', () => {
    assert.deepEqual(sourcesOf([
      'from typing import TYPE_CHECKING',
      'if TYPE_CHECKING:',
      '    from in_type_checking import T',
      'elif OTHER:',
      '    import in_elif',
      'else:',
      '    import in_else',
      '',
    ].join('\n')), ['typing', 'in_type_checking', 'in_elif', 'in_else']);
  });

  test('in a loop, a with and a match', () => {
    assert.deepEqual(sourcesOf([
      'for x in y:',
      '    import in_for',
      'while x:',
      '    import in_while',
      'with x:',
      '    import in_with',
      'match x:',
      '    case 1:',
      '        import in_case',
      '',
    ].join('\n')), ['in_for', 'in_while', 'in_with', 'in_case']);
  });

  test('on one line, and several to a line', () => {
    assert.deepEqual(sourcesOf('if x: import one_line\nimport a; import b\ndef f(): import c; import d\n'), ['one_line', 'a', 'b', 'c', 'd']);
  });

  test('in source order, however deep, with the same module named again as its own import', () => {
    assert.deepEqual(sourcesOf('import first\ndef f():\n    import second\nimport third\ndef g():\n    import first\n'), ['first', 'second', 'third', 'first']);
  });

  test('a file that does not parse keeps what can be read of it', () => {
    assert.ok(sourcesOf('def f(:\n    import after_a_syntax_error\nimport top\n').includes('top'));
  });

  test('words that only look like imports are not', () => {
    assert.deepEqual(sourcesOf('"""\nimport in_docstring\n"""\n# import in_comment\ns = "import in_string"\nfrom __future__ import annotations\n'), []);
  });

  test('an expression nested past the call stack does not stop the parse', () => {
    // Wider than any stack frame budget: a walk into expressions recursing here would throw.
    const deep = `x = ${'['.repeat(3000)}${']'.repeat(3000)}\nreturn_value = ${Array.from({ length: 20000 }, () => '1').join(' + ')}\ndef f():\n    import after_the_data\n`;
    assert.deepEqual(sourcesOf(deep), ['after_the_data']);
  });
});
