import path from 'node:path';
import type { ParserPlugin } from './base';
import { typescriptPlugin, tsxPlugin, javascriptPlugin } from './typescript';
import { pythonPlugin } from './python';
import { rustPlugin } from './rust';
import { phpPlugin } from './php';
import { javaPlugin } from './java';
import { goPlugin } from './go';

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
