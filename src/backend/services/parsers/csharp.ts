import type { ParserPlugin, SyntaxNode } from './base';
import { flattenSymbols } from './base';
import type { ParsedSymbol, ImportDeclaration, SymbolKind } from '../../../shared/types';

/**
 * C# parser plugin — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * tree-sitter-c-sharp nodes, verified against the committed grammar:
 *
 *   compilation_unit                     root
 *   using_directive                      `using System;`
 *   namespace_declaration                `namespace X { … }`
 *   file_scoped_namespace_declaration    `namespace X;`  (C# 10+)
 *   class_declaration / struct_declaration / record_declaration
 *   interface_declaration / enum_declaration / delegate_declaration
 *   method_declaration / constructor_declaration / property_declaration
 *   declaration_list                     the `{ … }` body of a type
 *
 * ## Namespaces are containers, not symbols
 *
 * A namespace is not a thing a reader navigates to — it has no body of
 * its own and no line range worth highlighting. Both namespace forms are
 * therefore *descended through* rather than emitted, so the types inside
 * a `namespace Acme.Billing { … }` block land at the same level as types
 * in a file that uses the C# 10 file-scoped form. Two files that declare
 * the same types must produce the same symbols whichever syntax they
 * chose; anything else makes the graph depend on a language version.
 *
 * The namespace still matters for *resolution*, and `resolvers/csharp.ts`
 * reconstructs it from the project layout — see the honest account of
 * what that can and cannot do there.
 *
 * ## Naming
 *
 * Members are qualified `Type.Member`, the way C# itself writes them.
 * `Post`, `Handle`, `Execute` and `Dispose` hang off every other type in
 * a real C# codebase, so flat names collide immediately — the same
 * problem Go had with `Handle` and Ruby with `call`, and the same fix.
 */

function lineOf(node: SyntaxNode): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function nameOf(node: SyntaxNode): string | null {
  return node.childForFieldName('name')?.text ?? null;
}

/**
 * Declared modifiers (`public`, `static`, `abstract`, `async`, …).
 *
 * Visibility is the architectural boundary this product cares about, so
 * it is captured rather than discarded — the same reason Go records
 * `exported`. C# spells it out, so there is nothing to infer.
 */
function modifiersOf(node: SyntaxNode, ...extra: string[]): string[] {
  const mods: string[] = [];
  for (const child of node.children) {
    if (child.type === 'modifier') mods.push(child.text);
  }
  return [...mods, ...extra];
}

/** The `{ … }` body of a type declaration, if it has one. */
function declarationList(node: SyntaxNode): SyntaxNode | null {
  return node.children.find((c: SyntaxNode) => c.type === 'declaration_list') ?? null;
}

/**
 * `public record struct Money(decimal Amount)` — the positional
 * parameter list doubles as a property list, so the properties are
 * recorded as members rather than dropped. A reader looking for
 * `Money.Amount` should find it.
 */
function positionalMembers(node: SyntaxNode, owner: string): ParsedSymbol[] {
  const params = node.children.find((c: SyntaxNode) => c.type === 'parameter_list');
  if (!params) return [];
  const out: ParsedSymbol[] = [];
  for (const param of params.namedChildren) {
    if (param.type !== 'parameter') continue;
    const name = nameOf(param) ?? param.children.find((c: SyntaxNode) => c.type === 'identifier')?.text;
    if (!name) continue;
    out.push({
      name: `${owner}.${name}`,
      kind: 'variable',
      ...lineOf(param),
      children: [],
      modifiers: ['positional'],
    });
  }
  return out;
}

function memberSymbol(node: SyntaxNode, owner: string): ParsedSymbol | null {
  switch (node.type) {
    case 'method_declaration':
    case 'local_function_statement': {
      const name = nameOf(node);
      if (!name) return null;
      return { name: `${owner}.${name}`, kind: 'method', ...lineOf(node), children: [], modifiers: modifiersOf(node) };
    }
    case 'constructor_declaration': {
      const name = nameOf(node) ?? owner;
      return { name: `${owner}.${name}`, kind: 'method', ...lineOf(node), children: [], modifiers: modifiersOf(node, 'constructor') };
    }
    case 'destructor_declaration':
      return { name: `${owner}.~${owner}`, kind: 'method', ...lineOf(node), children: [], modifiers: modifiersOf(node, 'destructor') };
    case 'operator_declaration':
      return { name: `${owner}.operator`, kind: 'method', ...lineOf(node), children: [], modifiers: modifiersOf(node, 'operator') };
    case 'property_declaration':
    case 'indexer_declaration': {
      const name = nameOf(node) ?? (node.type === 'indexer_declaration' ? 'this[]' : null);
      if (!name) return null;
      return { name: `${owner}.${name}`, kind: 'variable', ...lineOf(node), children: [], modifiers: modifiersOf(node, 'property') };
    }
    case 'event_declaration': {
      const name = nameOf(node);
      if (!name) return null;
      return { name: `${owner}.${name}`, kind: 'variable', ...lineOf(node), children: [], modifiers: modifiersOf(node, 'event') };
    }
    default:
      return null;
  }
}

/**
 * `private decimal _total, _paid;` declares two fields in one node, so
 * the variable declarators are walked rather than the declaration.
 */
