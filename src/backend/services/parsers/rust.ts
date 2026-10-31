import { headerSignature, type ParserPlugin, type SyntaxNode } from './base';
import type { ParsedSymbol, ImportDeclaration } from '../../../shared/types';

/**
 * Rust parser plugin.
 *
 * Tree-sitter-rust nodes:
 *   - function_item, struct_item, enum_item, trait_item, impl_item, mod_item, type_item
 *   - use_declaration ← `use crate::foo::Bar;`
 *   - extern_crate_declaration ← `extern crate foo;`
 */

function nameOf(node: SyntaxNode): string {
  return node.childForFieldName('name')?.text || 'anonymous';
}

function lineOf(node: SyntaxNode): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** `pub`, `pub(crate)`: visible outside its module (A2.7). */
const pub = (node: SyntaxNode) => (node.children.some((c: SyntaxNode) => c.type === 'visibility_modifier') ? ['pub'] : []);

/** Only a symbol that has a signature carries the key (A2.7). */
const sig = (node: SyntaxNode, skip: string[] = []) => { const signature = headerSignature(node, skip); return signature ? { signature } : {}; };

function nodeToSymbol(node: SyntaxNode): ParsedSymbol | null {
  switch (node.type) {
    case 'function_item':
      return { name: nameOf(node), kind: 'function', ...lineOf(node), children: [], modifiers: pub(node), ...sig(node) };
    case 'struct_item':
      return { name: nameOf(node), kind: 'class', ...lineOf(node), children: [], modifiers: ['struct', ...pub(node)] };
    case 'enum_item':
      return { name: nameOf(node), kind: 'enum', ...lineOf(node), children: [], modifiers: pub(node) };
    case 'trait_item':
      return { name: nameOf(node), kind: 'interface', ...lineOf(node), children: [], modifiers: ['trait', ...pub(node)] };
    case 'impl_item': {
      const typeNode = node.childForFieldName('type');
      const name = typeNode ? typeNode.text : 'impl';
      return { name: `impl ${name}`, kind: 'class', ...lineOf(node), children: [], modifiers: ['impl'] };
    }
    case 'mod_item':
      return { name: nameOf(node), kind: 'class', ...lineOf(node), children: [], modifiers: ['mod'] };
    case 'type_item':
      return { name: nameOf(node), kind: 'type', ...lineOf(node), children: [], modifiers: pub(node) };
    default:
      return null;
  }
}

function extractSymbols(node: SyntaxNode): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  for (const child of node.children) {
    const sym = nodeToSymbol(child);
    if (sym) symbols.push(sym);
  }
  return symbols;
}

/**
 * What a use declaration's argument names, without its alias: `a::b as c` is
 * `a::b`, `a::{b, c}` is `a`, and `{a::b, c}` is both. The argument, and not
 * the declaration's text, so `pub use a::b` is not a crate called `pub use a`.
 */
function usePaths(node: SyntaxNode): string[] {
  switch (node.type) {
    case 'use_as_clause':
      return [node.childForFieldName('path')?.text ?? ''];
    case 'scoped_use_list': {
      const path = node.childForFieldName('path');
      const list = node.childForFieldName('list');
      return path ? [path.text] : list ? usePaths(list) : [];
    }
    case 'use_list':
      return node.namedChildren.filter((c: SyntaxNode) => !c.type.endsWith('comment')).flatMap(usePaths);
    default:
      return [node.text];
  }
}

/** Holds no declaration the grammar can see (a macro's body is tokens), or is what makes a generated table large. */
const NO_USE_INSIDE = new Set(['macro_invocation', 'macro_definition', 'array_expression']);

/**
 * Every use and extern crate declaration in the file, in source order, at any
 * depth: inside a `fn`, a `mod tests { }`, an `impl`. Reading only the top level
 * left a package rule silently under-reporting. A block is an expression in
 * Rust, and `use` may open any block, so unlike Python this walk has to enter
 * expressions: it stays out only of what is listed above. An explicit stack,
 * because expressions can nest deeper than the call stack.
 */
function useNodes(root: SyntaxNode): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'use_declaration' || node.type === 'extern_crate_declaration') {
      found.push(node);
    } else if (!NO_USE_INSIDE.has(node.type)) {
      const children = node.children;
      for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
    }
  }
  return found;
}

function extractImports(root: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];
  for (const node of useNodes(root)) {
    const argument = node.childForFieldName('argument');
    const paths = node.type === 'extern_crate_declaration'
      ? [node.childForFieldName('name')?.text ?? '']
      : argument ? usePaths(argument) : [];
    for (const path of paths) {
      if (!path) continue;
      imports.push({
        source: path,
        specifiers: [path.split('::').pop() || path],
        isDefault: false,
        isNamespace: false,
      });
    }
  }
  return imports;
}

export const rustPlugin: ParserPlugin = {
  language: 'rust',
  extensions: ['.rs'],
  grammarFile: 'tree-sitter-rust.wasm',
  grammarKey: 'rust',
  extractSymbols,
  extractImports,
};
