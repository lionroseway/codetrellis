import type { CallsiteExtractor } from './base';
import type { Callsite } from '../../../shared/types';
import {
  VERB_SET, lineOf, joinPath, isLikelyApiPath, stripLineComment,
  countBraces, unwindBlocks, route, call, type BlockPrefix,
} from './shared';

/**
 * C# callsite extractor — Phase 28.
 *
 * See [docs/PHASE-28-CALLSITE-EXPANSION.md](../../../../docs/PHASE-28-CALLSITE-EXPANSION.md).
 *
 * Inbound, the two ways ASP.NET Core declares a route:
 *
 *   controllers   [Route("api/[controller]")] on the class
 *                 [HttpGet("{id}")]           on the action
 *   minimal APIs  app.MapGet("/api/orders", handler)
 *                 var g = app.MapGroup("/api"); g.MapGet("/orders", h)
 *
 * Outbound: `HttpClient` (`GetAsync`, `PostAsJsonAsync`, …),
 * `new HttpRequestMessage(HttpMethod.Get, "…")`, and Refit's `[Get("…")]`
 * interface attributes.
 *
 * ## `[controller]` is not decoration — it IS the path
 *
 * `[Route("api/[controller]")]` on `OrdersController` declares
 * `/api/orders`. The token is expanded by the framework from the class
 * name with the `Controller` suffix removed, lower-cased by convention.
 * An extractor that reported the literal would emit
 * `/api/[controller]` for **every controller in the project** — they
 * would all collapse to one meaningless pattern that pairs with
 * nothing, and the graph would show a single fake endpoint instead of
 * twenty real ones. So the token is resolved, the same way the Go
 * extractor resolves `r.Group("/api/v1")` rather than reporting
 * `/users`.
 *
 * `[action]` is expanded too, from the method name. `[area]` is not:
 * it comes from folder conventions or route data we cannot see, so a
 * route containing it is reported with the token intact rather than
 * guessed at.
 */

/** `[Route("api/[controller]")]`, `[Route("api/orders")]`. */
const ROUTE_ATTR_RE = /\[\s*Route\s*\(\s*"([^"]*)"\s*\)\s*\]/;

/** `public class OrdersController : ControllerBase`. */
const CLASS_RE = /\b(?:class|record)\s+(\w+)/;

/** `[HttpGet]`, `[HttpGet("{id}")]`, `[HttpPost("search")]`. */
const HTTP_ATTR_RE = /\[\s*Http(Get|Post|Put|Patch|Delete|Head|Options)\s*(?:\(\s*"([^"]*)"\s*\))?\s*\]/g;

/** The action method that an attribute sits above. */
const METHOD_DECL_RE = /\b(?:public|internal|protected|private)\s+[\w<>,[\]?\s]*?\b(\w+)\s*\(/;

/** `app.MapGet("/api/orders", …)`, `group.MapDelete("/{id}", …)`. */
const MAP_VERB_RE = /(\w+)\s*\.\s*Map(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*"([^"]*)"/g;

/** `app.MapMethods("/x", new[] { "GET", "POST" }, …)`. */
const MAP_METHODS_RE = /(\w+)\s*\.\s*MapMethods\s*\(\s*"([^"]*)"\s*,\s*[^)]*?\{([^}]*)\}/g;

/** `var admin = app.MapGroup("/api/admin");` */
const MAP_GROUP_RE = /(?:var|\w[\w<>.]*)\s+(\w+)\s*=\s*(\w+)\s*\.\s*MapGroup\s*\(\s*"([^"]*)"/;

/** `client.GetAsync("…")`, `http.PostAsJsonAsync("…", body)`. */
const CLIENT_CALL_RE =
  /(\w+)\s*\.\s*((Get|Post|Put|Patch|Delete)(?:Async|FromJsonAsync|AsJsonAsync|StringAsync|ByteArrayAsync|StreamAsync))(?:<[^>]*>)?\s*\(\s*(?:new\s+Uri\s*\(\s*)?[$@]*"([^"]*)"/g;

/** `new HttpRequestMessage(HttpMethod.Get, "…")`. */
const REQUEST_MESSAGE_RE =
  /new\s+HttpRequestMessage\s*\(\s*HttpMethod\s*\.\s*(Get|Post|Put|Patch|Delete|Head|Options)\s*,\s*[$@]*"([^"]*)"/g;

/**
 * Refit: `[Get("/api/orders")]` on an interface method. Distinct from
 * `[HttpGet(...)]` — the `(?<!Http)` guard is what keeps the two apart,
 * and without it every controller action would also be reported as an
 * outbound call to itself.
 */
const REFIT_ATTR_RE = /\[\s*(?<!Http)(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*"([^"]*)"\s*\)\s*\]/g;

export const csharpCallsites: CallsiteExtractor = {
  language: 'csharp',
  extract(content, _filePath) {
    return [...extractRoutes(content), ...extractOutbound(content)];
  },
};

// ── Inbound ─────────────────────────────────────────────────────────

/**
 * `OrdersController` → `orders`. ASP.NET strips the suffix and the
 * conventional casing in URLs is lower.
 */
