/**
 * Python callsite extractor.
 *
 * MVP focuses on the two route patterns that cover most modern Python
 * backends + the most common outbound HTTP pattern:
 *
 *   - FastAPI / APIRouter: `@router.get("/api/users")`,
 *     `@app.post("/api/users", ...)`
 *   - Flask: `@app.route("/api/users", methods=["GET", "POST"])`
 *   - Outbound: `requests.get("http://service/api/users")`
 *
 * Decorator patterns produce `http_route` callsites; outbound
 * `requests.*` produce `http_call` callsites.
 */

import type { CallsiteExtractor } from './base';
import type { Callsite } from '../../../shared/types';
import { lineOf, normalizeRoute, normalizeUrl, isLikelyApiPath } from './shared';

// Examples we want to catch:
//   @router.get("/users")
//   @app.post("/users", response_model=...)
//   @api.delete("/users/{user_id}")
const FASTAPI_DECORATOR_RE =
  /@(?:\w+\.)?(get|post|put|patch|delete|head|options)\s*\(\s*([`'"])([^`'"]+?)\2/gi;

// Flask pattern with explicit methods= list.
//   @app.route("/users", methods=["GET", "POST"])
const FLASK_ROUTE_RE =
  /@(?:\w+\.)?route\s*\(\s*([`'"])([^`'"]+?)\1(?:[\s\S]*?methods\s*=\s*\[([^\]]+)\])?/gi;

// Outbound HTTP via requests library.
//   requests.get("http://example/api/users")
const REQUESTS_RE =
  /\brequests\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*([`'"])([^`'"]+?)\2/gi;

export const pythonCallsites: CallsiteExtractor = {
  language: 'python',
  extract(content, _filePath) {
    const out: Callsite[] = [];
    for (const cs of iterateFastApi(content)) out.push(cs);
    for (const cs of iterateFlask(content)) out.push(cs);
    for (const cs of iterateRequests(content)) out.push(cs);
    return out;
  },
};

function* iterateFastApi(content: string): Iterable<Callsite> {
  FASTAPI_DECORATOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FASTAPI_DECORATOR_RE.exec(content))) {
    yield {
      kind: 'http_route',
      protocol: 'http',
      line: lineOf(content, m.index),
      method: m[1].toUpperCase(),
      urlPattern: normalizeRoute(m[3]),
      context: `@${m[1]}`,
    };
  }
}

function* iterateFlask(content: string): Iterable<Callsite> {
  FLASK_ROUTE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FLASK_ROUTE_RE.exec(content))) {
    const url = m[2];
    const methodsRaw = m[3] ?? '';
    const methods = methodsRaw
      ? methodsRaw.split(',').map((s) => s.replace(/['"`\s]/g, '').toUpperCase()).filter(Boolean)
      : ['GET'];
    for (const method of methods) {
      yield {
        kind: 'http_route',
        protocol: 'http',
        line: lineOf(content, m.index),
        method,
        urlPattern: normalizeRoute(url),
        context: '@app.route',
      };
    }
  }
}

function* iterateRequests(content: string): Iterable<Callsite> {
  REQUESTS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REQUESTS_RE.exec(content))) {
    const url = m[3];
    const verb = m[1].toUpperCase();
    if (!isLikelyApiPath(url)) continue;
    yield {
      kind: 'http_call',
      protocol: 'http',
      line: lineOf(content, m.index),
      method: verb,
      urlPattern: normalizeUrl(url),
      context: `requests.${verb.toLowerCase()}`,
    };
  }
}
