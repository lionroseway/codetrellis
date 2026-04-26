import type { ParserPlugin, SyntaxNode } from './base';
import type { ParsedSymbol, ImportDeclaration } from '../../../shared/types';

/**
 * Python parser plugin.
 *
 * Tree-sitter-python node types we care about:
 *   - function_definition           ← def name(): ...
 *   - async_function_definition     ← async def name(): ...
 *   - class_definition              ← class Name: ...
 *   - decorated_definition          ← @decorator wrapping the above
 *   - import_statement              ← import x, import x.y, import x as z
 *   - import_from_statement         ← from x.y import a, b
 *   - relative_import / dotted_name / aliased_import
 *
 * Imports preserve the raw module path. The Python *resolver* (see
 * resolvers/python.ts) handles turning that into a real file path.
 */

function extractSymbols(node: SyntaxNode): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  for (const child of node.children) {
    const sym = nodeToSymbol(child);
    if (sym) symbols.push(sym);
  }
  return symbols;
}

function nodeToSymbol(node: SyntaxNode): ParsedSymbol | null {
  switch (node.type) {
    case 'function_definition':
    case 'async_function_definition': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      const modifiers = node.type === 'async_function_definition' ? ['async'] : [];
      return {
        name,
        kind: 'function',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        children: [],
        modifiers,
      };
    }
    case 'class_definition': {
      const name = node.childForFieldName('name')?.text || 'anonymous';
      const body = node.childForFieldName('body');
      const children = body ? extractClassMembers(body) : [];
      return {
        name,
        kind: 'class',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        children,
        modifiers: [],
      };
    }
    case 'decorated_definition': {
      // Unwrap and forward to whatever's underneath, preserving the
      // outer decorator(s) in modifiers for surface visibility.
      const inner = node.children.find(
        (c: SyntaxNode) => c.type === 'function_definition'
          || c.type === 'async_function_definition'
          || c.type === 'class_definition',
      );
      if (!inner) return null;
      const sym = nodeToSymbol(inner);
      if (!sym) return null;
      const decorators = node.children
        .filter((c: SyntaxNode) => c.type === 'decorator')
        .map((d: SyntaxNode) => `@${d.text.replace(/^@/, '').trim().split(/\s|\(/)[0]}`);
      sym.modifiers = [...sym.modifiers, ...decorators];
      // Decorated items often start at the decorator line, not the def.
      sym.startLine = node.startPosition.row + 1;
      return sym;
    }
    case 'expression_statement': {
      // Module-level constants: NAME = value
      const child = node.children[0];
      if (child?.type !== 'assignment') return null;
      const left = child.childForFieldName('left');
      if (!left || left.type !== 'identifier') return null;
      // Heuristic: only surface ALL_CAPS identifiers as constants
      const name = left.text;
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return null;
      return {
        name,
        kind: 'variable',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        children: [],
        modifiers: ['const'],
      };
    }
    default:
      return null;
  }
}

function extractClassMembers(body: SyntaxNode): ParsedSymbol[] {
  const members: ParsedSymbol[] = [];
  for (const child of body.children) {
    const sym = nodeToSymbol(child);
    if (!sym) continue;
    // Methods on a class get re-tagged from 'function' → 'method'
    if (sym.kind === 'function') sym.kind = 'method';
    members.push(sym);
  }
  return members;
}

function extractImports(node: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];

  for (const child of node.children) {
    if (child.type === 'import_statement') {
      // `import a, b.c, d as e`
      for (const spec of child.children) {
        const moduleName = readImportTarget(spec);
        if (!moduleName) continue;
        imports.push({
          source: moduleName.module,
          specifiers: moduleName.alias ? [moduleName.alias] : [moduleName.module.split('.').pop() || moduleName.module],
          isDefault: false,
          isNamespace: true,  // `import x` brings x in as a namespace
        });
      }
    } else if (child.type === 'import_from_statement') {
      // `from x.y import a, b`  /  `from . import x`  /  `from ..pkg import y`
      const moduleNode = child.childForFieldName('module_name');
      const module = readModuleSource(moduleNode);
      const names: string[] = [];
      // Iterate children after the 'import' keyword
      let sawImport = false;
      for (const c of child.children) {
        if (c.type === 'import') { sawImport = true; continue; }
        if (!sawImport) continue;
        const target = readImportTarget(c);
        if (target) names.push(target.alias || target.module);
        else if (c.type === 'wildcard_import' || (c.type === '*' || c.text === '*')) names.push('*');
      }
      imports.push({
        source: module || '',
        specifiers: names,
        isDefault: false,
        isNamespace: names.includes('*'),
      });
    }
  }

  return imports;
}

interface ImportTarget { module: string; alias?: string }

/** Read a module name from a dotted_name, identifier, or aliased_import node. */
function readImportTarget(node: SyntaxNode | null | undefined): ImportTarget | null {
  if (!node) return null;
  if (node.type === 'aliased_import') {
    const inner = node.childForFieldName('name');
    const aliasNode = node.childForFieldName('alias');
    const module = readModuleSource(inner) || '';
    if (!module) return null;
    return { module, alias: aliasNode?.text };
  }
  if (node.type === 'dotted_name' || node.type === 'identifier') {
    const module = readModuleSource(node);
    if (!module) return null;
    return { module };
  }
  return null;
}

/**
 * Stringify a `dotted_name`, `relative_import`, or plain identifier as
 * the Python source would express it: `app.routes.users`,
 * `.helpers`, `..config`.
 */
function readModuleSource(node: SyntaxNode | null | undefined): string {
  if (!node) return '';
  if (node.type === 'identifier') return node.text;
  if (node.type === 'dotted_name') {
    return node.children
      .filter((c: SyntaxNode) => c.type === 'identifier')
      .map((c: SyntaxNode) => c.text)
      .join('.');
  }
  if (node.type === 'relative_import') {
    // `import_prefix` (the leading dots) then optional `dotted_name`.
    const dots = node.children.filter((c: SyntaxNode) => c.type === 'import_prefix' || c.text === '.' || c.text === '..').map((c: SyntaxNode) => c.text).join('');
    const inner = node.children.find((c: SyntaxNode) => c.type === 'dotted_name');
    return dots + (inner ? readModuleSource(inner) : '');
  }
  return node.text || '';
}

export const pythonPlugin: ParserPlugin = {
  language: 'python',
  extensions: ['.py'],
  grammarFile: 'tree-sitter-python.wasm',
  grammarKey: 'python',
  extractSymbols,
  extractImports,
};
