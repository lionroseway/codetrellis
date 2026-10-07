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
 *  - `sql:payments`: a table.
 *
 * A call rule names a host (`http:api.stripe.com`), a host and a path prefix
 * (`http:api.stripe.com/v1/charges`), a path (`http:/api/admin`) or a table
 * (`sql:payments`), and says who alone may make that call.
 */

const CALL_RE = /^(http|sql):(.+)$/;

export type CallProtocol = 'http' | 'sql';

/** Whether `s` is a call entry, not a path, a package or a symbol. */
export function isCallEntry(s: string): boolean {
  return CALL_RE.test(s);
}

/** The entry for one callsite, or null when it is neither an HTTP call nor a SQL table. */
export function callEntry(cs: { kind: string; urlPattern?: string | null; host?: string | null }): string | null {
  if (cs.kind === 'http_call') {
    const p = cs.urlPattern ?? '';
    if (!cs.host && !p) return null;
    return `http:${cs.host ?? ''}${p === '/' && cs.host ? '' : p}`;
  }
  if (cs.kind === 'sql_query' && cs.urlPattern) return `sql:${cs.urlPattern.toLowerCase()}`;
  return null;
}

/** Why a written call is not one, or null. */
export function callProblem(s: unknown): string | null {
  const m = typeof s === 'string' ? CALL_RE.exec(s.trim()) : null;
  if (!m) return 'calls must be http: and a host or a path, or sql: and a table, like http:api.stripe.com or sql:payments';
  const rest = m[2];
  if (m[1] === 'http' && !/^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+|localhost)?(?:\/\S*)?$/i.test(rest)) return 'an http call is a host, a path, or both, like api.stripe.com/v1/charges';
  if (m[1] === 'sql' && !/^[A-Za-z_][\w.]*$/.test(rest)) return 'a sql call is a table name, like payments';
  return null;
}

/** A rule's call as it is kept: the host lowercase, no trailing slash. */
export function normaliseCall(s: string): string {
  const m = CALL_RE.exec(s.trim())!;
  if (m[1] === 'sql') return `sql:${m[2].toLowerCase()}`;
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
  const r = CALL_RE.exec(ruleCall);
  const e = CALL_RE.exec(entry);
  if (!r || !e || r[1] !== e[1]) return false;
  if (r[1] === 'sql') return r[2] === e[2];
  const under = (path: string, prefix: string) => prefix === '' || path === prefix || path.startsWith(`${prefix}/`);
  const split = (x: string) => { const i = x.indexOf('/'); return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i)]; };
  const [rh, rp] = split(r[2]);
  const [eh, ep] = split(e[2]);
  if (rh === '') return under(ep, rp);
  return rh === eh && under(ep, rp);
}

/** "api.stripe.com", "the table payments": what a rule or finding calls, in words. */
export function callWords(entry: string): string {
  const m = CALL_RE.exec(entry);
  if (!m) return entry;
  return m[1] === 'sql' ? `the table ${m[2]}` : m[2];
}
