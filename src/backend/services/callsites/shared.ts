/**
 * Helpers shared by every callsite extractor — Phase 28.
 *
 * ## Why these are shared rather than copied
 *
 * `cross-system-service` pairs an outbound call to an inbound route by
 * **exact string equality** on `` `${METHOD} ${urlPattern}` ``. There is
 * no fuzzy fallback (deliberately — the comment there says false
 * positives erode trust faster than missed pairs). So normalisation is
 * not a per-language convenience: it is the matching contract, and two
 * languages that normalise differently simply never pair.
 *
 * They had already drifted. Go collapsed `:userID` to `:id`; Python did
 * not, so a Python route declared `/api/users/{id}` and a Go client
 * calling the same endpoint agreed, while a Python route written
 * `/users/:user_id` and a Go one written `/users/:id` did not. `lineOf`
 * was copied verbatim into three files. Adding four more languages
 * would have made that seven copies of a contract that only works when
 * all seven agree.
 *
 * The canonical form:
 *
 *   - protocol and host stripped — the matcher compares paths;
 *   - every path parameter is `:id`, whatever the framework spells it
 *     (`{id}`, `{user_id}`, `:userID`, `${id}`, `<int:pk>`, `%s`);
 *   - querystring dropped;
 *   - no trailing slash, except the root `/`.
 */

import type { Callsite } from '../../../shared/types';

export const HTTP_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export const VERB_SET: ReadonlySet<string> = new Set<string>(HTTP_VERBS);

/** 1-indexed line number of a character offset. */
export function lineOf(content: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Join a router prefix to a route literal.
 *
 * Grouped routers are the norm in every framework family here — chi's
 * `Route`, gin's `Group`, ASP.NET's `MapGroup`, Ktor's `route`, Rails'
 * `namespace`, Spring's class-level `@RequestMapping`. Reporting the
 * tail alone gives `/users` where the real route is `/api/v1/users`,
 * which is worse than reporting nothing: it pairs with the wrong thing.
 */
export function joinPath(prefix: string, literal: string): string {
  if (!prefix) return literal;
  if (!literal || literal === '/') return prefix;
  const left = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const right = literal.startsWith('/') ? literal : '/' + literal;
  return left + right;
}

/** Canonicalise an inbound route pattern. See the header. */
export function normalizeRoute(url: string): string {
  let p = url;
  // `${id}` (JS template literal) before `{id}`, or the `$` is orphaned.
  p = p.replace(/\$\{[^}]*\}/g, ':id');
  // `<int:pk>` / `<slug>` — Django and Flask's converter syntax.
  p = p.replace(/<[^>]*>/g, ':id');
  // `{id}` / `{user_id}` / `{*rest}` — FastAPI, chi, ASP.NET, Spring.
  p = p.replace(/\{[^}]*\}/g, ':id');
  // `:userID` / `:user_id` — gin, echo, Express, Rails.
  p = p.replace(/:[A-Za-z_]\w*/g, ':id');
  // A trailing wildcard is not part of the path being matched.
  p = p.replace(/\/?\*+$/, '');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (!p) return '/';
  // A route is a path from the application root, and some frameworks
  // let you leave the leading slash off — ASP.NET's
  // `[Route("api/[controller]")]`, Retrofit's `@GET("users")`, Rails'
  // `get 'orders'`. The matcher compares exact strings, so a route
  // stored as `api/orders` can never pair with a call to `/api/orders`:
  // it would look like an endpoint nobody calls next to a call nobody
  // serves, which is a more confusing graph than either being absent.
  return p.startsWith('/') ? p : '/' + p;
}

