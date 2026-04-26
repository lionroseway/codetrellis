import type { ParserPlugin, SyntaxNode } from './base';
import type { ParsedSymbol, ImportDeclaration } from '../../../shared/types';

/**
 * Java parser plugin.
 *
 * Tree-sitter-java nodes:
 *   - class_declaration / interface_declaration / enum_declaration / record_declaration
 *   - method_declaration / constructor_declaration / field_declaration
 *   - import_declaration ← `import com.example.foo.Bar;`
 */

function nameOf(node: SyntaxNode): string {
  return node.childForFieldName('name')?.text || 'anonymous';
}

function lineOf(node: SyntaxNode): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function extractMembers(body: SyntaxNode | null): ParsedSymbol[] {
  if (!body) return [];
  const out: ParsedSymbol[] = [];
  for (const child of body.children) {
    if (child.type === 'method_declaration' || child.type === 'constructor_declaration') {
      out.push({ name: nameOf(child), kind: 'method', ...lineOf(child), children: [], modifiers: [] });
    }
  }
  return out;
}

function nodeToSymbol(node: SyntaxNode): ParsedSymbol | null {
  switch (node.type) {
    case 'class_declaration':
      return { name: nameOf(node), kind: 'class', ...lineOf(node), children: extractMembers(node.childForFieldName('body')), modifiers: [] };
    case 'interface_declaration':
      return { name: nameOf(node), kind: 'interface', ...lineOf(node), children: extractMembers(node.childForFieldName('body')), modifiers: [] };
    case 'enum_declaration':
      return { name: nameOf(node), kind: 'enum', ...lineOf(node), children: [], modifiers: [] };
    case 'record_declaration':
      return { name: nameOf(node), kind: 'class', ...lineOf(node), children: [], modifiers: ['record'] };
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

function extractImports(node: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];
  for (const child of node.children) {
    if (child.type !== 'import_declaration') continue;
    // `import com.example.foo.Bar;` — pull out the dotted path
    const text = (child.text || '').replace(/^import\s+(static\s+)?/, '').replace(/;\s*$/, '').trim();
    if (!text) continue;
    // strip trailing .* for wildcards
    const cleanPath = text.replace(/\.\*$/, '');
    const isWildcard = text.endsWith('.*');
    imports.push({
      source: cleanPath,
      specifiers: isWildcard ? ['*'] : [cleanPath.split('.').pop() || cleanPath],
      isDefault: false,
      isNamespace: isWildcard,
    });
  }
  return imports;
}

export const javaPlugin: ParserPlugin = {
  language: 'java',
  extensions: ['.java'],
  grammarFile: 'tree-sitter-java.wasm',
  grammarKey: 'java',
  extractSymbols,
  extractImports,
};
