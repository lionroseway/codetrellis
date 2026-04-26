import type { ParserPlugin, SyntaxNode } from './base';
import type { ParsedSymbol, ImportDeclaration } from '../../../shared/types';

/**
 * Rust parser plugin.
 *
 * Tree-sitter-rust nodes:
 *   - function_item, struct_item, enum_item, trait_item, impl_item, mod_item, type_item
 *   - use_declaration ← `use crate::foo::Bar;`
 */

function nameOf(node: SyntaxNode): string {
  return node.childForFieldName('name')?.text || 'anonymous';
}

function lineOf(node: SyntaxNode): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function nodeToSymbol(node: SyntaxNode): ParsedSymbol | null {
  switch (node.type) {
    case 'function_item':
      return { name: nameOf(node), kind: 'function', ...lineOf(node), children: [], modifiers: [] };
    case 'struct_item':
      return { name: nameOf(node), kind: 'class', ...lineOf(node), children: [], modifiers: ['struct'] };
    case 'enum_item':
      return { name: nameOf(node), kind: 'enum', ...lineOf(node), children: [], modifiers: [] };
    case 'trait_item':
      return { name: nameOf(node), kind: 'interface', ...lineOf(node), children: [], modifiers: ['trait'] };
    case 'impl_item': {
      const typeNode = node.childForFieldName('type');
      const name = typeNode ? typeNode.text : 'impl';
      return { name: `impl ${name}`, kind: 'class', ...lineOf(node), children: [], modifiers: ['impl'] };
    }
    case 'mod_item':
      return { name: nameOf(node), kind: 'class', ...lineOf(node), children: [], modifiers: ['mod'] };
    case 'type_item':
      return { name: nameOf(node), kind: 'type', ...lineOf(node), children: [], modifiers: [] };
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

function readUsePath(node: SyntaxNode): string {
  // The body of a use_declaration is a use_clause / scoped_use_list /
  // scoped_identifier / use_as_clause / etc. We just stringify the
  // raw text up to the first '{' (group imports).
  const text = (node.text || '').trim().replace(/^use\s+/, '').replace(/;\s*$/, '');
  const braceIdx = text.indexOf('{');
  return braceIdx === -1 ? text : text.slice(0, braceIdx).replace(/::$/, '');
}

function extractImports(node: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];
  for (const child of node.children) {
    if (child.type !== 'use_declaration') continue;
    const path = readUsePath(child);
    if (!path) continue;
    imports.push({
      source: path,
      specifiers: [path.split('::').pop() || path],
      isDefault: false,
      isNamespace: false,
    });
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
