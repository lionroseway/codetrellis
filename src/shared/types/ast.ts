export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'php'
  | 'ruby'
  /**
   * SQL is not a parser-plugin language — it has no import graph, so it
   * has no resolver and never appears in `parsers/index.ts`. It is here
   * because a `.sql` file still produces symbols (its tables) and those
   * have to be stored with a language tag like anything else. See
   * `services/sql/` and docs/PHASE-21-SQL-REF-TRACKER.md.
   */
  | 'sql';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'variable'
  | 'enum';

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  children: ParsedSymbol[];
  modifiers: string[];
}

export interface ImportDeclaration {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespace: boolean;
  resolvedPath?: string;
}

export interface ExportDeclaration {
  name: string;
  kind: SymbolKind;
  isDefault: boolean;
}

/**
 * A non-import callsite — HTTP fetch, route handler, SQL query,
 * subprocess invocation. Used by the cross-system matcher to surface
 * runtime coupling between systems that don't share imports.
 */
export type CallsiteKind = 'http_call' | 'http_route' | 'sql_query' | 'subprocess' | 'env_lookup';
export type CallsiteProtocol = 'http' | 'sql' | 'subprocess' | 'env';

export interface Callsite {
  kind: CallsiteKind;
  protocol: CallsiteProtocol;
  /** Line in the source file (1-indexed). */
  line: number;
  // HTTP specifics
  method?: string;        // 'GET' / 'POST' / 'PUT' / 'DELETE' / 'PATCH'
  urlPattern?: string;    // '/api/users', '/api/users/:id'
  // SQL specifics (later phases)
  sqlText?: string;
  // Free-form context (function name, decorator name, etc.)
  context?: string;
}

export interface ParsedFile {
  path: string;
  contentHash: string;
  language: SupportedLanguage;
  symbols: ParsedSymbol[];
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
  callsites: Callsite[];
}
