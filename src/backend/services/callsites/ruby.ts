import type { CallsiteExtractor } from './base';
import type { Callsite } from '../../../shared/types';
import { lineOf, joinPath, isLikelyApiPath, isNonClientReceiver, route, call } from './shared';

/**
 * Ruby callsite extractor — Phase 28.
 *
 * See [docs/PHASE-28-CALLSITE-EXPANSION.md](../../../../docs/PHASE-28-CALLSITE-EXPANSION.md).
 *
 * Inbound is `config/routes.rb` — the Rails router DSL — plus Sinatra,
 * which happens to share the explicit-verb shape.
 *
 * Outbound: `Net::HTTP`, `HTTParty`, `RestClient`, `Faraday`.
 *
 * ## `resources :orders` is five routes, not one
 *
 * Almost no Rails application writes its API out verb by verb. It
 * writes:
 *
 *     namespace :api do
 *       resources :orders, only: [:index, :show]
 *     end
 *
 * and Rails expands that into real endpoints. An extractor that
 * reported only explicit `get`/`post` lines would find **nothing** in a
 * typical Rails routes file, and Ruby would join the graph as a service
 * that serves no endpoints while visibly making calls — the confidently
 * wrong picture this whole line of work exists to avoid.
 *
 * So `resources` is expanded the way Rails expands it:
 *
 *     GET    /orders          index
 *     POST   /orders          create
 *     GET    /orders/:id      show
 *     PATCH  /orders/:id      update
 *     PUT    /orders/:id      update
 *     DELETE /orders/:id      destroy
 *
 * `only:` and `except:` are honoured, and `resource` (singular) drops
 * `index` and the `:id` segment, as Rails does.
 *
 * **`new` and `edit` are deliberately not emitted.** They are the HTML
 * form routes; no API client calls them, and whether they exist at all
 * depends on `config.api_only`, which lives in a file this extractor
 * cannot see. Emitting them would add two unmatchable routes per
 * resource on a guess, so the under-claim is the honest side to err on.
 *
 * ## Ruby blocks are `do` / `end`
 *
 * Every other extractor here tracks nesting with brace depth. Ruby's
 * router uses `do` … `end`, so nesting is counted from those keywords
 * instead — which is why this file does not use the shared
 * `countBraces`. `routes.rb` is a highly stylised file and this holds
 * well across the shapes that appear in it; anything exotic degrades to
 * a missing prefix rather than a wrong one.
 */

/** The Rails actions worth mapping, and the verb+suffix each implies. */
const RESOURCE_ACTIONS: ReadonlyArray<{ action: string; verb: string; member: boolean }> = [
  { action: 'index', verb: 'GET', member: false },
  { action: 'create', verb: 'POST', member: false },
  { action: 'show', verb: 'GET', member: true },
  { action: 'update', verb: 'PATCH', member: true },
  { action: 'update', verb: 'PUT', member: true },
  { action: 'destroy', verb: 'DELETE', member: true },
];

/** `namespace :api do`, `namespace 'api' do`. */
const NAMESPACE_RE = /^\s*namespace\s+[:'"]([\w-]+)['"]?\s+do\b/;

/** `scope '/api' do`, `scope path: '/api' do`, `scope module: :api do`. */
const SCOPE_RE = /^\s*scope\s+(?:path:\s*)?['"]([^'"]*)['"].*\bdo\b/;

/** `resources :orders`, `resource :profile`, with optional filters. */
const RESOURCES_RE = /^\s*(resources?)\s+:([\w-]+)(.*)$/;

/** `only: [:index, :show]` / `except: %i[destroy]`. */
const ONLY_RE = /\bonly:\s*(?:\[([^\]]*)\]|%i\[([^\]]*)\]|:(\w+))/;
const EXCEPT_RE = /\bexcept:\s*(?:\[([^\]]*)\]|%i\[([^\]]*)\]|:(\w+))/;

/** `get '/api/orders', to: 'orders#index'` and Sinatra's `get '/x' do`. */
const VERB_ROUTE_RE = /^\s*(get|post|put|patch|delete|head|options)\s+['"]([^'"]*)['"]/;

