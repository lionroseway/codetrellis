import type { ParserPlugin, SyntaxNode } from './base';
import type { ParsedSymbol, ImportDeclaration } from '../../../shared/types';

/**
 * Go parser plugin — Phase 20.
 *
 * See [docs/PHASE-20-GO-SUPPORT.md](../../../../docs/PHASE-20-GO-SUPPORT.md).
 *
 * tree-sitter-go nodes we care about, all direct children of
 * `source_file`:
 *
 *   - function_declaration       `func Foo()`
 *   - method_declaration         `func (l *Ledger) Post()`
 *   - type_declaration           wraps one or more `type_spec`
 *   - const_declaration          wraps one or more `const_spec`
 *   - var_declaration            wraps one or more `var_spec`
 *   - import_declaration         single spec or an `import_spec_list`
 *
 * Two Go-specific decisions, both deliberate:
 *
 * 1. **Methods are named `(Receiver).Method`.** Go codebases are full
 *    of `Handle`, `String`, `Close` and `Run` hanging off different
 *    types. Flat names would collide constantly in symbol search and
 *    in the symbol-depth graph view.
 * 2. **Exportedness is captured as a modifier.** An initial capital
 *    is Go's only visibility marker, and the public surface of a
 *    package is exactly the architectural boundary this product cares
 *    about. It costs one character test.
 */

function lineOf(node: SyntaxNode): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** Go's only visibility rule: an initial upper-case rune is exported. */
function isExported(name: string): boolean {
  const first = name.charAt(0);
  return first !== '' && first === first.toUpperCase() && first !== first.toLowerCase();
}

function modifiersFor(name: string, ...extra: string[]): string[] {
  return isExported(name) ? ['exported', ...extra] : [...extra];
}

/**
 * Receiver text is `(l *Ledger)` / `(Ledger)` / `(l Ledger[T])`. We
 * want just the type name so methods group under the type a reader
 * would look for.
 */
function receiverTypeName(receiver: SyntaxNode | null): string | null {
  if (!receiver) return null;
  const raw = (receiver.text || '').trim().replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!raw) return null;
  // Drop the optional receiver variable: `l *Ledger` → `*Ledger`.
  const parts = raw.split(/\s+/);
  const typePart = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  // Strip pointer marker and any generic parameter list.
  return typePart.replace(/^\*/, '').replace(/\[.*\]$/, '') || null;
}

/** Every identifier a spec declares — `var a, b int` declares two. */
function specNames(spec: SyntaxNode): string[] {
  const names: string[] = [];
  for (const child of spec.children) {
    if (child.type === 'identifier') names.push(child.text);
  }
  if (names.length === 0) {
    const named = spec.childForFieldName('name')?.text;
    if (named) names.push(named);
  }
  return names.filter((n) => n && n !== '_');
}

function typeSpecToSymbol(spec: SyntaxNode): ParsedSymbol | null {
  const name = spec.childForFieldName('name')?.text;
  if (!name) return null;
  const typeNode = spec.childForFieldName('type');
  const lines = lineOf(spec);

  switch (typeNode?.type) {
    case 'struct_type':
      return { name, kind: 'class', ...lines, children: [], modifiers: modifiersFor(name, 'struct') };
    case 'interface_type':
      return { name, kind: 'interface', ...lines, children: [], modifiers: modifiersFor(name, 'interface') };
    default:
      return { name, kind: 'type', ...lines, children: [], modifiers: modifiersFor(name) };
  }
}

function nodeToSymbols(node: SyntaxNode): ParsedSymbol[] {
  switch (node.type) {
    case 'function_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (!name) return [];
      return [{ name, kind: 'function', ...lineOf(node), children: [], modifiers: modifiersFor(name) }];
    }

    case 'method_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (!name) return [];
      const recv = receiverTypeName(node.childForFieldName('receiver'));
      const qualified = recv ? `(${recv}).${name}` : name;
      return [{
        name: qualified,
        kind: 'function',
        ...lineOf(node),
        children: [],
        // Exportedness is a property of the method name, not the
        // qualified form.
        modifiers: modifiersFor(name, 'method'),
      }];
    }

    case 'type_declaration': {
      // Both `type X struct{}` and a grouped `type ( X …; Y … )` land
      // here; the grouped form just has more `type_spec` children.
      const out: ParsedSymbol[] = [];
      for (const spec of node.children) {
        if (spec.type !== 'type_spec' && spec.type !== 'type_alias') continue;
        const sym = typeSpecToSymbol(spec);
        if (sym) out.push(sym);
      }
      return out;
    }

    case 'const_declaration':
    case 'var_declaration': {
      const out: ParsedSymbol[] = [];
      const extra = node.type === 'const_declaration' ? 'const' : 'var';
      // tree-sitter-go nests a GROUPED var one level deeper than a grouped
      // const: `var_declaration > var_spec_list > var_spec`, but
      // `const_declaration > const_spec` directly. Walking children only, a
      // `var ( … )` block yielded nothing at all — and a grouped var block is
      // where Go puts package-level state, so it is exactly the declaration a
      // reader most wants in the graph.
      const specs = node.children.flatMap((c: SyntaxNode) =>
        c.type.endsWith('_spec_list') ? c.children : [c],
      );
      for (const spec of specs) {
        if (!spec.type.endsWith('_spec')) continue;
        for (const name of specNames(spec)) {
          out.push({
            name,
            kind: 'variable',
            ...lineOf(spec),
            children: [],
            modifiers: modifiersFor(name, extra),
          });
        }
      }
      return out;
    }

    default:
      return [];
  }
}

function extractSymbols(root: SyntaxNode): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  for (const child of root.children) {
    symbols.push(...nodeToSymbols(child));
  }
  return symbols;
}

/** `"github.com/org/repo"` → `github.com/org/repo`. */
function unquote(text: string | undefined): string {
  if (!text) return '';
  return text.replace(/^[`"]/, '').replace(/[`"]$/, '');
}

function importSpecToDeclaration(spec: SyntaxNode): ImportDeclaration | null {
  const source = unquote(spec.childForFieldName('path')?.text);
  if (!source) return null;

  // An alias is the optional `name` field: `store "github.com/…"`,
  // `_ "github.com/lib/pq"` (side-effect only), `. "…"` (dot import).
  const alias = spec.childForFieldName('name')?.text;
  const lastSegment = source.split('/').pop() || source;

  return {
    source,
    // A blank import is kept deliberately. It is a *side-effect*
    // dependency — driver registration, codec registration — and it
    // is invisible in the call graph, which makes it more worth
    // surfacing than an ordinary import, not less.
    specifiers: [alias || lastSegment],
    isDefault: false,
    isNamespace: alias === '.',
  };
}

function extractImports(root: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];

  for (const child of root.children) {
    if (child.type !== 'import_declaration') continue;

    const list = child.children.find((c: SyntaxNode) => c.type === 'import_spec_list');
    const specs = (list ? list.children : child.children)
      .filter((c: SyntaxNode) => c.type === 'import_spec');

    for (const spec of specs) {
      const decl = importSpecToDeclaration(spec);
      if (decl) imports.push(decl);
    }
  }

  return imports;
}

export const goPlugin: ParserPlugin = {
  language: 'go',
  extensions: ['.go'],
  grammarFile: 'tree-sitter-go.wasm',
  grammarKey: 'go',
  extractSymbols,
  extractImports,
};
