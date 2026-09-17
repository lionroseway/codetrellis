/**
 * Unit tests for the Go callsite extractor (Phase 20).
 *
 * These run under `npm run test:unit` — no backend, no grammar, no
 * harness — because the extractor is pure string-in / callsites-out.
 *
 * The prefix cases are the point. A regex that reads `r.Get("/users")`
 * and reports `/users` is wrong for most production Go, where routers
 * are grouped; these tests pin the two mechanisms that carry a prefix
 * (chi's block-scoped `Route`, and the variable-bound `Group` /
 * `Subrouter` used by gin, echo and gorilla).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { goCallsites } from './go';

const routesOf = (src: string) =>
  goCallsites.extract(src, 'main.go').filter((c) => c.kind === 'http_route');
const callsOf = (src: string) =>
  goCallsites.extract(src, 'client.go').filter((c) => c.kind === 'http_call');

describe('inbound routes', () => {
  test('stdlib http.HandleFunc', () => {
    const routes = routesOf(`
func main() {
	http.HandleFunc("/api/health", healthz)
}
`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].urlPattern, '/api/health');
  });

  test('Go 1.22 method-in-pattern form', () => {
    const routes = routesOf(`mux.HandleFunc("GET /api/users", listUsers)`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].method, 'GET');
    assert.equal(routes[0].urlPattern, '/api/users');
  });

  test('gorilla .Methods() suffix supplies the verbs', () => {
    const routes = routesOf(`r.HandleFunc("/api/users", h).Methods("GET", "POST")`);
    assert.deepEqual(routes.map((r) => r.method).sort(), ['GET', 'POST']);
    for (const r of routes) assert.equal(r.urlPattern, '/api/users');
  });

  test('chi block-scoped Route prefix applies inside the closure only', () => {
    const routes = routesOf(`
func main() {
	r.Route("/api/billing", func(r chi.Router) {
		r.Get("/invoices", listInvoices)
		r.Post("/invoices", createInvoice)
	})
	r.Get("/healthz", healthz)
}
`);
    const byPattern = routes.map((r) => `${r.method} ${r.urlPattern}`).sort();
    assert.deepEqual(byPattern, [
      'GET /api/billing/invoices',
      'GET /healthz',
      'POST /api/billing/invoices',
    ]);
  });

  test('nested chi Route blocks compose', () => {
    const routes = routesOf(`
r.Route("/api", func(r chi.Router) {
	r.Route("/v2", func(r chi.Router) {
		r.Get("/orders", listOrders)
	})
})
`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].urlPattern, '/api/v2/orders');
  });

  test('gin variable-bound Group prefix', () => {
    const routes = routesOf(`
v1 := r.Group("/api/v1")
v1.POST("/users", createUser)
`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].method, 'POST');
    assert.equal(routes[0].urlPattern, '/api/v1/users');
  });

  test('nested groups compose regardless of declaration order', () => {
    const routes = routesOf(`
admin := api.Group("/admin")
api := r.Group("/api")
admin.GET("/users", listUsers)
`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].urlPattern, '/api/admin/users');
  });

  test('gorilla PathPrefix + Subrouter binds a prefix', () => {
    const routes = routesOf(`
s := r.PathPrefix("/api").Subrouter()
s.HandleFunc("/orders", listOrders).Methods("GET")
`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].urlPattern, '/api/orders');
  });

  test('path parameters normalise to :id in both Go styles', () => {
    const chi = routesOf(`r.Get("/api/users/{userID}", getUser)`);
    const gin = routesOf(`r.GET("/api/users/:userID", getUser)`);
    assert.equal(chi[0].urlPattern, '/api/users/:id');
    assert.equal(gin[0].urlPattern, '/api/users/:id');
  });

  test('commented-out routes are ignored, but URLs containing // are not', () => {
    const commented = routesOf(`// r.Get("/api/dead", gone)`);
    assert.equal(commented.length, 0);

    const live = callsOf(`resp, _ := http.Get("http://svc.internal/api/live")`);
    assert.equal(live.length, 1);
    assert.equal(live[0].urlPattern, '/api/live');
  });
});

describe('outbound calls', () => {
  test('http.Get with an absolute path', () => {
    const calls = callsOf(`http.Get("/api/orders")`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].urlPattern, '/api/orders');
  });

  test('http.NewRequestWithContext with fmt.Sprintf keeps the literal tail', () => {
    const calls = callsOf(`
req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/orders", BaseURL), nil)
`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].urlPattern, '/api/orders');
  });

  test('non-route strings are not treated as calls', () => {
    assert.equal(callsOf(`http.Get("not-a-path")`).length, 0);
    assert.equal(callsOf(`http.Get("https://example.com/status")`).length, 0);
  });
});
