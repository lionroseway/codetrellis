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
  };
}

const EMPTY: CoverageReport = {
  imports: { total: 0, resolved: 0, byLanguage: [] },
  http: { routes: 0, calls: 0, edges: 0, unservedRoutes: 0, unmatchedCalls: 0 },
};

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

  return {
    imports: { total, resolved, byLanguage },
    http: { routes, calls, edges, unservedRoutes, unmatchedCalls },
  };
}

export function emptyCoverageReport(): CoverageReport {
  return structuredClone(EMPTY);
}