function controllerToken(className: string): string {
  return className.replace(/Controller$/, '').toLowerCase();
}

function expandTokens(pattern: string, className: string | null, actionName: string | null): string {
  let p = pattern;
  if (className) p = p.replace(/\[controller\]/gi, controllerToken(className));
  if (actionName) p = p.replace(/\[action\]/gi, actionName.toLowerCase());
  return p;
}

function extractRoutes(content: string): Callsite[] {
  const lines = content.split('\n').map((l) => stripLineComment(l, '//'));
  const out: Callsite[] = [];

  // Minimal-API groups bound to a variable, resolved in two sweeps so a
  // group declared after its parent still picks the parent's prefix.
  const groupPrefix = new Map<string, string>();
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const line of lines) {
      const m = MAP_GROUP_RE.exec(line);
      if (!m) continue;
      const [, name, parent, literal] = m;
      groupPrefix.set(name, joinPath(groupPrefix.get(parent) ?? '', literal));
    }
  }

  const blockStack: BlockPrefix[] = [];
  let depth = 0;
  // Class context for `[controller]`, and the route prefix its own
  // `[Route(...)]` attribute declares.
  let className: string | null = null;
  let classPrefix = '';
  // A `[Route]` or `[Http*]` attribute can sit lines above its method,
  // with other attributes between, so pending attributes accumulate
  // until the declaration they belong to is reached.
  let pendingRoute: string | null = null;
  let pendingVerbs: Array<{ verb: string; literal: string | null; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const depthBefore = depth;
    depth += countBraces(line);
    const blockPrefix = unwindBlocks(blockStack, depthBefore);

    const routeAttr = ROUTE_ATTR_RE.exec(line);
    const classDecl = CLASS_RE.exec(line);

    if (classDecl) {
      className = classDecl[1];
      // A `[Route]` seen just above the class declares the class prefix.
      classPrefix = pendingRoute ? expandTokens(pendingRoute, className, null) : '';
      pendingRoute = null;
      pendingVerbs = [];
      continue;
    }

    if (routeAttr) {
      pendingRoute = routeAttr[1];
      // A bare `[Route("x")]` on a method is itself a route when a verb
      // attribute accompanies it; handled when the method is reached.
    }

    HTTP_ATTR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HTTP_ATTR_RE.exec(line))) {
      pendingVerbs.push({ verb: m[1], literal: m[2] ?? null, line: lineNo });
    }

    // The declaration the pending attributes belong to.
    if (pendingVerbs.length > 0) {
      const decl = METHOD_DECL_RE.exec(line);
      if (decl) {
        const actionName = decl[1];
        for (const pending of pendingVerbs) {
          const tail = pending.literal ?? pendingRoute ?? '';
          const full = joinPath(classPrefix, expandTokens(tail, className, actionName));
          out.push(route(pending.line, pending.verb, full || '/', `[Http${pending.verb}]`));
        }
        pendingVerbs = [];
        pendingRoute = null;
      }
      continue;
    }

    // Minimal APIs.
    MAP_VERB_RE.lastIndex = 0;
    while ((m = MAP_VERB_RE.exec(line))) {
      const [, recv, verb, literal] = m;
      const prefix = groupPrefix.get(recv) ?? blockPrefix;
      out.push(route(lineNo, verb, joinPath(prefix, literal), `${recv}.Map${verb}`));
    }

    MAP_METHODS_RE.lastIndex = 0;
    while ((m = MAP_METHODS_RE.exec(line))) {
      const [, recv, literal, verbList] = m;
      const prefix = groupPrefix.get(recv) ?? blockPrefix;
      const verbs = verbList
        .split(',')
        .map((s) => s.replace(/["'\s]/g, '').toUpperCase())
        .filter((s) => VERB_SET.has(s));
      for (const verb of verbs) {
        out.push(route(lineNo, verb, joinPath(prefix, literal), `${recv}.MapMethods`));
      }
    }
  }

  return out;
}

// ── Outbound ────────────────────────────────────────────────────────

function extractOutbound(content: string): Callsite[] {
  const out: Callsite[] = [];
  let m: RegExpExecArray | null;

  CLIENT_CALL_RE.lastIndex = 0;
  while ((m = CLIENT_CALL_RE.exec(content))) {
    const [, recv, fullName, verb, url] = m;
    if (!isLikelyApiPath(url)) continue;
    out.push(call(lineOf(content, m.index), verb, url, `${recv}.${fullName}`));
  }

  REQUEST_MESSAGE_RE.lastIndex = 0;
  while ((m = REQUEST_MESSAGE_RE.exec(content))) {
    const [, verb, url] = m;
    if (!isLikelyApiPath(url)) continue;
    out.push(call(lineOf(content, m.index), verb, url, 'new HttpRequestMessage'));
  }

  REFIT_ATTR_RE.lastIndex = 0;
  while ((m = REFIT_ATTR_RE.exec(content))) {
    const [, verb, url] = m;
    if (!isLikelyApiPath(url)) continue;
    out.push(call(lineOf(content, m.index), verb, url, `[${verb}] (Refit)`));
  }

  return out;
}
