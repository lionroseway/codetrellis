import type { ParserPlugin, SyntaxNode } from './base';
import { flattenSymbols } from './base';
import type { ParsedSymbol, ImportDeclaration, SymbolKind } from '../../../shared/types';

/**
 * Swift parser plugin — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * tree-sitter-swift nodes, verified against the committed grammar:
 *
 *   source_file              root
 *   import_declaration       `import Foundation`
 *   class_declaration        class, struct, enum AND extension
 *   protocol_declaration     `protocol Poster { … }`
 *   function_declaration     `func f()`
 *   init_declaration / deinit_declaration / subscript_declaration
 *   property_declaration     `let a: Double`, `private var total = 0`
 *   typealias_declaration    `typealias Cents = Int`
 *   enum_entry               `case open, closed`
 *
 * ## One node for four declarations
 *
 * `class_declaration` covers `class`, `struct`, `enum` *and*
 * `extension`, and the distinguishing keyword is an anonymous token. A
 * reader of `namedChildren` alone sees four identical shapes and would
 * file every struct as a class and every extension as a redefinition of
 * the type it extends. The keyword is therefore read off
 * `node.children`, and extensions are named `Type (extension)` so an
 * extension never collides with the declaration it extends — the two
 * are different places in different files and must stay separable in
 * symbol search.
 *
 * ## Naming
 *
 * Members are qualified `Type.member`. `post`, `make`, `description`
 * and `init` are everywhere in Swift; flat names would collide on every
 * file. Same decision as Go, Ruby, C# and Kotlin.
 */

function lineOf(node: SyntaxNode): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** Anonymous keyword tokens, invisible to `namedChildren`. */
function keywordOf(node: SyntaxNode, keywords: ReadonlyArray<string>): string | null {
  for (const child of node.children) {
    if (!child.isNamed && keywords.includes(child.type)) return child.type;
  }
  return null;
}

function modifiersOf(node: SyntaxNode, ...extra: string[]): string[] {
  const block = node.children.find((c: SyntaxNode) => c.type === 'modifiers');
  const mods = block ? block.namedChildren.map((m: SyntaxNode) => m.text) : [];
  return [...mods, ...extra];
}

function bodyOf(node: SyntaxNode): SyntaxNode | null {
  return node.children.find((c: SyntaxNode) => /(_body|_class_body)$/.test(c.type)) ?? null;
}

/** The first `simple_identifier` anywhere beneath a node. */
function firstSimpleIdentifier(node: SyntaxNode | null): string | null {
  if (!node) return null;
  if (node.type === 'simple_identifier') return node.text;
  for (const child of node.namedChildren) {
    const found = firstSimpleIdentifier(child);
    if (found) return found;
  }
  return null;
}

/**
 * `private var total: Double = 0` — the name lives in a `pattern`, whose
 * own text can carry a type annotation, tuple destructuring or a
 * wildcard. Reading `pattern.text` would store `total: Double` as the
 * symbol name.
 */
function propertySymbols(node: SyntaxNode, owner: string | null): ParsedSymbol[] {
  const mods = modifiersOf(node, owner ? 'property' : 'top_level');
  const out: ParsedSymbol[] = [];
  for (const child of node.children) {
    if (child.type !== 'pattern') continue;
    const name = firstSimpleIdentifier(child);
    if (!name) continue;
    out.push({
      name: owner ? `${owner}.${name}` : name,
      kind: 'variable',
      ...lineOf(node),
      children: [],
      modifiers: mods,
    });
  }
  return out;
}

function memberSymbol(node: SyntaxNode, owner: string): ParsedSymbol | null {
  switch (node.type) {
    case 'function_declaration':
    case 'protocol_function_declaration': {
      const name = node.children.find((c: SyntaxNode) => c.type === 'simple_identifier')?.text;
      if (!name) return null;
      return { name: `${owner}.${name}`, kind: 'method', ...lineOf(node), children: [], modifiers: modifiersOf(node) };
    }
    case 'init_declaration':
      return { name: `${owner}.init`, kind: 'method', ...lineOf(node), children: [], modifiers: modifiersOf(node, 'initializer') };
    case 'deinit_declaration':
      return { name: `${owner}.deinit`, kind: 'method', ...lineOf(node), children: [], modifiers: modifiersOf(node, 'deinitializer') };
    case 'subscript_declaration':
      return { name: `${owner}.subscript`, kind: 'method', ...lineOf(node), children: [], modifiers: modifiersOf(node, 'subscript') };
    case 'typealias_declaration': {
      const name = node.children.find((c: SyntaxNode) => c.type === 'type_identifier')?.text;
      if (!name) return null;
      return { name: `${owner}.${name}`, kind: 'type', ...lineOf(node), children: [], modifiers: modifiersOf(node) };
    }
    default:
      return null;
  }
}

