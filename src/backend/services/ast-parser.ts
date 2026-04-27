import fs from 'node:fs';
import path from 'node:path';
import * as TreeSitterModule from 'web-tree-sitter';
import type { ParsedFile, SupportedLanguage } from '../../shared/types';
import { createHash } from 'node:crypto';
import { PARSER_PLUGINS, getPluginForFile, type ParserPlugin } from './parsers';
import { getCallsiteExtractor } from './callsites';

const TreeSitter = (TreeSitterModule as any).Parser || (TreeSitterModule as any).default?.Parser || TreeSitterModule;
const Language = (TreeSitterModule as any).Language || TreeSitter.Language;

/**
 * Where the tree-sitter WASM grammars live at runtime. Two cases:
 *
 * 1. **Dev / web mode** — running from the repo via `tsx`. `__dirname`
 *    is `<repo>/src/backend/services`; grammars are at the repo's
 *    `resources/tree-sitter/`.
 * 2. **Packaged Electron app** — Forge's `extraResource` copies the
 *    `resources/tree-sitter/` dir verbatim into `process.resourcesPath`
 *    (i.e. `<app>/Contents/Resources/tree-sitter/` on macOS,
 *    `<app>/resources/tree-sitter/` on Windows + Linux).
 *
 * We probe both paths and use whichever exists. Keeps a single code
 * path for dev + production, no bundler magic required.
 */
const GRAMMAR_DIR = (() => {
  const dev = path.resolve(__dirname, '../../../resources/tree-sitter');
  if (fs.existsSync(dev)) return dev;
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  if (resourcesPath) {
    const packaged = path.join(resourcesPath, 'tree-sitter');
    if (fs.existsSync(packaged)) return packaged;
  }
  return dev; // last resort — caller will log a "grammar missing" warning
})();

let initialized = false;
const parsersByGrammar = new Map<string, any>();

/**
 * Initialize tree-sitter WASM runtime and load every plugin grammar
 * present in resources/tree-sitter/. Plugins whose grammar WASM is
 * missing are skipped (logged) so the rest still work.
 */
export async function initParser(): Promise<void> {
  if (initialized) return;

  await TreeSitter.init({
    locateFile: () => path.join(GRAMMAR_DIR, 'tree-sitter.wasm'),
  });

  for (const plugin of PARSER_PLUGINS) {
    if (parsersByGrammar.has(plugin.grammarKey)) continue;

    const grammarPath = path.join(GRAMMAR_DIR, plugin.grammarFile);
    if (!fs.existsSync(grammarPath)) {
      console.warn(`[AST] Skipping ${plugin.language} (${plugin.grammarKey}) — grammar missing at ${plugin.grammarFile}`);
      continue;
    }

    try {
      const language = await Language.load(grammarPath);
      const parser = new TreeSitter();
      parser.setLanguage(language);
      parsersByGrammar.set(plugin.grammarKey, parser);
    } catch (err) {
      console.warn(`[AST] Failed to load grammar for ${plugin.language}:`, err);
    }
  }

  initialized = true;
  console.log(`[AST] Initialized with grammars: ${[...parsersByGrammar.keys()].join(', ')}`);
}

/**
 * Get the parser plugin + tree-sitter parser instance for a file.
 * Returns null if the file's extension isn't claimed by any plugin or
 * its grammar isn't loaded.
 */
function dispatchParser(filePath: string): { plugin: ParserPlugin; parser: any } | null {
  const plugin = getPluginForFile(filePath);
  if (!plugin) return null;
  const parser = parsersByGrammar.get(plugin.grammarKey);
  if (!parser) return null;
  return { plugin, parser };
}

function parseSource(filePath: string, content: string): ParsedFile | null {
  const dispatch = dispatchParser(filePath);
  if (!dispatch) return null;
  const { plugin, parser } = dispatch;

  const tree = parser.parse(content);
  const root = tree.rootNode;

  const contentHash = createHash('md5').update(content).digest('hex');
  const symbols = plugin.extractSymbols(root);
  const imports = plugin.extractImports(root);
  const exports = plugin.extractExports?.(root) ?? [];

  // Extract non-import callsites (HTTP routes / fetches / SQL / etc.)
  // for the cross-system matcher. Best-effort — a missing extractor or
  // a regex error must not break the parse.
  let callsites = [] as ReturnType<NonNullable<ReturnType<typeof getCallsiteExtractor>>['extract']>;
  try {
    const extractor = getCallsiteExtractor(plugin.language as SupportedLanguage);
    if (extractor) callsites = extractor.extract(content, filePath);
  } catch (err) {
    console.warn(`[AST] Callsite extraction failed for ${filePath}:`, err);
  }

  return {
    path: filePath,
    contentHash,
    language: plugin.language as SupportedLanguage,
    symbols,
    imports,
    exports,
    callsites,
  };
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
