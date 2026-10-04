/**
 * Grant MCP capabilities on a TEST backend, the way a person would in
 * Settings → MCP Server — so a demo, a capture or a test can reach a scene
 * that needs more than the defaults (the `terminal` scene needs `terminal`).
 *
 *   npx tsx scripts/grant.ts terminal                  # the app on :3001
 *   npx tsx scripts/grant.ts terminal capture --data-dir=/tmp/ct --api-port=3002
 *   npm run demo -- --grant=terminal                   # for one demo run
 *
 * This does not get round the rule that granting is the person's
 * (services/grant-guard.ts). The backend decides: only one started with
 * `NODE_ENV=test` and `CODETRELLIS_ALLOW_HTTP_GRANTS=1` — the harnesses, the
 * video captures — accepts a grant over HTTP. A real install refuses it, and
 * this says where the person turns it on instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ALL_CAPABILITIES, DEFAULT_GRANTS, type PeerCapability } from '../../src/backend/services/peer-capabilities';

/** What the grants become with `add` on top of `have` (the defaults when unset). */
export function withGrants(have: readonly string[] | undefined, add: readonly string[]): PeerCapability[] {
  const unknown = add.filter((c) => !ALL_CAPABILITIES.includes(c as PeerCapability));
  if (unknown.length) throw new Error(`Not a capability: ${unknown.join(', ')}. Known: ${ALL_CAPABILITIES.join(', ')}.`);
  return [...new Set([...(have ?? DEFAULT_GRANTS), ...add])] as PeerCapability[];
}

export interface GrantTarget { apiPort: number; token: string }

/** The slice of the settings this reads. */
type McpSettings = { mcp?: { capabilities?: string[] } } | null;

async function call(t: GrantTarget, method: 'GET' | 'PUT', body?: unknown): Promise<McpSettings> {
  const res = await fetch(`http://127.0.0.1:${t.apiPort}/api/settings`, {
    method,
    headers: { 'x-codetrellis-token': t.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 403) {
    throw new Error('This backend takes grants only from the app window: turn them on in Settings → MCP Server. '
      + 'A test backend accepts them over HTTP when started with NODE_ENV=test and CODETRELLIS_ALLOW_HTTP_GRANTS=1.');
  }
  if (!res.ok) throw new Error(`${method} /api/settings answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Adds `add` to the MCP grants. Returns what they were, to put back, and what they are now. */
export async function grantMcpCapabilities(t: GrantTarget, add: readonly string[]): Promise<{ before: PeerCapability[]; now: PeerCapability[] }> {
  const current = await call(t, 'GET');
  const before = withGrants(current?.mcp?.capabilities, []);
  const now = withGrants(before, add);
  await call(t, 'PUT', { mcp: { capabilities: now } });
  return { before, now };
}

/** Puts the MCP grants back to `before`. */
export async function restoreMcpCapabilities(t: GrantTarget, before: readonly PeerCapability[]): Promise<void> {
  await call(t, 'PUT', { mcp: { capabilities: before } });
}

/** The capability token of the app whose data dir this is. */
export function readToken(dataDir: string): string {
  const file = path.join(dataDir, 'capability-token');
  if (!fs.existsSync(file)) throw new Error(`No capability token at ${file}. Is CodeTrellis running? Point at its data dir with --data-dir=…`);
  return fs.readFileSync(file, 'utf-8').trim();
}

/** `scripts/grant.ts`: grant the named capabilities and say what holds now. */
export async function grantCli(argv: string[]): Promise<void> {
  const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const add = argv.filter((a) => !a.startsWith('--'));
  if (!add.length) {
    console.error(`usage: npx tsx scripts/grant.ts <capability …> [--data-dir=…] [--api-port=3001]\n  capabilities: ${ALL_CAPABILITIES.join(', ')}`);
    process.exit(2);
  }
  const dataDir = flag('data-dir') ?? process.env.CODETRELLIS_DATA_DIR ?? path.join(os.homedir(), '.codetrellis');
  const { now } = await grantMcpCapabilities({ apiPort: Number(flag('api-port') ?? 3001), token: readToken(dataDir) }, add);
  console.log(`MCP clients now hold: ${now.join(', ')}`);
}
