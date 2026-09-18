import path from 'node:path';
import type { ParserPlugin } from './base';
import { typescriptPlugin, tsxPlugin, javascriptPlugin } from './typescript';
import { pythonPlugin } from './python';
import { rustPlugin } from './rust';
import { phpPlugin } from './php';
import { javaPlugin } from './java';
import { goPlugin } from './go';
import { rubyPlugin } from './ruby';
import { csharpPlugin } from './csharp';
import { kotlinPlugin } from './kotlin';
import { swiftPlugin } from './swift';

/**
 * Registry of every language plugin CodeTrellis ingests.
 *
 * Adding a new language: write a new `parsers/<lang>.ts` exporting a
 * `ParserPlugin`, drop it in this list. Make sure
 * `resources/tree-sitter/<grammar>.wasm` exists too. No other code
 * changes needed — the AST orchestrator picks up the plugin via
 * `getPluginForFile`.
 */
export const PARSER_PLUGINS: ReadonlyArray<ParserPlugin> = [
  typescriptPlugin,
  tsxPlugin,
  javascriptPlugin,
  pythonPlugin,
  rustPlugin,
  phpPlugin,
  javaPlugin,
  goPlugin,
  rubyPlugin,
  csharpPlugin,
  kotlinPlugin,
  swiftPlugin,
];

const EXTENSION_INDEX = (() => {
  const map = new Map<string, ParserPlugin>();
  for (const plugin of PARSER_PLUGINS) {
    for (const ext of plugin.extensions) {
      map.set(ext.toLowerCase(), plugin);
    }
  }
  return map;
})();

export function getPluginForFile(filePath: string): ParserPlugin | null {
  return EXTENSION_INDEX.get(path.extname(filePath).toLowerCase()) ?? null;
}

export function listPluginExtensions(): string[] {
  return [...EXTENSION_INDEX.keys()];
}

export type { ParserPlugin } from './base';

/**
 * Languages the scanner will tag but that no parser claims — Phase 27.
 *
 * This exists because the same bug has now shipped three times, and it
 * never announces itself:
 *
 *   - `.py` / `.rs` / `.php` / `.java` missing from the file-watcher's
 *     extension list, so edits stopped re-parsing;
 *   - `.go` missing from the same list when Go was added;
 *   - `'ruby'` present in `SupportedLanguage` and `.rb` present in the
 *     scanner's `LANG_MAP` with **no parser behind either**, so a Rails
 *     repository rendered as a constellation of empty nodes.
 *
 * Every instance was a hand-maintained list falling out of sync with
 * another one, and in every instance nothing failed — the graph just went
 * quietly, confidently wrong. A language that is *declared* but not
 * *parsed* is worse than one that is absent, because the absence is
 * visible and the emptiness is not.
 *
 * Called at startup. It reports rather than throws: refusing to boot over
 * a cosmetic mismatch would be a worse failure than the one it prevents.
 */
export function findUnparsedLanguages(
  taggedLanguages: ReadonlyArray<string>,
): string[] {
  const parsed = new Set<string>(PARSER_PLUGINS.map((p) => p.language));
  // Languages the scanner tags that are deliberately not parser-backed.
  // SQL has no import graph and is handled by services/sql/ ahead of the
  // tree-sitter dispatch; the rest are data/markup, tagged for display
  // only and never claimed to have symbols.
  const intentionallyUnparsed = new Set([
    'sql', 'json', 'css', 'html', 'markdown', 'yaml', 'toml',
  ]);

  return [...new Set(taggedLanguages)]
    .filter((lang) => !parsed.has(lang) && !intentionallyUnparsed.has(lang))
    .sort();
}
