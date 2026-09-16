/**
 * Per-launch capability token for the local transports.
 *
 * WHY THIS EXISTS
 *
 * Loopback is not an authorisation boundary. The Express API, the WebSocket
 * and the MCP server all bind 127.0.0.1, and the instinct is that this means
 * "only the user and their agent can reach it". It does not: **any web page
 * the user visits can issue requests to 127.0.0.1**. Before this file, the
 * CORS middleware also reflected the caller's origin back with
 * `Access-Control-Allow-Credentials: true`, so such a page could not only
 * send requests but read the responses — arbitrary file reads, directory
 * enumeration, terminal control.
 *
 * WHY A FILE, NOT AN ACCOUNT
 *
 * CodeTrellis is deliberately local-first, server-free and agent-agnostic.
 * Authentication here must not require a server, an account, or a login, and
 * it must not stop an arbitrary MCP client the user has configured from
 * connecting.
 *
 * A secret in a file with user-only permissions satisfies all of that:
 *
 *   - Any process running AS THE USER can read it — so Claude Code, Codex,
 *     Cursor, aider or a custom client all still work.
 *   - A web page CANNOT read it. A browser has no filesystem access, which
 *     is precisely the attacker this is aimed at.
 *
 * This is how VS Code, Jupyter and Docker Desktop all secure local APIs. The
 * design story survives intact.
 *
 * LIFECYCLE
 *
 * Minted fresh on every launch and written to `<dataDir>/capability-token`
 * with mode 0600. Per-launch rather than persistent so a token that leaks
 * (a screenshot, a pasted log) stops working when the app restarts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { getDataDir, ensureDataDir } from './persistence';

/** Header clients should send. `Authorization: Bearer <token>` also works. */
export const TOKEN_HEADER = 'x-codetrellis-token';

/**
 * Query parameter accepted as a fallback.
 *
 * Needed because EventSource (used by MCP's SSE transport) and the browser
 * WebSocket constructor cannot set custom headers. Query strings land in
 * logs more readily than headers do, which is a real downside — but the
 * alternative is leaving those two transports unauthenticated, and the token
 * is per-launch and loopback-scoped.
 */
export const TOKEN_QUERY_PARAM = 'ct_token';

/** Env var that overrides the minted token. Used by the E2E harness. */
export const TOKEN_ENV_VAR = 'CODETRELLIS_CAPABILITY_TOKEN';

let token: string | null = null;

/** Absolute path of the token file. Clients read this to authenticate. */
export function getTokenFilePath(): string {
  return path.join(getDataDir(), 'capability-token');
}

/**
 * Mint (or adopt) this launch's token and persist it for local clients.
 *
 * Idempotent: repeated calls return the same token for the process lifetime.
 */
export function initCapabilityToken(): string {
  if (token) return token;

  // An explicit env var wins. The E2E harness sets this so it can authenticate
  // without racing the file write, and it gives an operator an escape hatch.
  const fromEnv = process.env[TOKEN_ENV_VAR];
  if (fromEnv && fromEnv.trim().length >= 16) {
    token = fromEnv.trim();
  } else {
    token = crypto.randomBytes(32).toString('hex');
  }

  try {
    ensureDataDir();
    const file = getTokenFilePath();
    // 0600 BEFORE the content exists: writing then chmod-ing leaves a window
    // where the secret is on disk world-readable.
    fs.writeFileSync(file, token, { encoding: 'utf-8', mode: 0o600 });
    // writeFileSync's mode is ignored when the file already exists, so set it
    // explicitly for the overwrite case.
    fs.chmodSync(file, 0o600);
  } catch (err) {
    // Not fatal. A token that cannot be published still protects the
    // transports; it just means local clients have to be told it another way.
    // Failing the boot over this would be worse than the degraded state.
    console.warn('[Auth] Could not write the capability token file:', err);
  }

  return token;
}

/** The current token. Mints one if called before `initCapabilityToken()`. */
export function getCapabilityToken(): string {
  return token ?? initCapabilityToken();
}

/**
 * Constant-time comparison.
 *
 * `===` on secrets leaks length and prefix through timing. The window is
 * small on loopback, but this costs nothing.
 */
export function verifyCapabilityToken(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  const expected = getCapabilityToken();
  const a = Buffer.from(candidate, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Pull a token out of a request, in header-then-query order.
 *
 * Accepts `X-CodeTrellis-Token`, `Authorization: Bearer …`, and the
 * `ct_token` query parameter.
 */
export function extractToken(
  headers: Record<string, string | string[] | undefined>,
  url?: string,
): string | null {
  const raw = headers[TOKEN_HEADER];
  const direct = Array.isArray(raw) ? raw[0] : raw;
  if (direct) return direct;

  const authRaw = headers['authorization'];
  const auth = Array.isArray(authRaw) ? authRaw[0] : authRaw;
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();

  if (url) {
    try {
      // Base is irrelevant — we only want the query string.
      const parsed = new URL(url, 'http://127.0.0.1');
      const q = parsed.searchParams.get(TOKEN_QUERY_PARAM);
      if (q) return q;
    } catch {
      /* malformed URL — treat as no token */
    }
  }

  return null;
}
