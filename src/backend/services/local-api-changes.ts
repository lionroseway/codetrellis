/**
 * Changes over the local API can be turned off (owner's decision, Phase 32,
 * carried item 2b).
 *
 * The per-launch token opens the REST API to anything on this machine that
 * can read it: the web build in a browser, a script, another tool. Their
 * changes are recorded as `unverified` (see `personFrom` / `actorFrom` in
 * server.ts) and tagged so on screen, which keeps them auditable. A person
 * who wants no such changes at all turns them off: then only the app window
 * changes anything, and every other change is refused with where to turn
 * them back on. Reading is unaffected, and still needs the token.
 *
 * MCP and the paired phone are their own transports, authorised on their
 * own terms (per-tool capabilities; per-device grants), and are not touched.
 */

/** Methods that only read. Anything else is a change. */
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const LOCAL_API_CHANGES_WHERE = 'Settings → MCP Server → Local API';

export const LOCAL_API_CHANGES_REFUSAL =
  `Changes over the local API are turned off. Turn them back on in the CodeTrellis app, ${LOCAL_API_CHANGES_WHERE}.`;

/**
 * Should this request be refused? Pure.
 *
 *  - `accept` is the setting; absent means on.
 *  - `testSettingsPath`: on a test backend that may grant over HTTP, the
 *    settings route stays reachable so a harness can turn changes back on.
 *    The grant rule still decides who may flip the setting.
 */
export function refusesLocalApiChange(req: { method: string; path: string; fromAppWindow: boolean }, accept: boolean | undefined, testSettingsPath = false): boolean {
  if (accept !== false) return false;
  if (req.fromAppWindow || READS.has(req.method.toUpperCase())) return false;
  if (!req.path.startsWith('/api/')) return false;
  if (testSettingsPath && req.path === '/api/settings') return false;
  return true;
}
