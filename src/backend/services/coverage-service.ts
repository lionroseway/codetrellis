import { getDb } from './database';

/**
 * Coverage — what the scan could NOT resolve, and why — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * ## The gap this closes
 *
 * Several resolvers deliberately refuse to guess, and every one of those
 * refusals is correct:
 *
 *   - Swift files inside a module import each other with **no import
 *     statement at all**, so a single-module app has almost no internal
 *     import edges however good the resolver is;
 *   - Rails autoloading writes no `require` — `User` just works;
 *   - a C# `using` names a namespace, not a type.
 *
 * Until this existed, each of those rendered **identically to "this code
 * is not coupled"**. A reader looking at a sparse Swift graph had no way
 * to tell a well-decoupled codebase from one the tool could not read.
 * That is the same confidently-wrong picture Phases 20–28 kept finding,
 * one layer up.
 *
 * ## Why per-language and not just a total
 *
 * `getDbStats()` has always returned `importCount` and `resolvedImports`,
 * and nothing ever read them. A bare total would not have been worth
 * reading either: "41 of 58 resolved" invites the question "is that bad?"
 * and answers nothing. Split by language it becomes an answer, because
 * the *reason* for each gap is a property of the language — which is
 * what `frontend/lib/coverage.ts` turns into a sentence.
 *
 * ## HTTP coverage is the same question for callsites
 *
 * A route with no caller in the repository is not a fault. It might be
 * consumed by something outside the scan, or be genuinely dead, or the
 * caller's own extractor might have missed it. Those are three different
 * situations and the graph shows none of them — an unpaired callsite is
 * simply absent. Counting them at least makes the question askable.
 */

export interface LanguageCoverage {
  language: string;
  /** Imports written in files of this language. */
  imports: number;
  /** …of which resolved to a file inside the scan. */
  resolved: number;
}

/**
 * A call and a route that look like the same endpoint but did not pair.
 *
 * NOT an edge, and deliberately never promoted to one — see
 * `findNearMisses`.
 */
export interface NearMiss {
  method: string;
  /** The call's pattern, as written. */
  callPattern: string;
  /** The route's pattern, as written. */
  routePattern: string;
  callFile: string;
  routeFile: string;
  callLine: number | null;
  routeLine: number | null;
  /** The one segment that differs, for showing the reader why. */
  differingSegment: { position: number; inCall: string; inRoute: string };
}

export interface CoverageReport {
  imports: {
    total: number;
    resolved: number;
    byLanguage: LanguageCoverage[];
  };
  http: {
    /** Inbound routes extracted across the project. */
    routes: number;
    /** Outbound calls extracted across the project. */
    calls: number;
    /** Call↔route pairings the matcher confirmed. */
    edges: number;
    /** Routes nothing in the repository calls. */
    unservedRoutes: number;
    /** Calls no route in the repository serves. */
    unmatchedCalls: number;
    /**
     * Unpaired calls and routes that look like the same endpoint.
     * Capped — see `MAX_NEAR_MISSES`.
     */
    nearMisses: NearMiss[];
  };
}

const EMPTY: CoverageReport = {
  imports: { total: 0, resolved: 0, byLanguage: [] },
  http: { routes: 0, calls: 0, edges: 0, unservedRoutes: 0, unmatchedCalls: 0, nearMisses: [] },
};

/**
 * A panel is not a report. Past a couple of dozen the reader stops
 * reading, and a scan of a large monorepo could produce hundreds.
 */
const MAX_NEAR_MISSES = 25;

/**
 * `cross_system_edges.label` is `${METHOD} ${urlPattern}` — built in
 * `cross-system-service` when a pairing is confirmed. Reconstructing it
 * here is how a callsite is matched back to the edge it produced, and it
 * has to stay in step with that construction. If the two ever disagree,
 * every callsite reads as unpaired rather than erroring, so the
 * acceptance test asserts a paired callsite is counted as paired.
 */
const LABEL_EXPR = `(c.method || ' ' || c.url_pattern)`;

function scalar(sql: string): number {
  try {
    const rows = getDb().exec(sql);
    return (rows[0]?.values[0]?.[0] as number) ?? 0;
  } catch {
    return 0;
  }
}


// ── Near misses ─────────────────────────────────────────────────────

interface UnpairedCallsite {
  method: string;
  pattern: string;
  file: string;
  line: number | null;
}

/**
 * A call and a route that look like the same endpoint but did not pair.
 *
 * ## Why this is not just a looser matcher
 *
 * `cross-system-service` pairs by exact string equality and has no fuzzy
 * fallback. Its own comment gives the reason — false positives erode
 * trust faster than missed pairs — and that judgement is still right
 * **for drawing an edge**. A wrong line on the architecture diagram is
 * worse than a missing one, because a reader believes it.
 *
 * But the commonest reason a pairing fails is not ambiguity at all:
 *
 *     call   GET /api/ledger/42
 *     route  GET /api/ledger/:id
 *
 * 42 is a value and `:id` is a pattern. They cannot be equal and they
 * are obviously the same endpoint. Saying so is useful; drawing it is
 * not, because we cannot prove `42` is an id rather than a literal path
 * segment the route does not serve.
 *
 * So this is reported as a **suggestion**, never as an edge, and the
 * rule is deliberately strict rather than fuzzy:
 *
 *   - same HTTP method;
 *   - same number of path segments;
 *   - every segment equal except **exactly one**;
 *   - and at that position the route holds a parameter (`:id`) while the
 *     call holds a concrete value.
 *
 * Two differing segments, or a difference where neither side is a
 * parameter, is not a near miss — it is two different endpoints. That
 * strictness is the point: a suggestion a reader has to double-check is
 * worth less than no suggestion.
 */
