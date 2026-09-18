import type { CallsiteExtractor } from './base';
import type { Callsite } from '../../../shared/types';
import {
  VERB_SET, lineOf, joinPath, isLikelyApiPath, stripLineComment,
  countBraces, unwindBlocks, route, call, type BlockPrefix,
} from './shared';

/**
 * Kotlin callsite extractor — Phase 28.
 *
 * See [docs/PHASE-28-CALLSITE-EXPANSION.md](../../../../docs/PHASE-28-CALLSITE-EXPANSION.md).
 *
 * Inbound, the two server frameworks that cover almost all Kotlin:
 *
 *   Spring  @RequestMapping("/api/orders") on the class
 *           @GetMapping, @PostMapping("/{id}") on the handler
 *   Ktor    routing { route("/api") { get("/orders") { … } } }
 *
 * Outbound: Ktor's client, OkHttp's `.url(…)`, and Retrofit's `@GET`
 * interface annotations.
 *
 * ## The one genuinely ambiguous shape in this file
 *
 * Ktor spells a server route and a client call almost identically:
 *
 *   get("/api/orders") { … }          ← a route this service serves
 *   client.get("http://billing/api")  ← a call this service makes
 *
 * There is no annotation to tell them apart and no import we can see
 * from a regex. The rule used here is the one that matches how the two
 * are actually written:
 *
 *   - a **bare** verb call (no receiver) is a route — Ktor's routing
 *     DSL is an extension-function scope, so the server form never has
 *     one;
 *   - a verb call **with a receiver** is outbound, and then only if the
 *     literal is an absolute URL or api-shaped path.
 *
 * This misreads exactly one shape: `client.get("/api/x")` against a
 * pre-configured base URL is correctly outbound, but a route registered
 * through a captured `Route` receiver (`r.get("/x")`) would be read as
 * a call. That form is rare and the failure is a missing edge rather
 * than a wrong one, which is the direction to err in — see the Go
 * extractor's note on grouped routers for the same reasoning.
 */

/** `@RequestMapping("/api/orders")` — class level, or method level. */
const REQUEST_MAPPING_RE = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?\[?\s*"([^"]*)"/;

/** `method = [RequestMethod.GET, RequestMethod.POST]` inside it. */
const REQUEST_METHOD_RE = /RequestMethod\s*\.\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/g;

/** `@GetMapping`, `@PostMapping("/{id}")`. */
const VERB_MAPPING_RE = /@(Get|Post|Put|Patch|Delete)Mapping\s*(?:\(\s*(?:value\s*=\s*)?\[?\s*"([^"]*)")?/g;

/** `class OrdersController` / `object Orders`. */
const CLASS_RE = /\b(?:class|object|interface)\s+(\w+)/;

/** Ktor `route("/api") {` — block-scoped, like chi's `Route`. */
const KTOR_ROUTE_BLOCK_RE = /(?:^|[^.\w])route\s*\(\s*"([^"]*)"\s*\)\s*\{/;

/** Ktor bare verb — `get("/orders") {`. No receiver: see the header. */
const KTOR_VERB_RE = /(?:^|[^.\w])(get|post|put|patch|delete|head|options)\s*\(\s*"([^"]*)"\s*\)\s*\{/g;

/** `client.get("http://…")`, `httpClient.post("/api/x")`. */
const CLIENT_VERB_RE = /(\w+)\s*\.\s*(get|post|put|patch|delete|head|options)\s*(?:<[^>]*>)?\s*\(\s*"([^"]*)"/g;

/** OkHttp: `.url("http://…")`. */
const OKHTTP_URL_RE = /\.\s*url\s*\(\s*"([^"]*)"/g;

/** Retrofit: `@GET("users")`, `@POST("orders/{id}")`. */
const RETROFIT_RE = /@(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*"([^"]*)"\s*\)/g;

export const kotlinCallsites: CallsiteExtractor = {
  language: 'kotlin',
  extract(content, _filePath) {
    return [...extractRoutes(content), ...extractOutbound(content)];
  },
};

// ── Inbound ─────────────────────────────────────────────────────────

