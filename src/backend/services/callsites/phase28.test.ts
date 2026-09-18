/**
 * Unit tests for the C#, Kotlin, Swift and Ruby callsite extractors
 * (Phase 28).
 *
 * The assertions concentrate on the thing each language does that a
 * naive regex gets wrong, because those are the failures that produce a
 * *plausible* graph rather than an obviously broken one:
 *
 *   C#      `[Route("api/[controller]")]` — the token IS the path
 *   Kotlin  Ktor's `route {}` nesting, and route-vs-client ambiguity
 *   Swift   the verb lives lines away from the URL
 *   Ruby    `resources :orders` is five routes, not one
 *
 * Plus the contract that makes any of it useful: `cross-system-service`
 * pairs by EXACT string equality on `METHOD path`, so a language that
 * normalises differently never matches. The last suite asserts all
 * seven extractors agree.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { csharpCallsites } from './csharp';
import { kotlinCallsites } from './kotlin';
import { swiftCallsites } from './swift';
import { rubyCallsites } from './ruby';
import { CALLSITE_EXTRACTORS, getCallsiteExtractor } from './index';
import { normalizeRoute, normalizeUrl } from './shared';
import type { CallsiteExtractor } from './base';
import type { Callsite } from '../../../shared/types';

const routesOf = (e: CallsiteExtractor, src: string): Callsite[] =>
  e.extract(src, 'x').filter((c) => c.kind === 'http_route');
const callsOf = (e: CallsiteExtractor, src: string): Callsite[] =>
  e.extract(src, 'x').filter((c) => c.kind === 'http_call');
/** `GET /api/orders` — the exact string the matcher pairs on. */
const keys = (cs: Callsite[]): string[] => cs.map((c) => `${c.method} ${c.urlPattern}`);

// ============================================================
// C#
// ============================================================

describe('C# routes', () => {
  test('[controller] is expanded from the class name', () => {
    // Reporting the literal would give `/api/[controller]` for EVERY
    // controller in a project — one fake endpoint instead of twenty
    // real ones.
    const routes = routesOf(csharpCallsites, `
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public IActionResult Index() => Ok();

    [HttpGet("{id}")]
    public IActionResult Show(int id) => Ok();
}
`);
    assert.deepEqual(keys(routes), ['GET /api/orders', 'GET /api/orders/:id']);
  });

  test('an attribute route gets a leading slash so it can pair', () => {
    // `[Route("api/orders")]` is absolute in ASP.NET but written
    // without the slash. The matcher compares exact strings.
    const [r] = routesOf(csharpCallsites, `
[Route("api/orders")]
public class OrdersController
{
    [HttpGet]
    public IActionResult Index() => Ok();
}
`);
    assert.equal(r.urlPattern, '/api/orders');
  });

  test('attributes separated from the method by other attributes still bind', () => {
    const routes = routesOf(csharpCallsites, `
[Route("api/[controller]")]
public class OrdersController
{
    [HttpPost("search")]
    [ProducesResponseType(200)]
    [Authorize]
    public IActionResult Search() => Ok();
}
`);
    assert.deepEqual(keys(routes), ['POST /api/orders/search']);
  });

  test('a controller with no [Route] gets the bare action template', () => {
    // ASP.NET attribute routing gives `/search`, not `/orders/search` —
    // the controller name only enters the path via `[controller]`.
    const routes = routesOf(csharpCallsites, `
public class OrdersController
{
    [HttpPost("search")]
    public IActionResult Search() => Ok();
}
`);
    assert.deepEqual(keys(routes), ['POST /search']);
  });

  test('minimal-API groups carry their prefix', () => {
    const routes = routesOf(csharpCallsites, `
var admin = app.MapGroup("/api/admin");
admin.MapGet("/users", () => "x");
admin.MapDelete("/users/{id}", (int id) => "x");
app.MapPost("/api/webhook", () => "x");
`);
    assert.deepEqual(keys(routes), [
      'GET /api/admin/users', 'DELETE /api/admin/users/:id', 'POST /api/webhook',
    ]);
  });

  test('MapMethods emits one route per verb', () => {
    const routes = routesOf(csharpCallsites, `app.MapMethods("/api/any", new[] { "GET", "POST" }, () => "x");`);
    assert.deepEqual(keys(routes), ['GET /api/any', 'POST /api/any']);
  });
});