/**
 * Ruby's test conventions, which are strong enough to rely on: RSpec lives in
 * `spec/` with `_spec.rb`, Minitest in `test/` with `_test.rb`.
 */
function isSpecFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  return /(^|\/)(spec|test)\//.test(p) || /_(spec|test)\.rb$/.test(p);
}

/** `root to: 'home#index'`. */
const ROOT_RE = /^\s*root\b/;

/** `member do` / `collection do` inside a resources block. */
const MEMBER_BLOCK_RE = /^\s*(member|collection)\s+do\b/;

/** `Net::HTTP.get(URI('http://…'))`, `Net::HTTP.post(URI("…"))`. */
const NET_HTTP_RE = /Net::HTTP\s*\.\s*(get|post|put|patch|delete|head)\w*\s*\(\s*URI(?:\.parse)?\s*\(\s*['"]([^'"]*)['"]/g;

/** `HTTParty.get('…')`, `RestClient.post '…'`, `Faraday.get("…")`, `conn.get('/api/x')`. */
const CLIENT_RE =
  /\b(HTTParty|RestClient|Faraday|[a-z_]\w*)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(?\s*['"]([^'"]*)['"]/g;

export const rubyCallsites: CallsiteExtractor = {
  language: 'ruby',
  extract(content, filePath) {
    // A request spec issues requests with exactly the syntax a router uses to
    // declare them — `get '/api/orders'` is a route in routes.rb and a call in
    // spec/requests/orders_spec.rb. Read as routes, every spec file appeared to
    // SERVE the endpoints it exercises, so the graph showed the test suite as a
    // second implementation of the API sitting alongside the real one.
    //
    // Outbound calls are still extracted here: a spec really does call the
    // endpoint, and that is true of the file.
    const routes = isSpecFile(filePath) ? [] : extractRoutes(content, filePath);
    return [...routes, ...extractOutbound(content)];
  },
};

// ── Inbound ─────────────────────────────────────────────────────────

/** Net change in `do`/`end` nesting across a line. */
function blockDelta(line: string): number {
  const code = stripRubyComment(line);
  let delta = 0;
  // A trailing `do`, or `do |args|`, opens a block. `{ |x| … }` on one
  // line opens and closes, so it nets zero and is ignored.
  if (/\bdo\b\s*(\|[^|]*\|)?\s*$/.test(code)) delta++;
  if (/^\s*end\b/.test(code)) delta--;
  return delta;
}

function stripRubyComment(line: string): string {
  const idx = line.indexOf('#');
  if (idx === -1) return line;
  const before = line.slice(0, idx);
  const doubles = (before.match(/"/g) || []).length;
  const singles = (before.match(/'/g) || []).length;
  // `#{…}` interpolation is not a comment.
  if (line[idx + 1] === '{') return line;
  return doubles % 2 === 0 && singles % 2 === 0 ? before : line;
}

/** `only: [:index, :show]` → `['index','show']`; null when absent. */
function actionFilter(re: RegExp, tail: string): Set<string> | null {
  const m = re.exec(tail);
  if (!m) return null;
  const body = m[1] ?? m[2] ?? m[3] ?? '';
  const names = body
    .split(/[,\s]+/)
    .map((s) => s.replace(/^:/, '').trim())
    .filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

/**
 * A block prefix, plus the *collection* path when the block is a
 * `resources … do`.
 *
 * `resources :invoices do` nests its children under the member path
 * `/invoices/:id`, which is right for a nested `resources :lines`. But
 * a `member do` inside it must not add a second `:id`, and a
 * `collection do` must drop it entirely — so both paths are carried
 * rather than recomputed from a prefix that has already been joined.
 */
interface RouteBlock {
  depth: number;
  /** Path that nested resources and `member` routes hang off. */
  prefix: string;
  /** Path that `collection` routes hang off; same as prefix elsewhere. */
  collection: string;
}

function extractRoutes(content: string, filePath: string): Callsite[] {
  const lines = content.split('\n');
  const out: Callsite[] = [];

  const blockStack: RouteBlock[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = stripRubyComment(raw);
    const lineNo = i + 1;

    // Pop prefixes whose block has closed, before reading this line.
    while (blockStack.length > 0 && depth < blockStack[blockStack.length - 1].depth) {
      blockStack.pop();
    }
    const top = blockStack.length > 0 ? blockStack[blockStack.length - 1] : null;
    const prefix = top ? top.prefix : '';
    const depthBefore = depth;
    depth += blockDelta(line);

    const ns = NAMESPACE_RE.exec(line);
    if (ns) {
      const nsPath = joinPath(prefix, '/' + ns[1]);
      blockStack.push({ depth: depthBefore + 1, prefix: nsPath, collection: nsPath });
      continue;
    }

    const scope = SCOPE_RE.exec(line);
    if (scope) {
      const scopePath = joinPath(prefix, scope[1]);
      blockStack.push({ depth: depthBefore + 1, prefix: scopePath, collection: scopePath });
      continue;
    }

    // `member do` / `collection do` — a member block's routes hang off
    // `:id`, a collection block's off the bare resource path. The
    // enclosing `resources` already set the prefix, so only the member
    // case adds anything.
    // `member do` / `collection do` inside a `resources … do` block.
    // The enclosing block already computed both paths, so this picks
    // one rather than appending to whichever it happened to expose.
    const memberBlock = MEMBER_BLOCK_RE.exec(line);
    if (memberBlock) {
      const inner = memberBlock[1] === 'member' ? prefix : (top?.collection ?? prefix);
      blockStack.push({ depth: depthBefore + 1, prefix: inner, collection: inner });
      continue;
    }

    const resources = RESOURCES_RE.exec(line);
    if (resources) {
      const [, keyword, name, tail] = resources;
      const plural = keyword === 'resources';
      const base = joinPath(prefix, '/' + name);

      const only = actionFilter(ONLY_RE, tail);
      const except = actionFilter(EXCEPT_RE, tail);

      for (const { action, verb, member } of RESOURCE_ACTIONS) {
        // A singular `resource` has no index and no :id segment.
        if (!plural && action === 'index') continue;
        if (only && !only.has(action)) continue;
        if (except && except.has(action)) continue;
        const path = member && plural ? `${base}/:id` : base;
        out.push(route(lineNo, verb, path, `${keyword} :${name} (${action})`));
      }

      // A `resources … do` block nests its children under the member
      // path: `resources :orders do resources :items end` is
      // `/orders/:id/items`.
      if (/\bdo\b\s*$/.test(line)) {
        const nested = plural ? `${base}/:id` : base;
        blockStack.push({ depth: depthBefore + 1, prefix: nested, collection: base });
      }
      continue;
    }

    const verbRoute = VERB_ROUTE_RE.exec(line);
    if (verbRoute) {
      const [, verb, path] = verbRoute;
      out.push(route(lineNo, verb, joinPath(prefix, path), `${verb} '${path}'`));
      continue;
    }

    if (ROOT_RE.test(line) && /\bto:|=>/.test(line)) {
      out.push(route(lineNo, 'GET', joinPath(prefix, '/') || '/', 'root'));
    }
  }

  // Sinatra and Rails share the explicit-verb shape, so a non-router
  // file is scanned the same way and simply finds nothing if it has no
  // routes. `filePath` is unused beyond this note — kept for symmetry
  // with the contract and for future per-file heuristics.
  void filePath;
  return out;
}

// ── Outbound ────────────────────────────────────────────────────────

function extractOutbound(content: string): Callsite[] {
  const out: Callsite[] = [];
  let m: RegExpExecArray | null;

  NET_HTTP_RE.lastIndex = 0;
  while ((m = NET_HTTP_RE.exec(content))) {
    const [, verb, url] = m;
    if (!isLikelyApiPath(url)) continue;
    out.push(call(lineOf(content, m.index), verb, url, `Net::HTTP.${verb}`));
  }

  CLIENT_RE.lastIndex = 0;
  while ((m = CLIENT_RE.exec(content))) {
    const [, recv, verb, url] = m;
    if (isNonClientReceiver(recv)) continue;
    if (!isLikelyApiPath(url)) continue;
    out.push(call(lineOf(content, m.index), verb, url, `${recv}.${verb}`));
  }

  return out;
}