export function findNearMisses(
  calls: readonly UnpairedCallsite[],
  routes: readonly UnpairedCallsite[],
): NearMiss[] {
  const out: NearMiss[] = [];

  for (const call of calls) {
    const callSegs = call.pattern.split('/');
    for (const route of routes) {
      if (call.method !== route.method) continue;
      const routeSegs = route.pattern.split('/');
      if (routeSegs.length !== callSegs.length) continue;

      let differing = -1;
      let ok = true;
      for (let i = 0; i < callSegs.length; i++) {
        if (callSegs[i] === routeSegs[i]) continue;
        if (differing !== -1) { ok = false; break; }   // a second difference
        // The route side must be the parameter. A call holding `:id`
        // against a route holding a literal is not the same shape.
        if (!routeSegs[i].startsWith(':') || callSegs[i] === '') { ok = false; break; }
        differing = i;
      }
      if (!ok || differing === -1) continue;

      out.push({
        method: call.method,
        callPattern: call.pattern,
        routePattern: route.pattern,
        callFile: call.file,
        routeFile: route.file,
        callLine: call.line,
        routeLine: route.line,
        differingSegment: {
          position: differing,
          inCall: callSegs[differing],
          inRoute: routeSegs[differing],
        },
      });
      if (out.length >= MAX_NEAR_MISSES) return out;
    }
  }

  return out;
}

/** Unpaired callsites of one kind, with the detail a near miss needs. */
function unpairedCallsites(kind: 'http_call' | 'http_route'): UnpairedCallsite[] {
  const side = kind === 'http_call' ? 'source_file_id' : 'target_file_id';
  try {
    const rows = getDb().exec(`
      SELECT c.method, c.url_pattern, f.relative_path, c.line
      FROM callsites c
      JOIN files f ON c.file_id = f.id
      WHERE c.kind = '${kind}'
        AND c.method IS NOT NULL AND c.url_pattern IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM cross_system_edges e
          WHERE e.${side} = c.file_id AND e.label = ${LABEL_EXPR}
        )
    `);
    return (rows[0]?.values ?? []).map((r: unknown[]) => ({
      method: r[0] as string,
      pattern: r[1] as string,
      file: (r[2] as string) ?? '',
      line: (r[3] as number | null) ?? null,
    }));
  } catch {
    return [];
  }
}

export function getCoverageReport(): CoverageReport {
  const db = getDb();

  let byLanguage: LanguageCoverage[] = [];
  let total = 0;
  let resolved = 0;
  try {
    // `resolved_path` is added by the schema reconciler rather than the
    // base schema, so a database that predates it must degrade to zeroes
    // instead of throwing — the same guard `getDbStats` uses.
    const rows = db.exec(`
      SELECT f.language,
             COUNT(*) AS total,
             SUM(CASE WHEN i.resolved_path IS NOT NULL THEN 1 ELSE 0 END) AS resolved
      FROM imports i
      JOIN files f ON i.file_id = f.id
      GROUP BY f.language
      ORDER BY total DESC
    `);
    byLanguage = (rows[0]?.values ?? []).map((r: unknown[]) => ({
      language: (r[0] as string) || 'unknown',
      imports: (r[1] as number) || 0,
      resolved: (r[2] as number) || 0,
    }));
    for (const entry of byLanguage) {
      total += entry.imports;
      resolved += entry.resolved;
    }
  } catch {
    byLanguage = [];
  }

  const routes = scalar(`SELECT COUNT(*) FROM callsites WHERE kind = 'http_route'`);
  const calls = scalar(`SELECT COUNT(*) FROM callsites WHERE kind = 'http_call'`);
  const edges = scalar(`SELECT COUNT(*) FROM cross_system_edges WHERE protocol = 'http'`);

  const unservedRoutes = scalar(`
    SELECT COUNT(*) FROM callsites c
    WHERE c.kind = 'http_route'
      AND c.method IS NOT NULL AND c.url_pattern IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM cross_system_edges e
        WHERE e.target_file_id = c.file_id AND e.label = ${LABEL_EXPR}
      )
  `);

  const unmatchedCalls = scalar(`
    SELECT COUNT(*) FROM callsites c
    WHERE c.kind = 'http_call'
      AND c.method IS NOT NULL AND c.url_pattern IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM cross_system_edges e
        WHERE e.source_file_id = c.file_id AND e.label = ${LABEL_EXPR}
      )
  `);

  const nearMisses = unmatchedCalls > 0 && unservedRoutes > 0
    ? findNearMisses(unpairedCallsites('http_call'), unpairedCallsites('http_route'))
    : [];

  return {
    imports: { total, resolved, byLanguage },
    http: { routes, calls, edges, unservedRoutes, unmatchedCalls, nearMisses },
  };
}

export function emptyCoverageReport(): CoverageReport {
  return structuredClone(EMPTY);
}