function extractRoutes(content: string): Callsite[] {
  const lines = content.split('\n').map((l) => stripLineComment(l, '//'));
  const out: Callsite[] = [];

  const blockStack: BlockPrefix[] = [];
  let depth = 0;
  // Spring's class-level `@RequestMapping` is a prefix for every
  // handler in the class — the same role chi's `Route` block plays.
  let classPrefix = '';
  let pendingMapping: { path: string; verbs: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const depthBefore = depth;
    depth += countBraces(line);
    const blockPrefix = unwindBlocks(blockStack, depthBefore);

    // ── Spring ──
    const mapping = REQUEST_MAPPING_RE.exec(line);
    if (mapping) {
      REQUEST_METHOD_RE.lastIndex = 0;
      const verbs: string[] = [];
      let vm: RegExpExecArray | null;
      while ((vm = REQUEST_METHOD_RE.exec(line))) verbs.push(vm[1]);
      pendingMapping = { path: mapping[1], verbs };
    }

    const classDecl = CLASS_RE.exec(line);
    if (classDecl) {
      // A `@RequestMapping` directly above a class declares its prefix
      // rather than a route of its own.
      classPrefix = pendingMapping ? pendingMapping.path : '';
      pendingMapping = null;
      continue;
    }

    VERB_MAPPING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let sawVerbMapping = false;
    while ((m = VERB_MAPPING_RE.exec(line))) {
      sawVerbMapping = true;
      out.push(route(lineNo, m[1], joinPath(classPrefix, m[2] ?? ''), `@${m[1]}Mapping`));
    }
    if (sawVerbMapping) {
      pendingMapping = null;
      continue;
    }

    // A method-level `@RequestMapping` with explicit verbs is a route.
    if (pendingMapping && pendingMapping.verbs.length > 0) {
      for (const verb of pendingMapping.verbs) {
        out.push(route(lineNo, verb, joinPath(classPrefix, pendingMapping.path), '@RequestMapping'));
      }
      pendingMapping = null;
      continue;
    }

    // ── Ktor ──
    const routeBlock = KTOR_ROUTE_BLOCK_RE.exec(line);
    if (routeBlock) {
      blockStack.push({ depth: depthBefore + 1, prefix: joinPath(blockPrefix, routeBlock[1]) });
    }

    KTOR_VERB_RE.lastIndex = 0;
    while ((m = KTOR_VERB_RE.exec(line))) {
      const [, verb, literal] = m;
      out.push(route(lineNo, verb, joinPath(blockPrefix, literal), `ktor ${verb}`));
    }
  }

  return out;
}

// ── Outbound ────────────────────────────────────────────────────────

function extractOutbound(content: string): Callsite[] {
  const out: Callsite[] = [];
  let m: RegExpExecArray | null;

  CLIENT_VERB_RE.lastIndex = 0;
  while ((m = CLIENT_VERB_RE.exec(content))) {
    const [, recv, verb, url] = m;
    if (!isLikelyApiPath(url)) continue;
    out.push(call(lineOf(content, m.index), verb, url, `${recv}.${verb}`));
  }

  OKHTTP_URL_RE.lastIndex = 0;
  while ((m = OKHTTP_URL_RE.exec(content))) {
    const url = m[1];
    if (!isLikelyApiPath(url)) continue;
    // OkHttp's verb lives on the builder (`.get()`, `.post(body)`) and
    // defaults to GET when nothing is set, which is what the library
    // itself does — not a guess about the caller's intent.
    out.push(call(lineOf(content, m.index), 'GET', url, 'okhttp .url'));
  }

  RETROFIT_RE.lastIndex = 0;
  while ((m = RETROFIT_RE.exec(content))) {
    const [, verb, url] = m;
    if (!VERB_SET.has(verb)) continue;
    // Retrofit paths are relative to the client's base URL and are
    // routinely written without a leading slash; `normalizeRoute` adds
    // one so they pair with the server's absolute form.
    out.push(call(lineOf(content, m.index), verb, url.startsWith('/') ? url : '/' + url, `@${verb} (Retrofit)`));
  }

  return out;
}
