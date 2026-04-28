/**
 * HTTP client for the Python API.
 *
 * Every cross-system edge in this fixture starts here — the
 * harness asserts that exactly four `fetch(...)` calls match
 * four corresponding `@router.{get,post}(...)` declarations
 * in `services/api/app/routes/`.
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
