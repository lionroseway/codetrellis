import type { CallsiteExtractor } from './base';
import type { Callsite } from '../../../shared/types';
import {
  VERB_SET, lineOf, joinPath, isLikelyApiPath, stripLineComment,
  countBraces, unwindBlocks, route, call, type BlockPrefix,
} from './shared';

/**
 * Swift callsite extractor — Phase 28.
 *
 * See [docs/PHASE-28-CALLSITE-EXPANSION.md](../../../../docs/PHASE-28-CALLSITE-EXPANSION.md).
 *
 * Swift is overwhelmingly the **calling** side, so that is where the
 * work went:
 *
 *   URLSession   URL(string: "https://api/orders")  + request.httpMethod
 *   Alamofire    AF.request("https://api/orders", method: .post)
 *
 * Inbound is Vapor, which is real but niche:
 *
 *   app.get("api", "orders") { req in … }
 *   let api = app.grouped("api");  api.post("orders") { … }
 *
 * ## The verb is on a different line from the URL
 *
 * `URL(string:)` names the endpoint; `request.httpMethod = "POST"` names
 * the verb, usually two or three lines later, and the two are joined by
 * a local variable this extractor cannot resolve. Guessing wrong emits a
 * `POST /api/orders` edge to an endpoint that only serves `GET`, which
 * is a false edge — the thing the matcher's own comment says erodes
 * trust fastest.
 *
 * So: a short forward window is scanned for an `httpMethod` assignment,
 * and when none is found the call is reported as **GET**. That is not a
 * default chosen for convenience — `URLRequest.httpMethod` is literally
 * `"GET"` until something sets it, so a request with no assignment
 * nearby really is a GET.
 *
 * The window also stops at the next `URL(string:)`. Two requests written
 * back to back are close enough that a fixed line count would let the
 * first one borrow the second's verb, turning a GET into a phantom
 * DELETE against an endpoint that never serves one.
 *
 * ## Vapor paths are components, not a path string
 *
 * `app.get("api", "orders")` declares `/api/orders` — the slashes are
 * implied by the argument list. A `:param` is written `":id"` as its own
 * component. Reading only the first argument would report `/api`, and
 * every Vapor route in a file would collapse onto its first segment.
 */

/** How far below a `URL(string:)` to look for the verb. */
const HTTP_METHOD_WINDOW = 6;

/** `URL(string: "https://…")`. */
const URL_STRING_RE = /URL\s*\(\s*string\s*:\s*"([^"]*)"/g;

/** `request.httpMethod = "POST"`. */
const HTTP_METHOD_RE = /httpMethod\s*=\s*"([A-Za-z]+)"/;

/** `AF.request("https://…", method: .post)`. */
const ALAMOFIRE_RE = /\brequest\s*\(\s*"([^"]*)"(?:\s*,\s*method\s*:\s*\.\s*(\w+))?/g;

/** Vapor `app.get("api", "orders") { … }` — components, not a path. */
const VAPOR_VERB_RE = /(\w+)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*((?:"[^"]*"\s*,?\s*)+)\)\s*\{/g;

/** `let api = app.grouped("api", "v2")`. */
const VAPOR_GROUP_RE = /(?:let|var)\s+(\w+)\s*=\s*(\w+)\s*\.\s*grouped\s*\(\s*((?:"[^"]*"\s*,?\s*)+)\)/;

/** `app.group("api") { api in` — the closure form. */
const VAPOR_GROUP_BLOCK_RE = /(\w+)\s*\.\s*group\s*\(\s*((?:"[^"]*"\s*,?\s*)+)\)\s*\{/;

export const swiftCallsites: CallsiteExtractor = {
  language: 'swift',
  extract(content, _filePath) {
    return [...extractRoutes(content), ...extractOutbound(content)];
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

/** `"api", "orders"` → `/api/orders`. */
function componentsToPath(argList: string): string {
  const parts = [...argList.matchAll(/"([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  if (parts.length === 0) return '';
  return '/' + parts.join('/');
}

// ── Inbound ─────────────────────────────────────────────────────────

function extractRoutes(content: string): Callsite[] {
  const lines = content.split('\n').map((l) => stripLineComment(l, '//'));
  const out: Callsite[] = [];

  const groupPrefix = new Map<string, string>();
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const line of lines) {
      const m = VAPOR_GROUP_RE.exec(line);
      if (!m) continue;
      const [, name, parent, args] = m;
      groupPrefix.set(name, joinPath(groupPrefix.get(parent) ?? '', componentsToPath(args)));
    }
  }

  const blockStack: BlockPrefix[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const depthBefore = depth;
    depth += countBraces(line);
    const blockPrefix = unwindBlocks(blockStack, depthBefore);

    const groupBlock = VAPOR_GROUP_BLOCK_RE.exec(line);
    if (groupBlock) {
      const [, recv, args] = groupBlock;
      const base = groupPrefix.get(recv) ?? blockPrefix;
      blockStack.push({ depth: depthBefore + 1, prefix: joinPath(base, componentsToPath(args)) });
    }

    VAPOR_VERB_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAPOR_VERB_RE.exec(line))) {
      const [, recv, verb, args] = m;
      const prefix = groupPrefix.get(recv) ?? blockPrefix;
      out.push(route(lineNo, verb, joinPath(prefix, componentsToPath(args)), `${recv}.${verb}`));
    }
  }

  return out;
}

// ── Outbound ────────────────────────────────────────────────────────

function extractOutbound(content: string): Callsite[] {
  const lines = content.split('\n');
  const out: Callsite[] = [];
  let m: RegExpExecArray | null;

  // Collected first so each request's verb search can stop at the next
  // one rather than reading into it.
  const urls: Array<{ url: string; lineNo: number }> = [];
  URL_STRING_RE.lastIndex = 0;
  while ((m = URL_STRING_RE.exec(content))) {
    urls.push({ url: m[1], lineNo: lineOf(content, m.index) });
  }
  for (let i = 0; i < urls.length; i++) {
    const { url, lineNo } = urls[i];
    if (!isLikelyApiPath(url)) continue;
    const nextUrlLine = urls[i + 1]?.lineNo ?? Infinity;
    out.push(call(lineNo, verbNear(lines, lineNo, nextUrlLine), url, 'URL(string:)'));
  }

  ALAMOFIRE_RE.lastIndex = 0;
  while ((m = ALAMOFIRE_RE.exec(content))) {
    const [, url, verb] = m;
    if (!isLikelyApiPath(url)) continue;
    const method = verb && VERB_SET.has(verb.toUpperCase()) ? verb.toUpperCase() : 'GET';
    out.push(call(lineOf(content, m.index), method, url, 'AF.request'));
  }

  return out;
}

/**
 * The verb for a URL built on `lineNo`, read from a nearby
 * `httpMethod` assignment. GET when there is none — see the header.
 *
 * `nextUrlLine` bounds the search so one request cannot claim the verb
 * that belongs to the one after it.
 */
function verbNear(lines: string[], lineNo: number, nextUrlLine: number): string {
  const end = Math.min(lines.length, lineNo + HTTP_METHOD_WINDOW, nextUrlLine - 1);
  for (let i = lineNo - 1; i < end; i++) {
    const m = HTTP_METHOD_RE.exec(lines[i]);
    if (!m) continue;
    const verb = m[1].toUpperCase();
    if (VERB_SET.has(verb)) return verb;
  }
  return 'GET';
}
