/**
 * Per-language parser plugin contract.
 *
 * Each language CodeTrellis ingests is a single file in this directory
 * that exports a `ParserPlugin`. Adding a new language = drop a new
 * file in `parsers/` and register it in `parsers/index.ts`. No other
 * code changes.
 *
 * See [docs/SYSTEM-MODEL.md](../../../../docs/SYSTEM-MODEL.md) for the
 * surrounding model.
 */

import type {
  ParsedSymbol,
  ImportDeclaration,
  ExportDeclaration,
  SupportedLanguage,
} from '../../../shared/types';

/**
 * tree-sitter syntax node — typed loosely because the WASM bindings
 * use `any` for cross-grammar interop.
 */
export type SyntaxNode = any;

export interface ParserPlugin {
  /** Canonical language tag for this plugin (matches SupportedLanguage). */
  language: SupportedLanguage;

  /** Lowercase file extensions (with leading dot) this plugin owns. */
  extensions: readonly string[];

  /** Filename in resources/tree-sitter/ that holds the WASM grammar. */
  grammarFile: string;

  /**
   * Internal grammar key used to look up the parser instance. Multiple
   * plugins can share a grammar (e.g. .ts and .tsx use different
   * grammars but report the same `language: 'typescript'`); this key
   * keeps the parser registry distinct.
   */
  grammarKey: string;

  /**
   * Pull the top-level symbols (functions, classes, etc.) out of the
   * tree-sitter tree.
   */
  extractSymbols(root: SyntaxNode): ParsedSymbol[];

  /** Extract import declarations as raw source strings + specifiers. */
  extractImports(root: SyntaxNode): ImportDeclaration[];

  /** Optional — most languages won't need export tracking yet. */
  extractExports?(root: SyntaxNode): ExportDeclaration[];
}

/**
 * Flatten a symbol tree into the one shape every reader actually sees.
 *
 * **Nesting is written to the database and then read back by almost
 * nothing.** `symbols.parent_symbol_id` exists, `insertSymbol` recurses
 * and fills it in — but `getFileSymbols` (the inspector's file list),
 * the per-file symbol counts in `trellis-service` and
 * `mobile-rpc-service`, and the MCP `plan-item` symbol lookup all filter
 * on `parent_symbol_id IS NULL`. Only free-text symbol *search* and the
 * global row count see children.
 *
 * So a nested member is half-present: findable by search, absent from
 * the file it lives in, and not counted toward that file's symbol total.
 * That is the worst of both models, and it is not a choice anyone made —
 * it is what happens when some plugins build trees (Java did, and C#,
 * Kotlin and Swift naturally would) and others emit flat qualified names
 * (Go's `(Ledger).Post`, Ruby's `Invoice#post`, TypeScript's methods).
 *
 * This makes the flat form the contract. The parent relationship is not
 * lost — it moves into the name, where every reader already looks, which
 * is exactly why those languages qualify their members in the first
 * place.
 *
 * The alternative — teaching every reader to walk the tree — is a real
 * product change (file symbol lists become expandable, counts jump) and
 * belongs in its own phase, not smuggled in behind a language addition.
 * See docs/PHASE-27-LANGUAGE-EXPANSION.md.
 */
export function flattenSymbols(symbols: ParsedSymbol[]): ParsedSymbol[] {
  const out: ParsedSymbol[] = [];
  const visit = (list: ParsedSymbol[]): void => {
    for (const sym of list) {
      out.push({ ...sym, children: [] });
      if (sym.children.length > 0) visit(sym.children);
    }
  };
  visit(symbols);
  return out;
}

/** Nodes read as one token: a literal's inside is not shape. */
const ATOMIC = new Set(['string', 'template_string', 'number', 'integer', 'float', 'regex', 'true', 'false', 'none', 'null', 'undefined']);
/** Any grammar's string literal (`string_literal`, `interpreted_string_literal`, PHP's `encapsed_string`, …). */
const STRING_LITERAL = /(^|_)string(_literal)?$|^encapsed_string$|^character_literal$/;
/**
 * Nodes written as one word, read as their text with whitespace collapsed
 * (A2.7): PHP's `$amount` and `?array`, Ruby's `*rest`, `**opts` and `&blk`,
 * Go's `*Ledger`, Rust's `&mut self` and `&str`.
 */
const TIGHT = new Set(['variable_name', 'optional_type', 'splat_parameter', 'hash_splat_parameter', 'block_parameter', 'pointer_type', 'reference_type', 'self_parameter']);