describe('C# calls', () => {
  test('HttpClient and HttpRequestMessage are outbound', () => {
    const calls = callsOf(csharpCallsites, `
var res = await _http.GetAsync("http://billing/api/ledger");
await _http.PostAsJsonAsync("/api/audit", new { });
var req = new HttpRequestMessage(HttpMethod.Put, "http://billing/api/ledger/1");
`);
    assert.deepEqual(keys(calls), ['GET /api/ledger', 'POST /api/audit', 'PUT /api/ledger/1']);
  });

  test('a Refit attribute is a call; a controller attribute is not', () => {
    // `[Get("…")]` and `[HttpGet("…")]` differ by four characters. If
    // the Refit pattern also matched `[HttpGet]`, every controller
    // action would be reported as an outbound call to itself.
    const both = csharpCallsites.extract(`
public interface IBillingApi
{
    [Get("/api/ledger")]
    Task<Ledger> GetLedger();
}

public class OrdersController
{
    [HttpGet("/api/orders")]
    public IActionResult Index() => Ok();
}
`, 'x');
    assert.deepEqual(keys(both.filter((c) => c.kind === 'http_call')), ['GET /api/ledger']);
    assert.deepEqual(keys(both.filter((c) => c.kind === 'http_route')), ['GET /api/orders']);
  });
});

// ============================================================
// Kotlin
// ============================================================

describe('Kotlin routes', () => {
  test('a class-level @RequestMapping prefixes every handler', () => {
    const routes = routesOf(kotlinCallsites, `
@RestController
@RequestMapping("/api/jobs")
class JobController {
    @GetMapping
    fun index(): List<Job> = emptyList()

    @GetMapping("/{id}")
    fun show(@PathVariable id: Long): Job? = null

    @RequestMapping("/legacy", method = [RequestMethod.PUT])
    fun legacy() {}
}
`);
    assert.deepEqual(keys(routes), [
      'GET /api/jobs', 'GET /api/jobs/:id', 'PUT /api/jobs/legacy',
    ]);
  });

  test('nested Ktor route blocks compose their prefixes', () => {
    const routes = routesOf(kotlinCallsites, `
routing {
    route("/api/v2") {
        get("/orders") { }
        route("/admin") {
            delete("/orders/{id}") { }
        }
    }
    get("/health") { }
}
`);
    assert.deepEqual(keys(routes), [
      'GET /api/v2/orders', 'DELETE /api/v2/admin/orders/:id', 'GET /health',
    ]);
  });

  test('a bare verb is a route; the same verb with a receiver is a call', () => {
    // The one genuinely ambiguous shape in Kotlin — Ktor spells the
    // server and client forms almost identically.
    const all = kotlinCallsites.extract(`
routing {
    get("/api/orders") { }
}
suspend fun fetch() = client.get("http://billing/api/ledger")
`, 'x');
    assert.deepEqual(keys(all.filter((c) => c.kind === 'http_route')), ['GET /api/orders']);
    assert.deepEqual(keys(all.filter((c) => c.kind === 'http_call')), ['GET /api/ledger']);
  });
});

describe('Kotlin calls', () => {
  test('a Retrofit path without a leading slash still pairs', () => {
    // Retrofit paths are relative to the client base URL and are
    // routinely written bare.
    const [c] = callsOf(kotlinCallsites, `
interface LedgerApi {
    @GET("api/ledger")
    suspend fun ledger(): Ledger
}
`);
    assert.equal(c.urlPattern, '/api/ledger');
  });

  test('OkHttp reports GET, which is what the builder defaults to', () => {
    const [c] = callsOf(kotlinCallsites, `Request.Builder().url("http://billing/api/raw").build()`);
    assert.equal(c.method, 'GET');
    assert.equal(c.urlPattern, '/api/raw');
  });
});

// ============================================================
// Swift
// ============================================================

