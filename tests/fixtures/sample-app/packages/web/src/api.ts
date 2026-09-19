/**
 * HTTP client for the fixture's backend services.
 *
 * Most cross-system edges in this fixture start here — the harness
 * asserts that four `fetch(...)` calls match four corresponding
 * `@router.{get,post}(...)` declarations in `services/api/app/routes/`
 * (Python), and that one more matches a chi route in
 * `services/billing/main.go` (Go, Phase 20).
 *
 * The Go service also calls the Python service directly
 * (`services/billing/client/orders.go`), so not every edge originates
 * in this file.
 */

import type { User, Order, CreateUserPayload, CreateOrderPayload } from '@sample/shared';

// NOTE: paths are plain string literals (not template literals with a
// `${API_BASE}` prefix) on purpose — the cross-system matcher MVP
// does literal-string comparison against the decorator path on the
// Python side. When OpenAPI / base-URL awareness lands, switch this
// to the more realistic style.

export async function listUsers(): Promise<User[]> {
  const res = await fetch('/api/users');
  if (!res.ok) throw new Error(`listUsers failed: ${res.status}`);
  return res.json();
}

export async function createUser(payload: CreateUserPayload): Promise<User> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createUser failed: ${res.status}`);
  return res.json();
}

export async function listOrders(): Promise<Order[]> {
  const res = await fetch('/api/orders');
  if (!res.ok) throw new Error(`listOrders failed: ${res.status}`);
  return res.json();
}

export async function createOrder(payload: CreateOrderPayload): Promise<Order> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createOrder failed: ${res.status}`);
  return res.json();
}

export async function listInvoices(): Promise<unknown[]> {
  // Pairs with the Go billing service's chi route, which is registered
  // inside `r.Route("/api/billing", ...)` — so this literal only
  // matches if the extractor resolves the group prefix.
  const res = await fetch('/api/billing/invoices');
  if (!res.ok) throw new Error(`listInvoices failed: ${res.status}`);
  return res.json();
}
