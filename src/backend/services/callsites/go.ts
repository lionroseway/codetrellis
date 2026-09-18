import type { CallsiteExtractor } from './base';
import type { Callsite } from '../../../shared/types';
import {
  VERB_SET, lineOf, joinPath, normalizeRoute, normalizeUrl,
  isLikelyApiPath, countBraces, stripLineComment, type BlockPrefix,
} from './shared';

/**
 * Go callsite extractor — Phase 20.
 *
 * See [docs/PHASE-20-GO-SUPPORT.md](../../../../docs/PHASE-20-GO-SUPPORT.md).
 *
 * Inbound routes (`http_route`) across the five framework families
 * that cover almost all production Go:
 *
 *   stdlib        http.HandleFunc("/api/users", h)
 *   stdlib 1.22+  mux.HandleFunc("GET /api/users", h)   ← verb in the pattern
 *   chi           r.Get("/users", h)      inside r.Route("/api", func(r chi.Router){…})
 *   gin           v1.POST("/users", h)    where v1 := r.Group("/api/v1")
 *   echo          g.GET("/users", h)      where g  := e.Group("/api")
 *   gorilla/mux   r.HandleFunc("/users", h).Methods("GET")
 *
 * Outbound (`http_call`): `http.Get/Post/...`, `http.NewRequest`,
 * `http.NewRequestWithContext`.
 *
 * ## Why prefixes are tracked
 *
 * Regex alone reads `r.Get("/users")` and reports `/users`, when the
 * real route is `/api/v1/users`. Grouped routers are the norm in Go,
 * so tail-only URLs would be wrong for most real services — worse
 * than reporting nothing. Two mechanisms carry a prefix, and both are
 * handled:
 *
 *   - **Variable-bound** (gin, echo, gorilla): `v1 := r.Group("/api/v1")`
 *     binds the prefix to a name, used on later lines.
 *   - **Block-scoped** (chi): `r.Route("/api", func(r chi.Router) { … })`
 *     applies the prefix to everything inside the closure.
 *
 * This is a brace-depth scan, not a parse. It handles the shapes above
 * and degrades to the bare literal on anything exotic, which is the
 * same failure mode we'd have without it.
 */

/** `v1 := r.Group("/api/v1")`, `g := e.Group("/api")`. */
const GROUP_RE = /(\w+)\s*:?=\s*(\w+)\s*\.\s*Group\s*\(\s*"([^"]*)"/;

/** `s := r.PathPrefix("/api").Subrouter()` (gorilla). */
const SUBROUTER_RE = /(\w+)\s*:?=\s*(\w+)\s*\.\s*PathPrefix\s*\(\s*"([^"]*)"\s*\)\s*\.\s*Subrouter\s*\(\s*\)/;

/** `r.Route("/api", func(r chi.Router) {` (chi). */
const CHI_ROUTE_RE = /(\w+)\s*\.\s*Route\s*\(\s*"([^"]*)"\s*,\s*func/;

/** `r.Get("/users", h)` / `r.GET(...)` / `e.DELETE(...)`. */
const VERB_METHOD_RE = /(\w+)\s*\.\s*(Get|Post|Put|Patch|Delete|Head|Options|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*"([^"]*)"/g;

/** `http.HandleFunc("/x", h)`, `mux.Handle("GET /x", h)`. */
const HANDLE_RE = /(\w+)\s*\.\s*(HandleFunc|Handle)\s*\(\s*"([^"]*)"/g;

/** Trailing `.Methods("GET", "POST")` on a gorilla registration. */
const METHODS_SUFFIX_RE = /\.\s*Methods\s*\(([^)]*)\)/;

/** `http.Get("…")`, `http.Post("…", …)`. */
const HTTP_VERB_CALL_RE = /\bhttp\s*\.\s*(Get|Post|Put|Patch|Delete|Head)\s*\(\s*"([^"]*)"/g;

