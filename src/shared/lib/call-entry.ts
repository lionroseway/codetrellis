/**
 * Phase 33 R7 — a call out of the code, as a call rule names it
 * (RULES-AND-CLARITY §3.3).
 *
 * The callsite extractors find where code calls an HTTP endpoint or touches a
 * SQL table (`services/callsites/`, `services/sql/`). A call entry names one:
 *
 *  - `http:api.stripe.com/v1/charges`: a host and the path, normalised the
 *    way the cross-system matcher normalises it (`callsites/shared.ts`);
 *    `http:/api/users` when the URL names no host;
 *  - `sql:payments`: a table;
 *  - `exec:git`: a program the code runs, and `env:STRIPE_SECRET_KEY`: an
 *    environment variable it reads (Phase 33 follow-up). Only literals.
 *
 * A call rule names a host (`http:api.stripe.com`), a host and a path prefix
 * (`http:api.stripe.com/v1/charges`), a path (`http:/api/admin`) or a table
 * (`sql:payments`), and says who alone may make that call.
 *
 * Phase 33 B4: a team's own patterns (`.codetrellis/patterns/`) may name kinds
 * of entry CodeTrellis has never heard of: `queue:orders.created`,
 * `event:user.signup`, `flag:new-checkout`. Any lowercase word that is not a
 * package ecosystem or a kind of its own (`grep`, `file`, `folder`) is one,
 * and a call rule holds it as it holds an HTTP call: `queue:orders` is that
 * name and everything under it, by `.`, `/` or `:`.
 */
import { PACKAGE_ECOSYSTEMS } from './package-entry';

const CALL_RE = /^([a-z][a-z0-9-]{0,30}):(\S.*)$/;
/** Kinds an entry may not take: packages, and CodeTrellis's own facts. */
const NOT_CALLS = new Set<string>([...PACKAGE_ECOSYSTEMS, 'grep', 'file', 'folder']);

export type CallProtocol = 'http' | 'sql';

const callParts = (s: string): [string, string] | null => {
  const m = CALL_RE.exec(s);
  return m && !NOT_CALLS.has(m[1]) ? [m[1], m[2]] : null;
};

/** Whether `s` is a call entry (HTTP, SQL or a team's own kind), not a path, a package or a symbol. */
export function isCallEntry(s: string): boolean {
  return callParts(s) !== null;
}

/** Whether a call entry is of a team's own kind (B4), not HTTP or SQL. */
export function isOwnKind(s: string): boolean {
  const p = callParts(s);
  return !!p && p[0] !== 'http' && p[0] !== 'sql';
}

/** The entry for one callsite, or null when it is neither an HTTP call nor a SQL table. */
export function callEntry(cs: { kind: string; urlPattern?: string | null; host?: string | null }): string | null {
  if (cs.kind === 'http_call') {
    const p = cs.urlPattern ?? '';
    if (!cs.host && !p) return null;
    return `http:${cs.host ?? ''}${p === '/' && cs.host ? '' : p}`;
  }
  if (cs.kind === 'sql_query' && cs.urlPattern) return `sql:${cs.urlPattern.toLowerCase()}`;
  // A command a file runs, and an environment variable it reads (Phase 33 follow-up).
  if (cs.kind === 'subprocess' && cs.urlPattern) return `exec:${cs.urlPattern}`;
  if (cs.kind === 'env_lookup' && cs.urlPattern) return `env:${cs.urlPattern}`;
  // B4: a team's own kind, found by its patterns, is its entry as written.
  if (cs.kind === 'entry' && cs.urlPattern && isOwnKind(cs.urlPattern)) return cs.urlPattern;
  return null;
}

/** Why a written call is not one, or null. */
export function callProblem(s: unknown): string | null {
  const m = typeof s === 'string' ? callParts(s.trim()) : null;
  if (!m) return 'calls must be http: and a host or a path, sql: and a table, or a kind of your own and a name, like http:api.stripe.com, sql:payments or queue:orders';
  const rest = m[1];
  if (m[0] !== 'http' && m[0] !== 'sql') return /\s/.test(rest) ? `a ${m[0]} entry is one name, with no spaces, like ${m[0]}:orders.created` : null;
  if (m[0] === 'http' && !/^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+|localhost)?(?:\/\S*)?$/i.test(rest)) return 'an http call is a host, a path, or both, like api.stripe.com/v1/charges';
  if (m[0] === 'sql' && !/^[A-Za-z_][\w.]*$/.test(rest)) return 'a sql call is a table name, like payments';
  return null;
}

/** A rule's call as it is kept: the host lowercase, no trailing slash. */
export function normaliseCall(s: string): string {
  const m = CALL_RE.exec(s.trim())!;
  if (m[1] === 'sql') return `sql:${m[2].toLowerCase()}`;
  if (m[1] !== 'http') return `${m[1]}:${m[2]}`;
  const slash = m[2].indexOf('/');
  const host = (slash < 0 ? m[2] : m[2].slice(0, slash)).toLowerCase();
  const path = slash < 0 ? '' : m[2].slice(slash).replace(/\/+$/, '');
  return `http:${host}${path}`;
}

/**
 * Whether a call the code makes is the rule's: the same table; or the same
 * host (any path under the rule's), or for a rule naming only a path, that
 * path or under it on any host.
 */
export function callMatches(ruleCall: string, entry: string): boolean {
  const r = callParts(ruleCall);
  const e = callParts(entry);
  if (!r || !e || r[0] !== e[0]) return false;
  if (r[0] === 'sql') return r[1] === e[1];
  // B4: a name of the team's own kind, and everything under it by `.`, `/` or `:`.
  if (r[0] !== 'http') return e[1] === r[1] || ['.', '/', ':'].some((sep) => e[1].startsWith(r[1] + sep));
  const under = (path: string, prefix: string) => prefix === '' || path === prefix || path.startsWith(`${prefix}/`);
  const split = (x: string) => { const i = x.indexOf('/'); return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i)]; };
  const [rh, rp] = split(r[1]);
  const [eh, ep] = split(e[1]);
  if (rh === '') return under(ep, rp);
  return rh === eh && under(ep, rp);
}

/** "api.stripe.com", "the table payments": what a rule or finding calls, in words. */
export function callWords(entry: string): string {
  const m = callParts(entry);
  if (!m) return entry;
  // B4: a team's own kind is said whole, so the reader knows what kind it is.
  if (m[0] === 'exec') return m[1] === '*' ? 'any command' : `the command ${m[1]}`;
  if (m[0] === 'env') return m[1] === '*' ? 'any environment variable' : `the environment variable ${m[1]}`;
  return m[0] === 'sql' ? `the table ${m[1]}` : m[0] === 'http' ? m[1] : entry;
}
