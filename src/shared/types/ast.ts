export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java';

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

export interface ParsedFile {
  path: string;
  contentHash: string;
  language: SupportedLanguage;
  symbols: ParsedSymbol[];
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
}
