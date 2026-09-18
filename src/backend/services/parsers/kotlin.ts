import type { ParserPlugin, SyntaxNode } from './base';
import { flattenSymbols } from './base';
import type { ParsedSymbol, ImportDeclaration } from '../../../shared/types';

/**
 * Kotlin parser plugin — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * tree-sitter-kotlin nodes, verified against the committed grammar:
 *
 *   source_file            root
 *   package_header         `package com.acme.billing`
 *   import                 `import com.acme.Ledger` / `… .*` / `… as X`
 *   class_declaration      class, interface AND enum — see below
 *   object_declaration     `object Registry { … }`
 *   companion_object       `companion object { … }`
 *   function_declaration   `fun f()`, incl. extension receivers
 *   property_declaration   `val x`, `const val RATE`
 *   type_alias             `typealias Cents = Int`
 *
 * ## One node for three declarations
 *
 * `class_declaration` covers `class`, `interface` and `enum class`. The
 * distinguishing token is *anonymous*, so `namedChildren` cannot see it
 * — an interface read off named children alone is indistinguishable from
 * a class. The keyword is therefore read from `node.children`, and the
 * enum case from the `class_modifier` list. Getting this wrong would not
 * fail: it would quietly file every Kotlin interface as a class.
 *
 * ## Naming
 *
 * Members are qualified `Type.member`, and extension functions carry
 * their receiver — `Double.twice`. Kotlin codebases are full of `invoke`,
 * `execute` and `toString` on unrelated types; flat names collide on
 * sight. Same decision as Go, Ruby and C#.
 */

function lineOf(node: SyntaxNode): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** Anonymous keyword tokens, invisible to `namedChildren`. */
function hasKeyword(node: SyntaxNode, keyword: string): boolean {
  return node.children.some((c: SyntaxNode) => !c.isNamed && c.type === keyword);
}

/** Declared modifiers, flattened: `data`, `sealed`, `enum`, `override`, … */
function modifiersOf(node: SyntaxNode, ...extra: string[]): string[] {
  const block = node.children.find((c: SyntaxNode) => c.type === 'modifiers');
  const mods = block ? block.namedChildren.map((m: SyntaxNode) => m.text) : [];
  return [...mods, ...extra];
}

/** The first `identifier` that is a direct child — the declared name. */
function identifierOf(node: SyntaxNode): string | null {
  return node.children.find((c: SyntaxNode) => c.type === 'identifier')?.text ?? null;
}

function bodyOf(node: SyntaxNode): SyntaxNode | null {
  return node.children.find(
    (c: SyntaxNode) => c.type === 'class_body' || c.type === 'enum_class_body',
  ) ?? null;
}

/**
 * `fun Double.twice()` puts a `user_type` receiver *before* the name.
 * Returns null for an ordinary function.
 */
function receiverOf(node: SyntaxNode): string | null {
  for (const child of node.children) {
    if (child.type === 'identifier') return null;      // name came first
    if (child.type === 'user_type') return child.text;  // receiver came first
  }
  return null;
}

function functionSymbol(node: SyntaxNode, owner: string | null): ParsedSymbol | null {
  const bare = identifierOf(node);
  if (!bare) return null;
  const receiver = receiverOf(node);
  const qualifier = receiver ?? owner;
  return {
    name: qualifier ? `${qualifier}.${bare}` : bare,
    kind: owner ? 'method' : 'function',
    ...lineOf(node),
    children: [],
    modifiers: modifiersOf(node, ...(receiver ? ['extension'] : [])),
  };
}

/**
 * `val (a, b) = pair` and `val x: Int = 1` both land here. The name
 * lives inside `variable_declaration`, whose own text includes the type
 * annotation, so the identifier is read out rather than the text.
 */
function propertySymbols(node: SyntaxNode, owner: string | null): ParsedSymbol[] {
  const mods = modifiersOf(node, owner ? 'property' : 'top_level');
  const out: ParsedSymbol[] = [];
  for (const child of node.children) {
    if (child.type !== 'variable_declaration' && child.type !== 'multi_variable_declaration') continue;
    const targets = child.type === 'multi_variable_declaration'
      ? child.namedChildren.filter((c: SyntaxNode) => c.type === 'variable_declaration')
      : [child];
    for (const target of targets) {
      const name = identifierOf(target) ?? target.text;
      if (!name) continue;
      out.push({
        name: owner ? `${owner}.${name}` : name,
        kind: 'variable',
        ...lineOf(node),
        children: [],
        modifiers: mods,
      });
    }
  }
  return out;
}

/**
 * `class Money(val amount: Double)` — the primary constructor's `val` /
 * `var` parameters are real properties, so they are recorded. A plain
 * parameter (no `val`/`var`) is not a property and is skipped.
 */
function primaryConstructorProperties(node: SyntaxNode, owner: string): ParsedSymbol[] {
  const ctor = node.children.find((c: SyntaxNode) => c.type === 'primary_constructor');
  if (!ctor) return [];
  const params = ctor.children.find((c: SyntaxNode) => c.type === 'class_parameters');
  if (!params) return [];
  const out: ParsedSymbol[] = [];
  for (const param of params.namedChildren) {
    if (param.type !== 'class_parameter') continue;
    if (!hasKeyword(param, 'val') && !hasKeyword(param, 'var')) continue;
    const name = identifierOf(param);
    if (!name) continue;
    out.push({
      name: `${owner}.${name}`, kind: 'variable', ...lineOf(param),
      children: [], modifiers: ['property', 'constructor_param'],
    });
  }
  return out;
}