function memberSymbols(body: SyntaxNode | null, owner: string): ParsedSymbol[] {
  if (!body) return [];
  const out: ParsedSymbol[] = [];
  for (const child of body.namedChildren) {
    if (child.type === 'property_declaration' || child.type === 'protocol_property_declaration') {
      out.push(...propertySymbols(child, owner));
      continue;
    }
    if (child.type === 'enum_entry') {
      // `case open, closed` declares two cases in one node.
      for (const id of child.children) {
        if (id.type !== 'simple_identifier') continue;
        out.push({
          name: `${owner}.${id.text}`, kind: 'variable', ...lineOf(child),
          children: [], modifiers: ['enum_member'],
        });
      }
      continue;
    }
    const nested = typeSymbol(child, owner);
    if (nested) {
      out.push(nested);
      continue;
    }
    const member = memberSymbol(child, owner);
    if (member) out.push(member);
  }
  return out;
}

const KEYWORD_KINDS: Record<string, SymbolKind> = {
  class: 'class',
  struct: 'class',
  enum: 'enum',
  actor: 'class',
  extension: 'class',
};

function typeSymbol(node: SyntaxNode, prefix: string | null): ParsedSymbol | null {
  if (node.type === 'protocol_declaration') {
    const bare = node.children.find((c: SyntaxNode) => c.type === 'type_identifier')?.text;
    if (!bare) return null;
    const name = prefix ? `${prefix}.${bare}` : bare;
    return {
      name, kind: 'interface', ...lineOf(node),
      children: memberSymbols(bodyOf(node), name),
      modifiers: modifiersOf(node),
    };
  }

  if (node.type !== 'class_declaration') return null;

  const keyword = keywordOf(node, ['class', 'struct', 'enum', 'actor', 'extension']) ?? 'class';
  const kind = KEYWORD_KINDS[keyword] ?? 'class';

  // An extension names an existing type (`user_type`); everything else
  // declares a new one (`type_identifier`).
  const target = node.children.find(
    (c: SyntaxNode) => c.type === 'type_identifier' || c.type === 'user_type',
  );
  if (!target) return null;
  const bare = keyword === 'extension' ? `${target.text} (extension)` : target.text;
  const name = prefix ? `${prefix}.${bare}` : bare;

  return {
    name, kind, ...lineOf(node),
    children: memberSymbols(bodyOf(node), prefix ? `${prefix}.${target.text}` : target.text),
    modifiers: modifiersOf(node, keyword),
  };
}

function extractSymbols(root: SyntaxNode): ParsedSymbol[] {
  // Flat, qualified names — see `flattenSymbols`.
  return flattenSymbols(collectTopLevel(root));
}

function collectTopLevel(root: SyntaxNode): ParsedSymbol[] {
  const out: ParsedSymbol[] = [];
  for (const child of root.namedChildren) {
    if (child.type === 'function_declaration') {
      const name = child.children.find((c: SyntaxNode) => c.type === 'simple_identifier')?.text;
      if (name) {
        out.push({ name, kind: 'function', ...lineOf(child), children: [], modifiers: modifiersOf(child) });
      }
      continue;
    }
    if (child.type === 'property_declaration') {
      out.push(...propertySymbols(child, null));
      continue;
    }
    if (child.type === 'typealias_declaration') {
      const name = child.children.find((c: SyntaxNode) => c.type === 'type_identifier')?.text;
      if (name) out.push({ name, kind: 'type', ...lineOf(child), children: [], modifiers: modifiersOf(child) });
      continue;
    }
    const sym = typeSymbol(child, null);
    if (sym) out.push(sym);
  }
  return out;
}

/**
 * `import Foundation`, `import struct BillingCore.Money`,
 * `@testable import BillingCore`.
 *
 * Swift imports name a **module**, not a file — and within a module
 * every file sees every other with no import at all. The source stored
 * is therefore the module, which is the first path segment; the
 * remainder (`.Money`) names a symbol inside it and is kept as the
 * specifier. `resolvers/swift.ts` explains what can be done with that.
 */
function extractImports(root: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];
  for (const child of root.namedChildren) {
    if (child.type !== 'import_declaration') continue;
    const target = child.children.find((c: SyntaxNode) => c.type === 'identifier');
    const full = target?.text?.trim();
    if (!full) continue;

    const segments = full.split('.');
    const moduleName = segments[0];
    if (!moduleName) continue;

    imports.push({
      source: moduleName,
      specifiers: segments.length > 1 ? [segments[segments.length - 1]] : [moduleName],
      isDefault: false,
      // A bare `import Foo` brings the module's whole public surface
      // into scope; `import struct Foo.Bar` brings one declaration.
      isNamespace: segments.length === 1,
    });
  }
  return imports;
}

export const swiftPlugin: ParserPlugin = {
  language: 'swift',
  extensions: ['.swift'],
  grammarFile: 'tree-sitter-swift.wasm',
  grammarKey: 'swift',
  extractSymbols,
  extractImports,
};