/** `http.NewRequest("GET", "…")` and the WithContext variant. */
const NEW_REQUEST_RE = /\bhttp\s*\.\s*NewRequest(?:WithContext)?\s*\(\s*(?:[^,]+,\s*)?"([A-Za-z]+)"\s*,\s*("([^"]*)"|fmt\s*\.\s*Sprintf\s*\(\s*"([^"]*)")/g;

export const goCallsites: CallsiteExtractor = {
  language: 'go',
  extract(content, _filePath) {
    const out: Callsite[] = [];
    out.push(...extractRoutes(content));
    out.push(...extractOutbound(content));
    return out;
  },
};

// ── Inbound ─────────────────────────────────────────────────────────

function extractRoutes(content: string): Callsite[] {
  const lines = content.split('\n');
  const out: Callsite[] = [];

  // Pass 1 — variable-bound prefixes. Two sweeps so a group declared
  // after its parent still resolves (`v1 := api.Group(...)` where
  // `api` is itself a group defined earlier or later).
  const groupPrefix = new Map<string, string>();
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const line of lines) {
      const m = GROUP_RE.exec(line) ?? SUBROUTER_RE.exec(line);
      if (!m) continue;
      const [, name, parent, literal] = m;
      groupPrefix.set(name, joinPath(groupPrefix.get(parent) ?? '', literal));
    }
  }

  // Pass 2 — walk with brace depth so chi's block-scoped prefixes
  // apply to exactly the lines inside their closure.
  const blockStack: BlockPrefix[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = stripLineComment(lines[i], '//');
    const lineNo = i + 1;

    while (blockStack.length > 0 && depth < blockStack[blockStack.length - 1].depth) {
      blockStack.pop();
    }
    const blockPrefix = blockStack.length > 0 ? blockStack[blockStack.length - 1].prefix : '';

    const depthBefore = depth;
    depth += countBraces(line);

    const chi = CHI_ROUTE_RE.exec(line);
    if (chi) {
      const [, recv, literal] = chi;
      const base = groupPrefix.get(recv) ?? blockPrefix;
      // The closure's body lives one level deeper than this line
      // started at, and ends when we come back to that level.
      blockStack.push({ depth: depthBefore + 1, prefix: joinPath(base, literal) });
    }

    for (const cs of routesOnLine(line, lineNo, groupPrefix, blockPrefix)) out.push(cs);
  }

  return out;
}

function* routesOnLine(
  line: string,
  lineNo: number,
  groupPrefix: Map<string, string>,
  blockPrefix: string,
): Iterable<Callsite> {
  // `r.Get("/users", h)` — the verb is the method name.
  VERB_METHOD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VERB_METHOD_RE.exec(line))) {
    const [, recv, verb, literal] = m;
    const prefix = groupPrefix.get(recv) ?? blockPrefix;
    yield {
      kind: 'http_route',
      protocol: 'http',
      line: lineNo,
      method: verb.toUpperCase(),
      urlPattern: normalizeRoute(joinPath(prefix, literal)),
      context: `${recv}.${verb}`,
    };
  }

  // `HandleFunc` / `Handle` — verb comes either from a Go 1.22 pattern
  // prefix (`"GET /x"`) or a trailing `.Methods("GET")`, else unknown.
  HANDLE_RE.lastIndex = 0;
  while ((m = HANDLE_RE.exec(line))) {
    const [, recv, fn, rawPattern] = m;
    const prefix = groupPrefix.get(recv) ?? blockPrefix;

    let method: string | undefined;
    let literal = rawPattern;

    const spaceIdx = rawPattern.indexOf(' ');
    if (spaceIdx > 0) {
      const candidate = rawPattern.slice(0, spaceIdx).toUpperCase();
      if (VERB_SET.has(candidate)) {
        method = candidate;
        literal = rawPattern.slice(spaceIdx + 1);
      }
    }

    const methodsSuffix = METHODS_SUFFIX_RE.exec(line.slice(m.index));
    const suffixVerbs = methodsSuffix
      ? methodsSuffix[1].split(',').map((s) => s.replace(/["'\s]/g, '').toUpperCase()).filter((s) => VERB_SET.has(s))
      : [];

    const methods = suffixVerbs.length > 0 ? suffixVerbs : [method ?? 'ANY'];
    for (const verb of methods) {
      yield {
        kind: 'http_route',
        protocol: 'http',
        line: lineNo,
        method: verb,
        urlPattern: normalizeRoute(joinPath(prefix, literal)),
        context: `${recv}.${fn}`,
      };
    }
  }
}

// ── Outbound ────────────────────────────────────────────────────────

function extractOutbound(content: string): Callsite[] {
  const out: Callsite[] = [];

  HTTP_VERB_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTTP_VERB_CALL_RE.exec(content))) {
    const [, verb, url] = m;
    if (!isLikelyApiPath(url)) continue;
    out.push({
      kind: 'http_call',
      protocol: 'http',
      line: lineOf(content, m.index),
      method: verb.toUpperCase(),
      urlPattern: normalizeUrl(url),
      context: `http.${verb}`,
    });
  }

  NEW_REQUEST_RE.lastIndex = 0;
  while ((m = NEW_REQUEST_RE.exec(content))) {
    const verb = m[1].toUpperCase();
    if (!VERB_SET.has(verb)) continue;
    // Either a plain literal (group 3) or the literal part of a
    // `fmt.Sprintf("%s/api/x", base)` (group 4) — Sprintf-built URLs
    // are too common in Go clients to skip, and the literal tail is
    // what the matcher needs anyway.
    const url = m[3] ?? m[4] ?? '';
    if (!isLikelyApiPath(url)) continue;
    out.push({
      kind: 'http_call',
      protocol: 'http',
      line: lineOf(content, m.index),
      method: verb,
      urlPattern: normalizeUrl(url),
      context: 'http.NewRequest',
    });
  }

  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────

