import type { ParserPlugin, SyntaxNode } from './base';
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

function nodeToSymbol(node: SyntaxNode): ParsedSymbol | null {
  const modifiers = extractModifiers(node);

  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      return { name, kind: 'function', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers };
    }
    case 'class_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      const body = node.childForFieldName('body');
      const children = body ? extractClassMembers(body) : [];
      return { name, kind: 'class', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children, modifiers };
    }
    case 'interface_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      return { name, kind: 'interface', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers };
    }
    case 'type_alias_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      return { name, kind: 'type', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers };
    }
    case 'enum_declaration': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      return { name, kind: 'enum', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers };
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      const declarators = node.children.filter((c: SyntaxNode) => c.type === 'variable_declarator');
      for (const decl of declarators) {
        const name = decl.childForFieldName('name')?.text;
        const value = decl.childForFieldName('value');
        if (!name) continue;
        if (value && (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function')) {
          return { name, kind: 'function', startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, children: [], modifiers };
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
      members.push({
        name,
        kind: kind as ParsedSymbol['kind'],
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        children: [],
        modifiers,
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

function extractImports(node: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];
  for (const child of node.children) {
    if (child.type !== 'import_statement') continue;
    const source = child.childForFieldName('source')?.text?.replace(/['"]/g, '') || '';
    const specifiers: string[] = [];
    let isDefault = false;
    let isNamespace = false;
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