/** Canonicalise an outbound call URL to the same form as a route. */
export function normalizeUrl(url: string): string {
  let p = url.replace(/^https?:\/\/[^/]+/, '');
  // A leading format placeholder is the host that was interpolated:
  // `fmt.Sprintf("%s/api/x", base)`, `"\(baseURL)/api/x"`, `"#{base}/api/x"`.
  p = p.replace(/^(?:%[sv]|\\\([^)]*\)|#\{[^}]*\}|\$\{[^}]*\})/, '');
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  // Interpolated values elsewhere in the path are path parameters, and these
  // MUST run before normalizeRoute. Its bare `{...}` rule matches the braces
  // of Ruby's `#{id}` and leaves the `#` stranded, so the path came out as
  // `/api/orders/#:id` and could never pair with the route `/api/orders/:id`.
  // No Ruby call with a path parameter could be matched at all.
  p = p.replace(/%[sdv]/g, ':id');
  p = p.replace(/\\\([^)]*\)/g, ':id');
  p = p.replace(/#\{[^}]*\}/g, ':id');
  p = normalizeRoute(p);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * Whether a string is worth reporting as an outbound HTTP target.
 *
 * Without this every string literal passed to something called `get`
 * becomes a callsite. A path-shaped or URL-shaped literal is the signal.
 *
 * **[changed in Phase 28]** The Go extractor used to require an absolute
 * URL to contain `/api/` before reporting it, so
 * `http.Get("https://example.com/status")` was dropped as noise. That
 * also dropped real internal coupling: a call to
 * `http://billing/ledger` is exactly the edge this product exists to
 * draw, and plenty of services do not put `/api/` in their paths.
 *
 * Absolute URLs are now kept. The cost is bounded: `cross-system-service`
 * only creates an edge when method and path match a route found in the
 * *same scan*, so a call to a genuinely external host produces a stored
 * callsite and no edge — it never invents a relationship. The benefit is
 * every internal service whose paths are not `/api/`-prefixed.
 */
export function isLikelyApiPath(s: string): boolean {
  if (!s) return false;
  if (s.startsWith('/')) return true;
  if (/^https?:\/\//.test(s)) {
    // ...but not a bare origin. `normalizeUrl` strips the host, so
    // `https://status.example.com` and `https://fonts.googleapis.com/` both
    // normalise to "/" — and the matcher keys on the path alone, so they pair
    // with any route registered at the root, of any service. That is an edge
    // between two things that have nothing to do with each other, drawn from a
    // font CDN. A bare origin also carries no path to couple on, so there is
    // nothing lost in dropping it.
    const afterHost = s.replace(/^https?:\/\/[^/]+/, '');
    return afterHost !== '' && afterHost !== '/';
  }
  // The literal begins with an interpolated host: `%s/api/x`,
  // `\(base)/api/x`, `#{base}/api/x`, `${base}/api/x`.
  if (/^(?:%[sv]|\\\([^)]*\)|#\{[^}]*\}|\$\{[^}]*\})\//.test(s)) return true;
  return false;
}

/**
 * Receivers that are never an HTTP client, however much `.get("…")`
 * looks like one.
 *
 * Two languages independently needed this and only one had it. Ruby's
 * `Hash#[]` alternatives and ActiveRecord scopes share the spelling, so
 * `cache.get('session-key')` read as an outbound call; on the JVM the
 * same shape is Spring's MockMvc test DSL — `mockMvc.get("/api/orders")`
 * is a *test asserting on a route this service owns*, and reading it as
 * an outbound call draws a service→itself edge sourced from a test file.
 *
 * The set lives here rather than in either extractor because the next
 * language to add a `receiver.verb("literal")` rule will need it too,
 * and a per-language copy is how the two drifted in the first place.
 */
const NON_CLIENT_RECEIVERS = new Set([
  // Containers and config, in every language.
  'params', 'options', 'opts', 'config', 'configuration', 'settings', 'props',
  'properties', 'preferences', 'prefs', 'headers', 'env', 'session', 'cookies',
  'cache', 'store', 'storage', 'hash', 'map', 'dict', 'data', 'payload',
  'attributes', 'attrs', 'json', 'body', 'registry', 'context', 'bundle',
  // JVM test DSLs that spell an assertion like a call.
  'mockmvc', 'mvc', 'mockserver', 'stubfor',
]);

/** True when `recv.verb("…")` must not be read as an outbound HTTP call. */
export function isNonClientReceiver(recv: string): boolean {
  return NON_CLIENT_RECEIVERS.has(recv.toLowerCase());
}

/**
 * Strip a trailing line comment, without cutting inside a string —
 * `"http://x"` contains the `//` marker.
 */
export function stripLineComment(line: string, marker: string): string {
  const idx = line.indexOf(marker);
  if (idx === -1) return line;
  const before = line.slice(0, idx);
  const doubles = (before.match(/"/g) || []).length;
  const singles = (before.match(/'/g) || []).length;
  return doubles % 2 === 0 && singles % 2 === 0 ? before : line;
}

/** Net change in brace depth across a line, ignoring braces in strings. */
export function countBraces(line: string): number {
  let delta = 0;
  let inString: string | null = null;
  let prev = '';
  for (const ch of line) {
    if ((ch === '"' || ch === '\'') && prev !== '\\') {
      if (inString === ch) inString = null;
      else if (inString === null) inString = ch;
    } else if (!inString && ch === '{') delta++;
    else if (!inString && ch === '}') delta--;
    prev = ch;
  }
  return delta;
}

/**
 * A prefix that applies to everything inside a block, popped when the
 * scan returns to the depth the block opened at.
 *
 * Used by every framework whose grouping is a closure rather than a
 * variable: chi's `Route`, Ktor's `route`, Rails' `namespace`, ASP.NET
 * minimal-API groups used inline.
 */
export interface BlockPrefix {
  /** Brace (or block) depth at which this prefix stops applying. */
  depth: number;
  prefix: string;
}

/** Drop block prefixes whose scope the scan has left. */
export function unwindBlocks(stack: BlockPrefix[], depth: number): string {
  while (stack.length > 0 && depth < stack[stack.length - 1].depth) stack.pop();
  return stack.length > 0 ? stack[stack.length - 1].prefix : '';
}

/** Build an `http_route` with the canonical normalisation applied. */
export function route(
  line: number,
  method: string,
  pattern: string,
  context: string,
): Callsite {
  return {
    kind: 'http_route',
    protocol: 'http',
    line,
    method: method.toUpperCase(),
    urlPattern: normalizeRoute(pattern),
    context,
  };
}

/** Build an `http_call` with the canonical normalisation applied. */
export function call(
  line: number,
  method: string,
  url: string,
  context: string,
): Callsite {
  return {
    kind: 'http_call',
    protocol: 'http',
    line,
    method: method.toUpperCase(),
    urlPattern: normalizeUrl(url),
    context,
  };
}
