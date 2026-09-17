import fs from 'node:fs';
import path from 'node:path';
import type { ParsedFile, SupportedLanguage } from '../../shared/types';
import { createHash } from 'node:crypto';
import { PARSER_PLUGINS, getPluginForFile, type ParserPlugin } from './parsers';
import { getCallsiteExtractor } from './callsites';

/**
 * Dynamically load `web-tree-sitter` — same pattern as sql.js in
 * services/database.ts. The library does Emscripten-style global-
 * environment shenanigans that don't survive Vite's bundling, so we
 * mark it external (vite.main.config.ts) and require it at runtime
 * from `node_modules` (dev) or `process.resourcesPath` (packaged).
 */
function loadWebTreeSitter(): any {
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  if (resourcesPath) {
    // web-tree-sitter v0.26+ ships a CJS entry named
    // `web-tree-sitter.cjs` alongside its ESM `.js` variant. The
    // packaged app has the whole package at
    // `<resources>/web-tree-sitter/`.
    const packaged = path.join(resourcesPath, 'web-tree-sitter', 'web-tree-sitter.cjs');
    if (fs.existsSync(packaged)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(packaged);
    }
  }
  // Computed string keeps Vite from statically resolving + bundling.
  const wtsName = 'web-tree' + '-sitter';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(wtsName);
}

const TreeSitterModule: any = loadWebTreeSitter();
const TreeSitter = TreeSitterModule.Parser || TreeSitterModule.default?.Parser || TreeSitterModule;
const Language = TreeSitterModule.Language || TreeSitter.Language;

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

// ============================================================
// PARSER LIFECYCLE — init, health tracking, reinit
// ============================================================

let initialized = false;
const parsersByGrammar = new Map<string, any>();

/**
 * How many `parser.parse()` calls since last init. WASM tree-sitter
 * accumulates internal memory pressure that, after thousands of
 * parses, can trigger "RuntimeError: memory access out of bounds".
 * We proactively reinitialise before reaching that threshold.
 */
let parsesSinceInit = 0;

/**
 * Parse budget — reinitialise the WASM parsers after this many
 * `parse()` calls. Empirically, corruption appears around 4000+
 * parses in a single process lifetime. A budget of 2000 gives a 2×
 * safety margin. Each full scan of CodeTrellis itself is ~200 files,
 * so this allows ~10 full scans before a proactive recycle.
 */
const PARSE_BUDGET = 2000;

/**
 * How many consecutive parse errors before we declare the parser
 * unhealthy and force a reinitialisation.
 */
const MAX_CONSECUTIVE_ERRORS = 3;
let consecutiveParseErrors = 0;

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

  await loadGrammars();

  initialized = true;
  parsesSinceInit = 0;
  consecutiveParseErrors = 0;
  console.log(`[AST] Initialized with grammars: ${[...parsersByGrammar.keys()].join(', ')}`);
}

/**
 * Load (or reload) all grammar WASM files into fresh parser instances.
 */
async function loadGrammars(): Promise<void> {
  // Delete existing parser instances so the WASM GC can reclaim
  // their internal buffers.
  parsersByGrammar.clear();

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
}

/**
 * Reinitialise all parser instances. Called when:
 * - the parse budget is exhausted (proactive)
 * - consecutive parse errors suggest WASM memory corruption (reactive)
 *
 * This discards every parser and reloads grammars from WASM. The
 * TreeSitter.init() call is NOT repeated — the WASM runtime itself
 * persists; only per-language parser objects are recycled.
 */
export async function reinitParsers(): Promise<void> {
  console.log(`[AST] Reinitialising parsers (${parsesSinceInit} parses since last init)`);
  await loadGrammars();
  parsesSinceInit = 0;
  consecutiveParseErrors = 0;
  console.log(`[AST] Parsers reinitialised: ${[...parsersByGrammar.keys()].join(', ')}`);
}

// ============================================================
// PARSING — with health checks
// ============================================================

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

/**
 * Largest source file we will hand to tree-sitter.
 *
 * Phase 19, finding 24. There was already a cap on CALLSITE extraction, but
 * it applied AFTER the parse — so a pathological file still went through
 * tree-sitter first, and the quadratic behaviour that made it pathological
 * had already happened. Capping the parse is the part that actually bounds
 * the work.
 *
 * 2 MiB is far above anything hand-written: the largest source file in this
 * repository is a fraction of it, and generated bundles (the 500KB xterm
 * bundle, minified vendor output) still fit. A file bigger than this is
 * machine-generated, and its symbols are not worth a stalled backend.
 *
 * Skipping is the correct behaviour rather than truncating: half a parse
 * produces confidently wrong symbols and edges, which is worse than none.
 */
