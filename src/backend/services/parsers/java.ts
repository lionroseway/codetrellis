import type { ParserPlugin, SyntaxNode } from './base';
import { flattenSymbols } from './base';
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

/**
 * Members are qualified `Type.member` — Phase 27.
 *
 * They used to be bare (`post`, `run`, `close`), which collided across
 * every class in a project the moment two of them shared a method name,
 * and they were nested, which meant no reader ever saw them: every
 * per-file query filters on `parent_symbol_id IS NULL`. Java methods
 * were absent from the inspector's file list and from every per-file
 * symbol count while being findable in search — half-present, in the
 * way nothing reported. See `flattenSymbols`.
 */
function extractMembers(body: SyntaxNode | null, owner: string): ParsedSymbol[] {
  if (!body) return [];
  const out: ParsedSymbol[] = [];
  for (const child of body.children) {
    if (child.type === 'method_declaration' || child.type === 'constructor_declaration') {
      out.push({
        name: `${owner}.${nameOf(child)}`,
        kind: 'method',
        ...lineOf(child),
        children: [],
        modifiers: child.type === 'constructor_declaration' ? ['constructor'] : [],
      });
    }
  }
  return out;
}

function nodeToSymbol(node: SyntaxNode): ParsedSymbol | null {
  const name = nameOf(node);
  switch (node.type) {
    case 'class_declaration':
      return { name, kind: 'class', ...lineOf(node), children: extractMembers(node.childForFieldName('body'), name), modifiers: [] };
    case 'interface_declaration':
      return { name, kind: 'interface', ...lineOf(node), children: extractMembers(node.childForFieldName('body'), name), modifiers: [] };
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
  // Flat, qualified names — see `flattenSymbols`.
  return flattenSymbols(symbols);
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
