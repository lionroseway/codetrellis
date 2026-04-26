import type { ParserPlugin, SyntaxNode } from './base';
import type { ParsedSymbol, ImportDeclaration } from '../../../shared/types';

/**
 * PHP parser plugin.
 *
 * Tree-sitter-php nodes:
 *   - function_definition / method_declaration
 *   - class_declaration / interface_declaration / trait_declaration / enum_declaration
 *   - namespace_use_declaration ← `use App\Auth\User;` or `use App\{Auth, User};`
 */

function nameOf(node: SyntaxNode): string {
  return node.childForFieldName('name')?.text || 'anonymous';
}

function lineOf(node: SyntaxNode): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function nodeToSymbol(node: SyntaxNode): ParsedSymbol | null {
  switch (node.type) {
    case 'function_definition':
      return { name: nameOf(node), kind: 'function', ...lineOf(node), children: [], modifiers: [] };
    case 'class_declaration': {
      const body = node.childForFieldName('body');
      const children = body ? extractClassMembers(body) : [];
      return { name: nameOf(node), kind: 'class', ...lineOf(node), children, modifiers: [] };
    }
    case 'interface_declaration':
      return { name: nameOf(node), kind: 'interface', ...lineOf(node), children: [], modifiers: [] };
    case 'trait_declaration':
      return { name: nameOf(node), kind: 'class', ...lineOf(node), children: [], modifiers: ['trait'] };
    case 'enum_declaration':
      return { name: nameOf(node), kind: 'enum', ...lineOf(node), children: [], modifiers: [] };
    default:
      return null;
  }
}

function extractClassMembers(body: SyntaxNode): ParsedSymbol[] {
  const out: ParsedSymbol[] = [];
  for (const child of body.children) {
    if (child.type === 'method_declaration') {
      out.push({ name: nameOf(child), kind: 'method', ...lineOf(child), children: [], modifiers: [] });
    }
  }
  return out;
}

function extractSymbols(node: SyntaxNode): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  for (const child of node.children) {
    if (child.type === 'namespace_definition') {
      // `namespace App\Foo { ... }` — recurse into the body
      const body = child.childForFieldName('body');
      if (body) symbols.push(...extractSymbols(body));
      continue;
    }
    const sym = nodeToSymbol(child);
    if (sym) symbols.push(sym);
  }
  return symbols;
}

function extractImports(node: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];
  const collect = (n: SyntaxNode) => {
    for (const child of n.children) {
      if (child.type === 'namespace_use_declaration') {
        // Inner use_clauses each name a fully-qualified name + optional alias
        const clauses = child.children.filter((c: SyntaxNode) => c.type === 'namespace_use_clause' || c.type === 'namespace_use_group_clause');
        for (const clause of clauses) {
          const text = clause.text.trim();
          // strip trailing alias `Foo as Bar`
          const [pathPart, ...rest] = text.split(/\s+as\s+/i);
          const alias = rest.join(' as ').trim();
          imports.push({
            source: pathPart.trim().replace(/^\\/, ''),
            specifiers: alias ? [alias] : [pathPart.trim().split('\\').pop() || pathPart.trim()],
            isDefault: false,
            isNamespace: false,
          });
        }
      } else if (child.type === 'namespace_definition') {
        const body = child.childForFieldName('body');
        if (body) collect(body);
      }
    }
  };
  collect(node);
  return imports;
}

export const phpPlugin: ParserPlugin = {
  language: 'php',
  extensions: ['.php'],
  grammarFile: 'tree-sitter-php.wasm',
  grammarKey: 'php',
  extractSymbols,
  extractImports,
};
