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
