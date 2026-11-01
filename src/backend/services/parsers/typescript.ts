import { shapeOf, signatureOf, type ParserPlugin, type SyntaxNode } from './base';
import type { ParsedSymbol, ImportDeclaration, ExportDeclaration } from '../../../shared/types';

/**
 * TypeScript / JavaScript / TSX / JSX parser plugins.
 *
 * The TS, TSX, and JS grammars produce slightly different ASTs but
 * share most node types we care about, so the same extractors are
 * registered for all three plugins under different grammar keys.
 */

function extractSymbols(node: SyntaxNode): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  for (const child of node.children) {
    const symbol = nodeToSymbol(child);
    if (symbol) symbols.push(symbol);
  }
  return symbols;
}

/**
 * A function's signature (A2.1): type parameters, parameters, return type.
 * An arrow function with one bare parameter (`x => …`) has it in the
 * `parameter` field instead.
 */
function callSignature(fn: SyntaxNode, declaredType?: SyntaxNode | null): string | undefined {
  const params = fn.childForFieldName('parameters') ?? fn.childForFieldName('parameter');
  return signatureOf(
    shapeOf(fn.childForFieldName('type_parameters')),
    params && params.type !== 'formal_parameters' ? `(${shapeOf(params)})` : shapeOf(params),
    shapeOf(fn.childForFieldName('return_type')),
    // `const f: Handler = (req) => …`: the declared type is part of its shape.
    declaredType ? shapeOf(declaredType) : null,
  );
}

/** Only a symbol that has a signature carries the key. */
const sig = (signature: string | undefined) => (signature ? { signature } : {});

