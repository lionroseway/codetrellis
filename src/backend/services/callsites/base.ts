/**
 * Per-language callsite extractor contract.
 *
 * Callsites are the non-import couplings between systems: an HTTP
 * `fetch('/api/users')` in a TS frontend is paired with a Python
 * `@router.get('/api/users')` to produce a cross-system edge. The
 * matcher lives in `matchers/<protocol>.ts`; this contract is just
 * the per-language extraction step.
 *
 * MVP uses regex over file content — pragmatic and ships the swf
 * "TS frontend ↔ Python backend" demo. We can switch to AST
 * walking per language later for accuracy without changing this
 * shape.
 */

import type { Callsite, SupportedLanguage } from '../../../shared/types';

export interface CallsiteExtractor {
  language: SupportedLanguage;
  extract(content: string, filePath: string): Callsite[];
}
