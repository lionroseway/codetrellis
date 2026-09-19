/**
 * `receiver.Verb("literal")` is not enough to call something HTTP.
 *
 * Two languages, one mistake. A map lookup, a config read and a Spring
 * MockMvc assertion are all spelled exactly like a route registration or
 * an outbound call, and both extractors took the shape at face value.
 *
 * The damage is not a stray row. `cross-system-service` pairs inbound
 * routes with outbound calls by path, so a cache key that happens to
 * look like a path becomes an ENDPOINT, and any call anywhere in the
 * scanned estate whose path matches draws an edge to it. The graph gains
 * a coupling between two services that share nothing but a string.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { goCallsites } from './go';
import { kotlinCallsites } from './kotlin';

const routes = (src: string) =>
  goCallsites.extract(src, '/repo/main.go').filter((c) => c.kind === 'http_route');
const calls = (src: string) =>
  kotlinCallsites.extract(src, '/repo/Svc.kt').filter((c) => c.kind === 'http_call');

describe('Go route literals must look like paths (m18)', () => {
  test('a cache or config Get is not a route', () => {
    const found = routes(`
func handler(w http.ResponseWriter, r *http.Request) {
	v := cache.Get("session-key")
	timeout := cfg.Get("http.timeout")
	_ = v
	_ = timeout
}
`);
    assert.deepEqual(found, [], `invented routes: ${found.map((c) => c.urlPattern).join(', ')}`);
  });

  test('a real registration is still a route', () => {
    const found = routes(`
func main() {
	r := chi.NewRouter()
	r.Get("/users/{id}", getUser)
	r.Post("/users", createUser)
}
`);
    assert.deepEqual(
      found.map((c) => `${c.method} ${c.urlPattern}`).sort(),
      ['GET /users/:id', 'POST /users'],
    );
  });

  test('a group-relative registration is still a route', () => {
    // gin accepts `v1.GET("users", h)` because the group carries the
    // slash. Rejecting every slashless literal outright would lose these,
    // so the opening is narrowed to receivers already seen as groups
    // rather than closed.
    const found = routes(`
func main() {
	r := gin.Default()
	v1 := r.Group("/api/v1")
	v1.GET("users", listUsers)
}
`);
    assert.deepEqual(found.map((c) => `${c.method} ${c.urlPattern}`), ['GET /api/v1/users']);
  });

  test('HandleFunc with a Go 1.22 pattern is still a route, a map Handle is not', () => {
    const found = routes(`
func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz)
	registry.Handle("worker-pool", pool)
}
`);
    assert.deepEqual(found.map((c) => `${c.method} ${c.urlPattern}`), ['GET /healthz']);
  });
});

describe('Kotlin outbound calls need a client receiver (m17)', () => {
  test('MockMvc assertions are not outbound calls', () => {
    // This is a test asserting on a route the service OWNS. Read as an
    // outbound call it gave the service an HTTP edge to itself, sourced
    // from its own test suite — a self-loop that looks like a finding.
    const found = calls(`
class OrderControllerTest {
    @Test
    fun \`lists orders\`() {
        mockMvc.get("/api/orders") {
            accept = MediaType.APPLICATION_JSON
        }.andExpect { status { isOk() } }
    }
}
`);
    assert.deepEqual(found, [], `invented calls: ${found.map((c) => c.urlPattern).join(', ')}`);
  });

  test('a map-shaped receiver is not an outbound call', () => {
    const found = calls(`
val region = config.get("/aws/region")
val cached = cache.get("/users/me")
`);
    assert.deepEqual(found, []);
  });

  test('a real client call is still an outbound call', () => {
    const found = calls(`
suspend fun fetchOrders() = httpClient.get("https://billing.internal/api/orders")
suspend fun createOrder() = client.post("/api/orders")
`);
    assert.deepEqual(
      found.map((c) => `${c.method} ${c.urlPattern}`).sort(),
      ['GET /api/orders', 'POST /api/orders'],
    );
  });
});
