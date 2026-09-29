/**
 * The phone's RPC in the preview (Phase 32 A4.5a): answered from the fixtures
 * the test puts on the page (`window.__PHONE__.rpc`), and every call recorded
 * (`window.__PHONE__.calls`) so a test can see what a tap sent.
 *
 * A fixture is a value, or a function of the params. A method with no
 * fixture fails the way a desktop without it would.
 */

type Fixture = unknown | ((params: Record<string, unknown>) => unknown);
interface PhoneFixtures { rpc?: Record<string, Fixture>; calls?: Array<{ method: string; params: Record<string, unknown> }> }

function fixtures(): PhoneFixtures {
  const w = window as unknown as { __PHONE__?: PhoneFixtures };
  w.__PHONE__ ??= {};
  w.__PHONE__.calls ??= [];
  return w.__PHONE__;
}

export async function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const f = fixtures();
  f.calls!.push({ method, params });
  const answer = f.rpc?.[method];
  if (answer === undefined) throw new Error(`Unknown method: ${method}`);
  const value = typeof answer === 'function' ? (answer as (p: Record<string, unknown>) => unknown)(params) : answer;
  if (value instanceof Error) throw value;
  return value as T;
}

export function handleRpcResponse(): boolean { return false; }
export function cancelAllPendingRpc(): void {}