function nodeToSymbol(node: SyntaxNode): ParsedSymbol | null {
  const modifiers = extractModifiers(node);

  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      return { name, kind: 'function', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers, ...sig(callSignature(node)) };
    }
    case 'class_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      const body = node.childForFieldName('body');
      const children = body ? extractClassMembers(body) : [];
      return { name, kind: 'class', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children, modifiers };
    }
    case 'interface_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      // Its shape is everything after the name: type parameters, what it
      // extends, and its members.
      const shape = signatureOf(shapeOf(node.childForFieldName('type_parameters')),
        ...node.children.filter((c: SyntaxNode) => c.type === 'extends_type_clause').map((c: SyntaxNode) => ` ${shapeOf(c)} `),
        shapeOf(node.childForFieldName('body')));
      return { name, kind: 'interface', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers, ...sig(shape) };
    }
    case 'type_alias_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      const shape = signatureOf(shapeOf(node.childForFieldName('type_parameters')), shapeOf(node.childForFieldName('value')));
      return { name, kind: 'type', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers, ...sig(shape) };
    }
    case 'enum_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      return { name, kind: 'enum', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers, ...sig(signatureOf(shapeOf(node.childForFieldName('body')))) };
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      const declarators = node.children.filter((c: SyntaxNode) => c.type === 'variable_declarator');
      for (const decl of declarators) {
        const name = decl.childForFieldName('name')?.text;
        const value = decl.childForFieldName('value');
        if (!name) continue;
        if (value && (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function')) {
          return { name, kind: 'function', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers, ...sig(callSignature(value, decl.childForFieldName('type'))) };
        }
      }
      return null;
    }
    case 'export_statement': {
      const declaration = node.childForFieldName('declaration') || node.children.find(
        (c: SyntaxNode) => c.type !== 'export' && c.type !== 'default' && c.type !== 'comment'
      );
      if (declaration) {
        const sym = nodeToSymbol(declaration);
        if (sym) {
          sym.modifiers = [...new Set([...sym.modifiers, 'export'])];
          return sym;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function extractClassMembers(body: SyntaxNode): ParsedSymbol[] {
  const members: ParsedSymbol[] = [];
  for (const child of body.children) {
    if (child.type === 'method_definition' || child.type === 'public_field_definition' || child.type === 'property_definition') {
      const name = child.childForFieldName('name')?.text || 'anonymous';
      const kind = child.type === 'method_definition' ? 'method' : 'variable';
      const modifiers = extractModifiers(child);
      // A method's call shape; a field's declared type.
      const signature = kind === 'method' ? callSignature(child) : signatureOf(shapeOf(child.childForFieldName('type')));
      members.push({
        name,
        kind: kind as ParsedSymbol['kind'],
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        children: [],
        modifiers,
        ...sig(signature),
      });
    }
  }
  return members;
}

function extractModifiers(node: SyntaxNode): string[] {
  const mods: string[] = [];
  if (node.parent?.type === 'export_statement') mods.push('export');
  for (const child of node.children) {
    if (child.type === 'async') mods.push('async');
    if (child.type === 'static') mods.push('static');
    if (child.type === 'readonly') mods.push('readonly');
    if (child.type === 'abstract') mods.push('abstract');
    if (child.type === 'accessibility_modifier') mods.push(child.text);
  }
  return mods;
}

/** The module a `require(…)` or `import(…)` call names, or null for any other call, or one whose name is computed. */
function loadedModule(call: SyntaxNode): string | null {
  const callee = call.childForFieldName('function');
  if (callee?.type !== 'import' && !(callee?.type === 'identifier' && callee.text === 'require')) return null;
  // Not the first named child alone: `import(/* webpackChunkName: "a" */ './a')`.
  const arg = call.childForFieldName('arguments')?.namedChildren.find((c: SyntaxNode) => c.type !== 'comment');
  if (arg?.type === 'string') return arg.text.slice(1, -1) || null;
  if (arg?.type === 'template_string' && !arg.namedChildren.some((c: SyntaxNode) => c.type === 'template_substitution')) return arg.text.slice(1, -1) || null;
  return null;
}

/** What wraps a loading call without changing what it evaluates to. */
const SAME_VALUE = new Set(['await_expression', 'parenthesized_expression', 'as_expression', 'satisfies_expression', 'non_null_expression']);

/**
 * The names taken from a loading call, as an import's specifiers would hold
 * them, or null when it may use any: `const { a, b: c } = require('x')` takes
 * `a` and `b`, `require('x').a` takes `a`, and `const x = require('x')` a
 * namespace. A symbol rule reads these, so guessing "any" for the first two
 * would say a file uses an export it never touches.
 */
function namesTaken(call: SyntaxNode): string[] | null {
  let outer = call;
  while (SAME_VALUE.has(outer.parent?.type)) outer = outer.parent;
  const parent = outer.parent;
  if (parent?.type === 'member_expression' && parent.childForFieldName('object')?.id === outer.id) {
    const name = parent.childForFieldName('property')?.text;
    return name && name !== 'then' ? [name] : null; // `import('x').then(m => …)` may use any
  }
  const pattern = parent?.type === 'variable_declarator' ? parent.childForFieldName('name') : null;
  if (pattern?.type !== 'object_pattern') return null;
  const names: string[] = [];
  for (const c of pattern.namedChildren) {
    if (c.type === 'shorthand_property_identifier_pattern') names.push(c.text);
    else if (c.type === 'pair_pattern') names.push(c.childForFieldName('key')?.text ?? '');
    else if (c.type === 'object_assignment_pattern') names.push(c.childForFieldName('left')?.text ?? '');
    else if (c.type !== 'comment') return null; // `...rest`
  }
  return names;
}

/**
 * Imports at any depth, and the two calls that are imports in all but syntax.
 *
 * `require('x')` and `import('x')` load a module as surely as `import` does:
 * `require` is how CommonJS says it, and `import()` is how a route or a heavy
 * dependency is put off, which is what a package rule most wants to see. So they
 * count, wherever they are, with a literal name; `require(name)` says nothing a
 * parser can read, and `require.resolve('x')` only finds a file. A type written
 * `import('x').T` counts too: the file still names the package, as `import type`
 * does. See "What counts as an import" in docs/claude/rules.md.
 *
 * These are expressions, so this cannot stay out of expressions as Python and
 * Rust do. The grammar's own walk, not a stack here: it is iterative too, and
 * on server.ts took 9 ms where a stack took 84 (the parse itself: 150).
 */
function extractImports(root: SyntaxNode): ImportDeclaration[] {
  const nodes: SyntaxNode[] = root.descendantsOfType(['import_statement', 'export_statement', 'call_expression']);
  const imports: ImportDeclaration[] = [];
  for (const child of nodes) {
    if (child.type !== 'import_statement') continue;
    // `import x = require('y')` keeps its source in the clause.
    const requireClause = child.children.find((c: SyntaxNode) => c.type === 'import_require_clause');
    const source = (child.childForFieldName('source') ?? requireClause?.childForFieldName('source'))?.text?.replace(/['"]/g, '') || '';
    const specifiers: string[] = [];
    let isDefault = false;
    let isNamespace = false;
    if (requireClause) {
      isNamespace = true;
      specifiers.push(requireClause.namedChildren.find((c: SyntaxNode) => c.type === 'identifier')?.text || '*');
    }
    for (const c of child.children) {
      if (c.type !== 'import_clause') continue;
      for (const cc of c.children) {
        if (cc.type === 'identifier') {
          isDefault = true;
          specifiers.push(cc.text);
        }
        if (cc.type === 'named_imports') {
          for (const spec of cc.children) {
            if (spec.type === 'import_specifier') {
              const name = spec.childForFieldName('name')?.text || spec.text;
              specifiers.push(name);
            }
          }
        }
        if (cc.type === 'namespace_import') {
          isNamespace = true;
          specifiers.push(cc.children.find((x: SyntaxNode) => x.type === 'identifier')?.text || '*');
        }
      }
    }
    imports.push({ source, specifiers, isDefault, isNamespace });
  }
  // `export … from` (A2.2): a dependency on the source that passes names on.
  // Without it a barrel (`index.ts` of `export * from './x'`) had no edges,
  // and nothing importing through it was known to import what it re-exports.
  for (const child of nodes) {
    if (child.type !== 'export_statement') continue;
    const sourceNode = child.childForFieldName('source');
    if (!sourceNode) continue;
    const source = sourceNode.text.replace(/['"]/g, '');
    const clause = child.children.find((c: SyntaxNode) => c.type === 'export_clause');
    const nsExport = child.children.find((c: SyntaxNode) => c.type === 'namespace_export');
    if (clause) {
      // `export { a, b as c } from`: the original names, as imports record them.
      const specifiers = clause.children
        .filter((c: SyntaxNode) => c.type === 'export_specifier')
        .map((c: SyntaxNode) => c.childForFieldName('name')?.text ?? c.text);
      imports.push({ source, specifiers, isDefault: false, isNamespace: false, isReexport: true });
    } else {
      // `export * from` / `export * as ns from`: everything it exports.
      const ns = nsExport?.children.find((c: SyntaxNode) => c.type === 'identifier')?.text;
      imports.push({ source, specifiers: [ns ?? '*'], isDefault: false, isNamespace: true, isReexport: true });
    }
  }
  for (const child of nodes) {
    if (child.type !== 'call_expression') continue;
    const source = loadedModule(child);
    if (!source) continue;
    const names = namesTaken(child);
    imports.push({ source, specifiers: names ?? ['*'], isDefault: false, isNamespace: !names });
  }
  return imports;
}

function extractExports(node: SyntaxNode): ExportDeclaration[] {
  const exports: ExportDeclaration[] = [];
  for (const child of node.children) {
    if (child.type !== 'export_statement') continue;
    const isDefault = child.children.some((c: SyntaxNode) => c.type === 'default');
    const declaration = child.childForFieldName('declaration') || child.children.find(
      (c: SyntaxNode) => c.type !== 'export' && c.type !== 'default' && c.type !== ';' && c.type !== 'comment'
    );
    if (declaration) {
      const sym = nodeToSymbol(declaration);
      if (sym) exports.push({ name: sym.name, kind: sym.kind, isDefault });
    }
  }
  return exports;
}

export const typescriptPlugin: ParserPlugin = {
  language: 'typescript',
  extensions: ['.ts'],
  grammarFile: 'tree-sitter-typescript.wasm',
  grammarKey: 'typescript',
  extractSymbols, extractImports, extractExports,
};

export const tsxPlugin: ParserPlugin = {
  language: 'typescript',
  extensions: ['.tsx'],
  grammarFile: 'tree-sitter-tsx.wasm',
  grammarKey: 'tsx',
  extractSymbols, extractImports, extractExports,
};

export const javascriptPlugin: ParserPlugin = {
  language: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  grammarFile: 'tree-sitter-javascript.wasm',
  grammarKey: 'javascript',
  extractSymbols, extractImports, extractExports,
};