function fieldSymbols(node: SyntaxNode, owner: string): ParsedSymbol[] {
  const decl = node.children.find((c: SyntaxNode) => c.type === 'variable_declaration');
  if (!decl) return [];
  const mods = modifiersOf(node, 'field');
  const out: ParsedSymbol[] = [];
  for (const child of decl.namedChildren) {
    if (child.type !== 'variable_declarator') continue;
    const name = child.children.find((c: SyntaxNode) => c.type === 'identifier')?.text;
    if (!name) continue;
    out.push({ name: `${owner}.${name}`, kind: 'variable', ...lineOf(child), children: [], modifiers: mods });
  }
  return out;
}

function extractMembers(body: SyntaxNode | null, owner: string): ParsedSymbol[] {
  if (!body) return [];
  const out: ParsedSymbol[] = [];
  for (const child of body.namedChildren) {
    if (child.type === 'field_declaration') {
      out.push(...fieldSymbols(child, owner));
      continue;
    }
    // A type nested inside a type is a symbol in its own right, named
    // the way C# refers to it: `Outer.Inner`.
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

const TYPE_KINDS: Record<string, SymbolKind> = {
  class_declaration: 'class',
  struct_declaration: 'class',
  record_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  delegate_declaration: 'type',
};

function typeSymbol(node: SyntaxNode, prefix: string | null): ParsedSymbol | null {
  const kind = TYPE_KINDS[node.type];
  if (!kind) return null;
  const bare = nameOf(node);
  if (!bare) return null;
  const name = prefix ? `${prefix}.${bare}` : bare;

  const extra: string[] = [];
  if (node.type === 'struct_declaration') extra.push('struct');
  if (node.type === 'record_declaration') extra.push('record');
  if (node.type === 'delegate_declaration') extra.push('delegate');

  if (node.type === 'enum_declaration') {
    const list = node.children.find((c: SyntaxNode) => c.type === 'enum_member_declaration_list');
    const members: ParsedSymbol[] = [];
    for (const member of list?.namedChildren ?? []) {
      if (member.type !== 'enum_member_declaration') continue;
      const memberName = nameOf(member) ?? member.children.find((c: SyntaxNode) => c.type === 'identifier')?.text;
      if (!memberName) continue;
      members.push({
        name: `${name}.${memberName}`, kind: 'variable', ...lineOf(member),
        children: [], modifiers: ['enum_member'],
      });
    }
    return { name, kind, ...lineOf(node), children: members, modifiers: modifiersOf(node, ...extra) };
  }

  const children = [
    ...positionalMembers(node, name),
    ...extractMembers(declarationList(node), name),
  ];
  return { name, kind, ...lineOf(node), children, modifiers: modifiersOf(node, ...extra) };
}

/** Both namespace forms — the block one and the C# 10 file-scoped one. */
function isNamespace(node: SyntaxNode): boolean {
  return node.type === 'namespace_declaration' || node.type === 'file_scoped_namespace_declaration';
}

function collectTypes(container: SyntaxNode, out: ParsedSymbol[]): void {
  for (const child of container.namedChildren) {
    if (isNamespace(child)) {
      // Descend, don't emit — see the header.
      const body = declarationList(child);
      collectTypes(body ?? child, out);
      continue;
    }
    if (child.type === 'declaration_list') {
      collectTypes(child, out);
      continue;
    }
    const sym = typeSymbol(child, null);
    if (sym) out.push(sym);
  }
}

function extractSymbols(root: SyntaxNode): ParsedSymbol[] {
  const out: ParsedSymbol[] = [];
  collectTypes(root, out);
  // Flat, qualified names — see `flattenSymbols`.
  return flattenSymbols(out);
}

/**
 * `using` is a *namespace* import, not a file import.
 *
 * Four forms, all captured as the namespace they name:
 *
 *   using System;                     → System
 *   using System.Text;                → System.Text
 *   using Alias = Acme.Helpers;       → Acme.Helpers, specifier `Alias`
 *   global using System.Text;         → System.Text, modifier on nothing
 *   using static Acme.Math;           → Acme.Math
 *
 * The aliased form carries *two* children: the alias identifier first,
 * then the qualified name. Reading "the first identifier" would record
 * the alias as the import source, so the qualified name is taken
 * explicitly and a bare single-segment import falls back to the one
 * identifier present.
 */
function extractImports(root: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];
  for (const child of root.namedChildren) {
    if (child.type !== 'using_directive') continue;

    const qualified = child.children.find((c: SyntaxNode) => c.type === 'qualified_name');
    const identifiers = child.children.filter((c: SyntaxNode) => c.type === 'identifier');
    const alias = child.childForFieldName('alias')?.text
      ?? (qualified && identifiers.length > 0 ? identifiers[0].text : null);

    // `using X = Y;` without a dot in Y still has two identifiers.
    let source: string | null = qualified?.text ?? null;
    if (!source) {
      source = identifiers.length > 1 ? identifiers[identifiers.length - 1].text : identifiers[0]?.text ?? null;
    }
    if (!source) continue;

    const isAliased = Boolean(alias) && alias !== source;
    imports.push({
      source,
      specifiers: isAliased ? [alias as string] : [source.split('.').pop() ?? source],
      isDefault: false,
      // A plain `using` brings a whole namespace into scope — that is a
      // namespace import in every sense the graph cares about. An alias
      // binds one name, so it is not.
      isNamespace: !isAliased,
    });
  }
  return imports;
}

export const csharpPlugin: ParserPlugin = {
  language: 'csharp',
  extensions: ['.cs'],
  grammarFile: 'tree-sitter-c-sharp.wasm',
  grammarKey: 'csharp',
  extractSymbols,
  extractImports,
};