function memberSymbols(body: SyntaxNode | null, owner: string): ParsedSymbol[] {
  if (!body) return [];
  const out: ParsedSymbol[] = [];
  for (const child of body.namedChildren) {
    switch (child.type) {
      case 'function_declaration': {
        const sym = functionSymbol(child, owner);
        if (sym) out.push(sym);
        break;
      }
      case 'property_declaration':
        out.push(...propertySymbols(child, owner));
        break;
      case 'enum_entry': {
        const name = identifierOf(child);
        if (name) {
          out.push({
            name: `${owner}.${name}`, kind: 'variable', ...lineOf(child),
            children: [], modifiers: ['enum_member'],
          });
        }
        break;
      }
      case 'companion_object': {
        // An unnamed companion is `Companion` in Kotlin itself — that is
        // the name you write to reach it from Java, so it is the name to
        // show rather than "anonymous".
        const name = identifierOf(child) ?? 'Companion';
        const qualified = `${owner}.${name}`;
        out.push({
          name: qualified, kind: 'class', ...lineOf(child),
          children: memberSymbols(bodyOf(child), qualified),
          modifiers: ['companion'],
        });
        break;
      }
      default: {
        const nested = declarationSymbol(child, owner);
        if (nested) out.push(nested);
      }
    }
  }
  return out;
}

function declarationSymbol(node: SyntaxNode, prefix: string | null): ParsedSymbol | null {
  if (node.type === 'class_declaration') {
    const bare = identifierOf(node);
    if (!bare) return null;
    const name = prefix ? `${prefix}.${bare}` : bare;
    const mods = modifiersOf(node);
    const kind = hasKeyword(node, 'interface')
      ? 'interface'
      : mods.includes('enum') ? 'enum' : 'class';
    return {
      name, kind, ...lineOf(node),
      children: [
        ...primaryConstructorProperties(node, name),
        ...memberSymbols(bodyOf(node), name),
      ],
      modifiers: mods,
    };
  }

  if (node.type === 'object_declaration') {
    const bare = identifierOf(node);
    if (!bare) return null;
    const name = prefix ? `${prefix}.${bare}` : bare;
    return {
      name, kind: 'class', ...lineOf(node),
      children: memberSymbols(bodyOf(node), name),
      modifiers: modifiersOf(node, 'object'),
    };
  }

  if (node.type === 'type_alias') {
    const bare = identifierOf(node);
    if (!bare) return null;
    return {
      name: prefix ? `${prefix}.${bare}` : bare,
      kind: 'type', ...lineOf(node), children: [], modifiers: modifiersOf(node),
    };
  }

  return null;
}

function extractSymbols(root: SyntaxNode): ParsedSymbol[] {
  // Flat, qualified names — see `flattenSymbols`.
  return flattenSymbols(collectTopLevel(root));
}

function collectTopLevel(root: SyntaxNode): ParsedSymbol[] {
  const out: ParsedSymbol[] = [];
  for (const child of root.namedChildren) {
    if (child.type === 'function_declaration') {
      const sym = functionSymbol(child, null);
      if (sym) out.push(sym);
      continue;
    }
    if (child.type === 'property_declaration') {
      out.push(...propertySymbols(child, null));
      continue;
    }
    const sym = declarationSymbol(child, null);
    if (sym) out.push(sym);
  }
  return out;
}

/**
 * `import com.acme.Ledger`, `import com.acme.*`, `import x.y.Z as W`.
 *
 * The star in a wildcard import is an anonymous token — the
 * `qualified_identifier` reads `com.acme` either way — so a wildcard is
 * detected from the node's own text, not from its children. Missing that
 * would record `import com.acme.*` as an import of a type named `acme`.
 */
function extractImports(root: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];
  for (const child of root.namedChildren) {
    if (child.type !== 'import' && child.type !== 'import_header') continue;

    const qualified = child.children.find(
      (c: SyntaxNode) => c.type === 'qualified_identifier' || c.type === 'identifier',
    );
    const source = qualified?.text;
    if (!source) continue;

    const isWildcard = /\*\s*$/.test(child.text || '');
    const alias = child.children
      .filter((c: SyntaxNode) => c.type === 'identifier')
      .map((c: SyntaxNode) => c.text)
      .find((text: string) => text !== source);

    imports.push({
      source,
      specifiers: isWildcard ? ['*'] : [alias ?? (source.split('.').pop() ?? source)],
      isDefault: false,
      isNamespace: isWildcard,
    });
  }
  return imports;
}

export const kotlinPlugin: ParserPlugin = {
  language: 'kotlin',
  // `.kts` is Kotlin script — Gradle build files, mostly. Same grammar,
  // and a build file is part of the architecture whether or not anyone
  // enjoys reading it.
  extensions: ['.kt', '.kts'],
  grammarFile: 'tree-sitter-kotlin.wasm',
  grammarKey: 'kotlin',
  extractSymbols,
  extractImports,
};
