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
