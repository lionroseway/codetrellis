import fs from 'node:fs';
import path from 'node:path';
import * as TreeSitterModule from 'web-tree-sitter';
const TreeSitter = (TreeSitterModule as any).Parser || (TreeSitterModule as any).default?.Parser || TreeSitterModule;
const Language = (TreeSitterModule as any).Language || TreeSitter.Language;
import type { ParsedFile, ParsedSymbol, ImportDeclaration, ExportDeclaration, SupportedLanguage } from '../../shared/types';
import { createHash } from 'node:crypto';

const GRAMMAR_DIR = path.resolve(__dirname, '../../../resources/tree-sitter');

let initialized = false;
const parsers = new Map<string, any>();

const LANG_TO_GRAMMAR: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
  rust: 'tree-sitter-rust.wasm',
  php: 'tree-sitter-php.wasm',
  java: 'tree-sitter-java.wasm',
};

/**
 * Initialize tree-sitter WASM runtime and load grammars.
 */
export async function initParser(): Promise<void> {
  if (initialized) return;

  await TreeSitter.init({
    locateFile: () => path.join(GRAMMAR_DIR, 'tree-sitter.wasm'),
  });

  for (const [lang, grammarFile] of Object.entries(LANG_TO_GRAMMAR)) {
    const grammarPath = path.join(GRAMMAR_DIR, grammarFile);
    if (!fs.existsSync(grammarPath)) continue;

    const language = await Language.load(grammarPath);
    const parser = new TreeSitter();
    parser.setLanguage(language);
    parsers.set(lang, parser);
  }

  initialized = true;
  console.log(`[AST] Initialized with grammars: ${[...parsers.keys()].join(', ')}`);
}

/**
 * Determine which parser to use for a file.
 */
function getParserForFile(filePath: string): { parser: any; language: SupportedLanguage } | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts') return parsers.has('typescript') ? { parser: parsers.get('typescript')!, language: 'typescript' } : null;
  if (ext === '.tsx') return parsers.has('tsx') ? { parser: parsers.get('tsx')!, language: 'typescript' } : null;
  if (ext === '.js' || ext === '.jsx') return parsers.has('javascript') ? { parser: parsers.get('javascript')!, language: 'javascript' } : null;
  if (ext === '.py') return parsers.has('python') ? { parser: parsers.get('python')!, language: 'python' } : null;
  if (ext === '.rs') return parsers.has('rust') ? { parser: parsers.get('rust')!, language: 'rust' } : null;
  if (ext === '.php') return parsers.has('php') ? { parser: parsers.get('php')!, language: 'java' } : null;
  if (ext === '.java') return parsers.has('java') ? { parser: parsers.get('java')!, language: 'java' } : null;
  return null;
}

function parseSource(filePath: string, content: string): ParsedFile | null {
  const match = getParserForFile(filePath);
  if (!match) return null;

  const { parser, language } = match;
  const tree = parser.parse(content);
  const root = tree.rootNode;

  const contentHash = createHash('md5').update(content).digest('hex');
  const symbols = extractSymbols(root);
  const imports = extractImports(root);
  const exports = extractExports(root);

  return { path: filePath, contentHash, language, symbols, imports, exports };
}

/**
 * Parse a single file and extract symbols + imports.
 */
export function parseFile(filePath: string): ParsedFile | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  return parseSource(filePath, content);
}

/**
 * Parse source code that does not exist on disk, while still using the
 * filepath to infer language and relative import resolution.
 */
export function parseVirtualFile(filePath: string, content: string): ParsedFile | null {
  return parseSource(filePath, content);
}

/**
 * Extract top-level symbols (functions, classes, interfaces, types, enums)
 * and their children (methods, properties).
 */
function extractSymbols(node: TreeSitter.SyntaxNode): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  for (const child of node.children) {
    const symbol = nodeToSymbol(child);
    if (symbol) symbols.push(symbol);
  }

  return symbols;
}

function nodeToSymbol(node: TreeSitter.SyntaxNode): ParsedSymbol | null {
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
      // Handle: const foo = () => {} or const Foo = function() {}
      const declarators = node.children.filter((c) => c.type === 'variable_declarator');
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
      // Unwrap: export function foo() {} → recurse into the declaration
      const declaration = node.childForFieldName('declaration') || node.children.find(
        (c) => c.type !== 'export' && c.type !== 'default' && c.type !== 'comment'
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

function extractClassMembers(body: TreeSitter.SyntaxNode): ParsedSymbol[] {
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

function extractModifiers(node: TreeSitter.SyntaxNode): string[] {
  const mods: string[] = [];
  // Check parent for export
  if (node.parent?.type === 'export_statement') mods.push('export');
  // Check children for async, static, etc
  for (const child of node.children) {
    if (child.type === 'async') mods.push('async');
    if (child.type === 'static') mods.push('static');
    if (child.type === 'readonly') mods.push('readonly');
    if (child.type === 'abstract') mods.push('abstract');
    if (child.type === 'accessibility_modifier') mods.push(child.text);
  }
  return mods;
}

/**
 * Extract import declarations.
 */
function extractImports(node: TreeSitter.SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];

  for (const child of node.children) {
    if (child.type === 'import_statement') {
      const source = child.childForFieldName('source')?.text?.replace(/['"]/g, '') || '';
      const specifiers: string[] = [];
      let isDefault = false;
      let isNamespace = false;

      for (const c of child.children) {
        if (c.type === 'import_clause') {
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
              specifiers.push(cc.children.find((x) => x.type === 'identifier')?.text || '*');
            }
          }
        }
      }

      imports.push({ source, specifiers, isDefault, isNamespace });
    }
  }

  return imports;
}

/**
 * Extract export declarations.
 */
function extractExports(node: TreeSitter.SyntaxNode): ExportDeclaration[] {
  const exports: ExportDeclaration[] = [];

  for (const child of node.children) {
    if (child.type === 'export_statement') {
      const isDefault = child.children.some((c) => c.type === 'default');
      const declaration = child.childForFieldName('declaration') || child.children.find(
        (c) => c.type !== 'export' && c.type !== 'default' && c.type !== ';' && c.type !== 'comment'
      );

      if (declaration) {
        const sym = nodeToSymbol(declaration);
        if (sym) {
          exports.push({ name: sym.name, kind: sym.kind, isDefault });
        }
      }
    }
  }

  return exports;
}

/**
 * Parse all source files in a list. Returns only files that could be parsed.
 */
export async function parseFiles(filePaths: string[]): Promise<ParsedFile[]> {
  await initParser();

  const results: ParsedFile[] = [];
  for (const fp of filePaths) {
    const parsed = parseFile(fp);
    if (parsed) results.push(parsed);
  }
  return results;
}