/**
 * A node's shape as text, for a signature (Phase 32 A2.1): its tokens in
 * order, with comments dropped and whitespace normalised, so reformatting
 * or commenting a parameter list does not change it and renaming or adding
 * a parameter does. Null for a missing node.
 */
export function shapeOf(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  return shapeOfNodes([node]);
}

/** Several nodes' shape, as one run of tokens (`shapeOf` for each, joined). Null for none. */
export function shapeOfNodes(nodes: readonly SyntaxNode[]): string | null {
  if (!nodes.length) return null;
  const tokens: string[] = [];
  const walk = (n: SyntaxNode) => {
    // Comments (`line_comment`, `block_comment` in some grammars), and `;` —
    // a member separator that a newline can replace.
    if (n.type === 'comment' || /_comment$/.test(n.type) || n.type === ';') return;
    if (n.childCount === 0 || ATOMIC.has(n.type) || STRING_LITERAL.test(n.type)) {
      if (n.text) tokens.push(n.text);
      return;
    }
    if (TIGHT.has(n.type)) {
      tokens.push(n.text.replace(/\s+/g, ' ').replace(/([&*]) (?=[\w'])/g, '$1'));
      return;
    }
    for (const c of n.children) walk(c);
  };
  for (const node of nodes) walk(node);
  return tokens.join(' ')
    .replace(/,(\s*[)\]}>])/g, '$1') // a trailing comma is layout
    .replace(/\s+([,;:)\]>?])/g, '$1') // no space before closers and separators
    .replace(/([([<])\s+/g, '$1') // nor after openers
    .replace(/([\w>\])])\s+([<[])/g, '$1$2') // Promise<T>, string[]
    .replace(/([>\]]) \(/g, '$1(') // <T>(a), Go's [T any](a)
    .replace(/ \.$/, '.') // Kotlin's receiver, `String.`
    .replace(/ \. /g, '.') // a.b
    .replace(/\.\.\. /g, '...') // ...rest
    .replace(/(^|[(,] ?)(\*{1,2}) /g, '$1$2'); // Python *args, **kw
}

/**
 * A signature from its parts, skipping the missing ones: the parts a
 * language has in the order it writes them (type parameters, parameters,
 * return type). Null when there is nothing to compare.
 */
export function signatureOf(...parts: Array<string | null | undefined>): string | undefined {
  const present = parts.filter((p): p is string => !!p);
  return present.length ? present.join('').replace(/\s{2,}/g, ' ').trim() : undefined;
}

/**
 * Nodes that are never part of how a function is called, in any grammar:
 * its body, its modifiers and annotations, and the keyword that declares it.
 */
const NOT_HEADER = new Set([
  // bodies
  'block', 'function_body', 'body_statement', 'compound_statement', 'constructor_body', 'arrow_expression_clause',
  // modifiers, visibility, annotations and attributes
  'modifiers', 'modifier', 'visibility_modifier', 'static_modifier', 'abstract_modifier', 'final_modifier',
  'readonly_modifier', 'function_modifiers', 'attribute_list', 'annotation', 'marker_annotation', 'attribute',
  // declaring keywords, and what ends a declaration
  'fn', 'fun', 'func', 'def', 'function', 'end', ';',
]);

/**
 * A function's signature from its header (Phase 32 A2.7): every token of
 * the declaration but its name, body, modifiers and declaring keyword, in
 * the order the language writes them. So type parameters, parameters, the
 * return type and what it throws are in it, wherever the grammar puts them
 * (Java's return type before the name, Kotlin's receiver, Swift's `throws`),
 * and comments and layout are not. `skipFields` leaves out named parts that
 * are identity rather than shape (Go's receiver, which the symbol's name
 * already carries).
 */
export function headerSignature(node: SyntaxNode, skipFields: readonly string[] = []): string | undefined {
  const name = node.childForFieldName('name');
  // What comes before the name (Java's and C#'s return type) and after it,
  // shaped apart so the two do not run together where the name was.
  const before: SyntaxNode[] = [];
  const after: SyntaxNode[] = [];
  let seenName = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (name && child.startIndex === name.startIndex && child.endIndex === name.endIndex) { seenName = true; continue; }
    if (NOT_HEADER.has(child.type)) continue;
    const field = node.fieldNameForChild(i);
    if (field === 'body' || (field && skipFields.includes(field))) continue;
    (seenName ? after : before).push(child);
  }
  const text = [shapeOfNodes(before), shapeOfNodes(after)].filter(Boolean).join(' ');
  return signatureOf(text);
}