describe('Swift calls', () => {
  test('the verb is read from a nearby httpMethod assignment', () => {
    const [c] = callsOf(swiftCallsites, `
let url = URL(string: "https://billing/api/audit")!
var request = URLRequest(url: url)
request.httpMethod = "POST"
`);
    assert.equal(c.method, 'POST');
    assert.equal(c.urlPattern, '/api/audit');
  });

  test('no assignment means GET, because that is what URLRequest does', () => {
    // Not a convenience default: `URLRequest.httpMethod` is literally
    // "GET" until something sets it.
    const [c] = callsOf(swiftCallsites, `let url = URL(string: "https://billing/api/ledger")!`);
    assert.equal(c.method, 'GET');
  });

  test('a later request does not steal an earlier one’s verb', () => {
    // Two requests written back to back sit well inside a fixed line
    // window, so without a bound the first would borrow the second's
    // verb and report a DELETE against an endpoint that only serves GET.
    const calls = callsOf(swiftCallsites, `
let listing = URL(string: "https://billing/api/ledger")!
let removal = URL(string: "https://billing/api/ledger/1")!
var r = URLRequest(url: removal)
r.httpMethod = "DELETE"
`);
    assert.deepEqual(keys(calls), ['GET /api/ledger', 'DELETE /api/ledger/1']);
  });

  test('Alamofire carries its method argument', () => {
    const [c] = callsOf(swiftCallsites, `AF.request("https://billing/api/orders", method: .delete)`);
    assert.equal(c.method, 'DELETE');
  });
});

describe('Swift routes', () => {
  test('Vapor path components become a path', () => {
    // `app.get("api", "orders")` is `/api/orders` — reading only the
    // first argument would collapse every route onto `/api`.
    const routes = routesOf(swiftCallsites, `
app.get("api", "health") { req in "ok" }
let api = app.grouped("api", "v2")
api.post("orders") { req in "ok" }
app.group("admin") { admin in
    admin.delete("orders", ":id") { req in "ok" }
}
`);
    assert.deepEqual(keys(routes), [
      'GET /api/health', 'POST /api/v2/orders', 'DELETE /admin/orders/:id',
    ]);
  });
});

// ============================================================
// Ruby
// ============================================================

describe('Ruby routes', () => {
  test('resources expands to the five API actions', () => {
    // An extractor that only read explicit verbs would find NOTHING in
    // a typical Rails routes file.
    const routes = routesOf(rubyCallsites, `resources :orders`);
    assert.deepEqual(keys(routes), [
      'GET /orders', 'POST /orders', 'GET /orders/:id',
      'PATCH /orders/:id', 'PUT /orders/:id', 'DELETE /orders/:id',
    ]);
  });

  test('new and edit are deliberately absent', () => {
    // They are the HTML form routes; no API client calls them, and
    // whether Rails generates them at all depends on config.api_only,
    // which is not in this file.
    const paths = routesOf(rubyCallsites, `resources :orders`).map((r) => r.urlPattern);
    assert.ok(!paths.some((p) => p?.endsWith('/new') || p?.endsWith('/edit')));
  });

  test('only: and except: are honoured', () => {
    assert.deepEqual(keys(routesOf(rubyCallsites, `resources :orders, only: [:index, :show]`)), [
      'GET /orders', 'GET /orders/:id',
    ]);
    assert.deepEqual(keys(routesOf(rubyCallsites, `resources :orders, except: %i[destroy update]`)), [
      'GET /orders', 'POST /orders', 'GET /orders/:id',
    ]);
  });

  test('a singular resource has no index and no :id', () => {
    assert.deepEqual(keys(routesOf(rubyCallsites, `resource :profile, only: [:show, :update]`)), [
      'GET /profile', 'PATCH /profile', 'PUT /profile',
    ]);
  });

  test('namespace, scope and nesting compose', () => {
    const routes = routesOf(rubyCallsites, `
Rails.application.routes.draw do
  namespace :api do
    resources :invoices, only: [:index] do
      resources :lines, only: [:index]
      member do
        post '/void'
      end
      collection do
        get '/summary'
      end
    end
    get '/health', to: 'health#show'
  end

  scope '/legacy' do
    delete '/notes/:id', to: 'notes#destroy'
  end
end
`);
    assert.deepEqual(keys(routes), [
      'GET /api/invoices',
      'GET /api/invoices/:id/lines',
      // A member route hangs off :id; a collection route does not. The
      // enclosing `resources` block already carries the member path, so
      // getting this wrong doubles the :id.
      'POST /api/invoices/:id/void',
      'GET /api/invoices/summary',
      'GET /api/health',
      'DELETE /legacy/notes/:id',
    ]);
  });
});

