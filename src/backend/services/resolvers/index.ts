import type { ResolverPlugin, ResolveContext } from './base';
import type { SupportedLanguage } from '../../../shared/types';
import { typescriptResolver } from './typescript';
import { pythonResolver } from './python';
import { rustResolver } from './rust';
import { phpResolver } from './php';
import { javaResolver } from './java';
import { goResolver } from './go';
import { rubyResolver } from './ruby';

/**
 * Registry of every per-language resolver. To add a language: write
 * `resolvers/<lang>.ts`, register it here, done. The dispatcher uses
 * the importing file's language to pick the right resolver.
 */
export const RESOLVER_PLUGINS: ReadonlyArray<ResolverPlugin> = [
  typescriptResolver,
  pythonResolver,
  rustResolver,
  phpResolver,
  javaResolver,
  goResolver,
  rubyResolver,
];

const RESOLVER_BY_LANGUAGE = (() => {
  const map = new Map<SupportedLanguage, ResolverPlugin>();
  for (const plugin of RESOLVER_PLUGINS) {
    for (const lang of plugin.languages) map.set(lang, plugin);
  }
  return map;
})();

export function getResolverForLanguage(lang: SupportedLanguage | string): ResolverPlugin | null {
  return RESOLVER_BY_LANGUAGE.get(lang as SupportedLanguage) ?? null;
}

export type { ResolverPlugin, ResolveContext } from './base';
