/**
 * TypeScript / JavaScript callsite extractor.
 *
 * MVP: matches the most common HTTP outbound patterns in a TS / JS
 * frontend (or Node service). We err on the side of false negatives —
 * better to miss a fancy pattern than to invent edges that aren't
 * really there.
 *
 * Patterns recognised:
 *   - `fetch('/api/users')` / `fetch('/api/users', { method: 'POST' })`
 *   - `axios.get('/api/users')` / `axios.post(...)` etc.
 *   - `await fetch(\`/api/users/${id}\`)` (template literal — pattern
 *     normalised to `/api/users/:id`)
 *
 * Skipped (for now): `apiClient.users.list()` (typed clients) — would
 * need OpenAPI manifest awareness to map back to a route.
 */

import type { CallsiteExtractor } from './base';
import type { Callsite } from '../../../shared/types';

const FETCH_RE = /\bfetch\s*\(\s*([`'"])([^`'"]+?)\1(?:\s*,\s*\{([\s\S]*?)\})?/g;
const AXIOS_RE = /\baxios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*([`'"])([^`'"]+?)\2/gi;
// Plain HTTP-method axios style: `axios({ url: '/api/users', method: 'GET' })` —
// skipped for MVP. Keep the regex set small and deterministic.

const METHOD_HINT_RE = /method\s*:\s*['"`](\w+)['"`]/i;

export const typescriptCallsites: CallsiteExtractor = {
  language: 'typescript',
  extract(content, _filePath) {
    return extractAll(content);
  },
};

export const javascriptCallsites: CallsiteExtractor = {
  language: 'javascript',
  extract(content, _filePath) {
    return extractAll(content);
  },
};

function extractAll(content: string): Callsite[] {
  const callsites: Callsite[] = [];
  for (const cs of iterateFetch(content)) callsites.push(cs);
  for (const cs of iterateAxios(content)) callsites.push(cs);
  return callsites;
}

function* iterateFetch(content: string): Iterable<Callsite> {
  // reset lastIndex on the global regex (each call is a fresh scan)
  FETCH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FETCH_RE.exec(content))) {
    const url = match[2];
    if (!isLikelyApiPath(url)) continue;
    const optsBody = match[3] ?? '';
    const methodMatch = METHOD_HINT_RE.exec(optsBody);
    yield {
      kind: 'http_call',
      protocol: 'http',
      line: lineOf(content, match.index),
      method: (methodMatch?.[1] || 'GET').toUpperCase(),
      urlPattern: normalizePath(url),
      context: 'fetch',
    };
  }
}

function* iterateAxios(content: string): Iterable<Callsite> {
  AXIOS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AXIOS_RE.exec(content))) {
    const verb = match[1].toUpperCase();
    const url = match[3];
    if (!isLikelyApiPath(url)) continue;
    yield {
      kind: 'http_call',
      protocol: 'http',
      line: lineOf(content, match.index),
      method: verb,
      urlPattern: normalizePath(url),
      context: `axios.${verb.toLowerCase()}`,
    };
  }
}

function isLikelyApiPath(s: string): boolean {
  // Accept absolute paths (`/api/...`, `/v1/...`) and full URLs that
  // include `/api`. Reject obvious non-routes (single words, hash IDs).
  if (!s) return false;
  if (s.startsWith('/')) return true;
  if (/^https?:\/\//.test(s) && /\/api\//.test(s)) return true;
  return false;
}

function normalizePath(url: string): string {
  // Strip protocol + host so the matcher only sees `/path`.
  let p = url;
  const proto = /^https?:\/\/[^/]+/;
  p = p.replace(proto, '');
  // Resolve template-literal placeholders (`${id}`) to `:id` so the
  // matcher can pair them with FastAPI's `{user_id}` style.
  p = p.replace(/\$\{[^}]+\}/g, ':id');
  // Trim querystring.
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  // Trim trailing slash for consistency (except root "/").
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function lineOf(content: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}