describe('Ruby calls', () => {
  test('the HTTP libraries are outbound', () => {
    const calls = callsOf(rubyCallsites, `
Net::HTTP.get(URI('http://billing/api/ledger'))
HTTParty.post('http://billing/api/audit')
conn.get('/api/orders')
`);
    assert.deepEqual(keys(calls), ['GET /api/ledger', 'POST /api/audit', 'GET /api/orders']);
  });

  test('a hash-like receiver named get is not an HTTP call', () => {
    // Ruby spells `Hash#fetch` alternatives and ActiveRecord scopes the
    // same way. Without the receiver guard every `params.get('/x')` in
    // a codebase becomes an outbound edge.
    assert.deepEqual(callsOf(rubyCallsites, `params.get('/id')\nsession.get('/token')`), []);
  });
});

// ============================================================
// The matching contract
// ============================================================

describe('normalisation is one contract, not seven', () => {
  test('every parameter spelling collapses to :id', () => {
    for (const spelling of [
      '/users/{id}', '/users/{user_id}', '/users/:userID', '/users/:user_id',
      '/users/${id}', '/users/<int:pk>',
    ]) {
      assert.equal(normalizeRoute(spelling), '/users/:id', spelling);
    }
  });

  test('a route and a call to it normalise to the same string', () => {
    // This is the whole reason the helpers are shared: the matcher
    // pairs by exact equality and has no fuzzy fallback.
    assert.equal(normalizeRoute('api/orders/{id}'), normalizeUrl('https://billing.acme.dev/api/orders/:id'));
    assert.equal(normalizeUrl('http://svc/api/orders?page=2'), '/api/orders');
    assert.equal(normalizeUrl('%s/api/orders'), '/api/orders');
  });

  test('a route always has a leading slash and no trailing one', () => {
    assert.equal(normalizeRoute('api/orders/'), '/api/orders');
    assert.equal(normalizeRoute(''), '/');
    assert.equal(normalizeRoute('/'), '/');
  });

  test('every registered extractor is reachable by its language', () => {
    for (const extractor of CALLSITE_EXTRACTORS) {
      assert.equal(getCallsiteExtractor(extractor.language), extractor, extractor.language);
    }
    for (const lang of ['csharp', 'kotlin', 'swift', 'ruby'] as const) {
      assert.ok(getCallsiteExtractor(lang), `${lang} has no extractor`);
    }
  });

  test('no extractor re-declares a shared helper', () => {
    // The drift this phase removed: `lineOf` had been copied verbatim
    // into three files and `isLikelyApiPath` into three more, so
    // changing the rule in one place left the others on the old one —
    // which is how Go and Python came to disagree about whether
    // `:userID` and `{user_id}` are the same path.
    //
    // A local re-declaration is not a syntax error and fails no other
    // test. This is the thing that notices.
    const dir = import.meta.dirname;
    const shared = [
      'lineOf', 'joinPath', 'normalizeRoute', 'normalizeUrl',
      'isLikelyApiPath', 'countBraces', 'stripLineComment', 'unwindBlocks',
    ];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      if (file === 'shared.ts' || file.endsWith('.test.ts')) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf-8');
      for (const name of shared) {
        assert.ok(
          !new RegExp(String.raw`\bfunction\s+${name}\s*\(`).test(source),
          `${file} re-declares ${name} instead of importing it from shared.ts`,
        );
      }
    }
  });

  test('no extractor emits a route or call the matcher would drop', () => {
    // The matcher skips any callsite missing a method or urlPattern, so
    // emitting one is silently wasted work.
    const samples: Array<[CallsiteExtractor, string]> = [
      [csharpCallsites, '[Route("api/[controller]")]\npublic class OrdersController {\n[HttpGet]\npublic IActionResult Index() => Ok();\n}'],
      [kotlinCallsites, 'routing {\n  get("/api/x") { }\n}'],
      [swiftCallsites, 'app.get("api", "x") { req in "ok" }'],
      [rubyCallsites, 'resources :orders'],
    ];
    for (const [extractor, src] of samples) {
      const found = extractor.extract(src, 'x');
      assert.ok(found.length > 0, `${extractor.language} found nothing`);
      for (const c of found) {
        assert.ok(c.method, `${extractor.language}: ${c.context} has no method`);
        assert.ok(c.urlPattern, `${extractor.language}: ${c.context} has no urlPattern`);
        assert.ok(c.line > 0, `${extractor.language}: ${c.context} has no line`);
      }
    }
  });
});
