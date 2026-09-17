/**
 * Callsite extractor registry. Mirrors the parsers/ + resolvers/ shape
 * — adding a new language's callsite extraction = drop a file, list
 * it here.
 */

import type { CallsiteExtractor } from './base';
import type { SupportedLanguage } from '../../../shared/types';
import { typescriptCallsites, javascriptCallsites } from './typescript';
import { pythonCallsites } from './python';
import { goCallsites } from './go';

export const CALLSITE_EXTRACTORS: ReadonlyArray<CallsiteExtractor> = [
  typescriptCallsites,
  javascriptCallsites,
  pythonCallsites,
  goCallsites,
];

const BY_LANGUAGE = (() => {
  const map = new Map<SupportedLanguage, CallsiteExtractor>();
  for (const e of CALLSITE_EXTRACTORS) map.set(e.language, e);
  return map;
})();

export function getCallsiteExtractor(language: SupportedLanguage): CallsiteExtractor | null {
  return BY_LANGUAGE.get(language) ?? null;
}

export type { CallsiteExtractor } from './base';