const MAX_PARSE_BYTES = 2 * 1024 * 1024;

function parseSource(filePath: string, content: string): ParsedFile | null {
  const dispatch = dispatchParser(filePath);
  if (!dispatch) return null;
  const { plugin, parser } = dispatch;

  // Budget the PARSE, not just what happens afterwards. The backend runs
  // tree-sitter synchronously in the Express process, so an unbounded parse
  // is an unbounded stall for every request, not just for this scan.
  const byteLength = Buffer.byteLength(content, 'utf-8');
  if (byteLength > MAX_PARSE_BYTES) {
    console.warn(
      `[AST] Skipping ${filePath} — ${(byteLength / 1024 / 1024).toFixed(1)} MB exceeds the ` +
        `${MAX_PARSE_BYTES / 1024 / 1024} MB parse budget. Symbols and edges for this file ` +
        'will be absent; it is almost certainly generated.',
    );
    return null;
  }

  let tree: any;
  try {
    tree = parser.parse(content);
    parsesSinceInit++;
    consecutiveParseErrors = 0; // healthy parse — reset error streak
  } catch (err) {
    consecutiveParseErrors++;
    const msg = String(err);
    if (msg.includes('memory access out of bounds') || msg.includes('RuntimeError')) {
      console.error(`[AST] WASM memory error parsing ${filePath} (${consecutiveParseErrors} consecutive errors, ${parsesSinceInit} total parses)`);
    } else {
      console.warn(`[AST] Parse error for ${filePath}:`, err);
    }
    return null;
  }

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
 * Compute a content hash for a file without parsing it. Used by
 * incremental scan to decide which files need re-parsing.
 */
export function computeFileHash(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return createHash('md5').update(content).digest('hex');
  } catch {
    return null;
  }
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
 * Yield to the event loop so HTTP / WebSocket / MCP connections stay
 * responsive during long CPU-bound work.  `setImmediate` fires after
 * the I/O poll phase; this is the cheapest way to let queued network
 * callbacks execute.
 */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/**
 * How many files to parse before yielding. Each file is a synchronous
 * `readFileSync` + tree-sitter WASM `parser.parse()`. A batch of 8
 * takes ~20-40ms on typical source files, which keeps the event loop
 * responsive without adding excessive scheduling overhead.
 */
const PARSE_BATCH_SIZE = 8;

/**
 * Parse all source files in a list. Returns only files that could be parsed.
 *
 * Yields to the event loop every PARSE_BATCH_SIZE files so the server
 * can serve HTTP requests, answer WebSocket pings, and send MCP SSE
 * heartbeats during large scans.
 *
 * Includes three durability layers:
 * 1. Proactive reinit when the parse budget is near-exhausted
 * 2. Reactive reinit when consecutive errors suggest WASM corruption
 * 3. Single retry after reinit so transient corruption doesn't lose data
 */
export async function parseFiles(filePaths: string[]): Promise<ParsedFile[]> {
  await initParser();

  // Layer 1: proactive reinit — if we're close to budget, recycle now
  // before starting the batch. Cheaper than hitting corruption mid-scan.
  if (parsesSinceInit + filePaths.length > PARSE_BUDGET) {
    await reinitParsers();
  }

  const results: ParsedFile[] = [];
  for (let i = 0; i < filePaths.length; i++) {
    let parsed = parseFile(filePaths[i]);

    // Layer 2: reactive reinit — consecutive errors mean the WASM
    // parser is in a bad state. Reinitialise and retry the failed file.
    if (!parsed && consecutiveParseErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.warn(`[AST] ${MAX_CONSECUTIVE_ERRORS} consecutive parse errors — reinitialising parsers`);
      await reinitParsers();
      // Layer 3: retry once after reinit
      parsed = parseFile(filePaths[i]);
      if (!parsed) {
        // Still failing after reinit — likely a file-specific issue,
        // not WASM corruption. Reset the error counter so we don't
        // reinit again on the next file.
        consecutiveParseErrors = 0;
      }
    }

    if (parsed) results.push(parsed);

    // Yield every N files so the event loop isn't starved
    if ((i + 1) % PARSE_BATCH_SIZE === 0) {
      await yieldToEventLoop();
    }
  }
  return results;
}

/**
 * Return current parser health stats for diagnostics.
 */
export function getParserHealth(): {
  initialized: boolean;
  parsesSinceInit: number;
  parseBudget: number;
  consecutiveErrors: number;
  loadedGrammars: string[];
} {
  return {
    initialized,
    parsesSinceInit,
    parseBudget: PARSE_BUDGET,
    consecutiveErrors: consecutiveParseErrors,
    loadedGrammars: [...parsersByGrammar.keys()],
  };
}
