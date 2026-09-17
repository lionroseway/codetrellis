/**
 * Cross-system edges — non-import couplings between files.
 *
 * Pulls every callsite the parsers stored, runs per-protocol matchers,
 * and writes the resulting `cross_system_edges` rows. Two matchers now:
 *
 *   - **HTTP** — a `fetch` / `axios` / `http.Get` call paired with the
 *     route declaration that serves it, in any language.
 *   - **SQL** (Phase 21) — a table reference in application code paired
 *     with the `.sql` file that CREATEs that table, carrying whether the
 *     reference reads or writes.
 *
 * Together they make a path like
 * `OrdersPage.tsx → billing/main.go → 003_create_orders.sql` traversable
 * in one graph. Subprocess, env and OpenAPI come later.
 *
 * Renderer-side, edges merge into the dependency graph alongside
 * imports (see `getAllGraphEdges` below) so callers can pass a single
 * list to ReactFlow with a kind discriminator.
 */

import { getDb } from './database';

export interface CrossSystemEdge {
  source: string;          // absolute path
  target: string;          // absolute path
  sourceRelative: string;
  targetRelative: string;
  protocol: string;
  label: string;           // e.g. "GET /api/users"
  confidence: number;
}

interface CallsiteRow {
  fileId: number;
  filePath: string;
  fileRel: string;
  kind: string;
  protocol: string;
  method: string | null;
  urlPattern: string | null;
  line: number | null;
  language: string | null;
}

/**
 * Recompute every cross-system edge from the current callsites table.
 * Idempotent — wipes and re-inserts the entire `cross_system_edges`
 * table. Cheap because the table is tiny (one row per matched pair,
 * not per file).
 */
export function recomputeCrossSystemEdges(): { added: number } {
  const db = getDb();

  let result;
  try {
    result = db.exec(`
      SELECT c.file_id, f.path, f.relative_path, c.kind, c.protocol, c.method, c.url_pattern, c.line,
             f.language
      FROM callsites c
      JOIN files f ON c.file_id = f.id
    `);
  } catch {
    // callsites table missing → nothing to do.
    return { added: 0 };
  }

  const rows: CallsiteRow[] = (result[0]?.values ?? []).map((r: any[]) => ({
    fileId: r[0] as number,
    filePath: r[1] as string,
    fileRel: r[2] as string,
    kind: r[3] as string,
    protocol: r[4] as string,
    method: (r[5] as string | null) ?? null,
    urlPattern: (r[6] as string | null) ?? null,
    line: (r[7] as number | null) ?? null,
    language: (r[8] as string | null) ?? null,
  }));

  const httpRoutes = rows.filter((r) => r.kind === 'http_route');
  const httpCalls = rows.filter((r) => r.kind === 'http_call');

  // Group routes by `${METHOD} ${normalisedPath}` for O(N+M) matching
  // instead of N×M. Multiple files exposing the same route → fan out
  // (rare in practice, but we don't dedupe to preserve attribution).
  const routesByKey = new Map<string, CallsiteRow[]>();
  for (const r of httpRoutes) {
    if (!r.method || !r.urlPattern) continue;
    const key = `${r.method} ${r.urlPattern}`;
    const bucket = routesByKey.get(key) ?? [];
    bucket.push(r);
    routesByKey.set(key, bucket);
  }

  const inserts: Array<{ source: CallsiteRow; target: CallsiteRow; label: string }> = [];
  for (const call of httpCalls) {
    if (!call.method || !call.urlPattern) continue;
    const exact = routesByKey.get(`${call.method} ${call.urlPattern}`);
    if (exact) {
      for (const route of exact) {
        if (route.fileId === call.fileId) continue; // skip self-loops
        inserts.push({ source: call, target: route, label: `${call.method} ${call.urlPattern}` });
      }
      continue;
    }
    // Fallback: same method, different path-param shape. Try a loose
    // pattern compare — frontend `/api/users/:id` should still match
    // Python `/api/users/:id` (already normalised), and slight
    // mismatches like trailing slash are handled by normalise. Skip
    // for MVP — false positives erode trust faster than missed pairs.
  }

  // ── SQL (Phase 21) ────────────────────────────────────────────────
  //
  // A `sql_query` callsite carries the table name in `url_pattern` and
  // READ / WRITE in `method` (see services/sql/index.ts for why those
  // columns). The defining side is not another callsite but a SYMBOL:
  // the table as declared by a CREATE in some .sql file.
  const sqlInserts = matchSqlEdges(db, rows);

  // Replace the table atomically-ish (sql.js doesn't expose
  // transactions cleanly; the operation is idempotent so a partial
  // write self-heals on the next scan).
  db.run(`DELETE FROM cross_system_edges`);
  for (const { source, target, label } of inserts) {
    db.run(
      `INSERT INTO cross_system_edges (source_file_id, target_file_id, protocol, label, confidence)
       VALUES (?, ?, ?, ?, ?)`,
      [source.fileId, target.fileId, 'http', label, 1.0],
    );
  }
  for (const edge of sqlInserts) {
    db.run(
      `INSERT INTO cross_system_edges (source_file_id, target_file_id, protocol, label, confidence)
       VALUES (?, ?, ?, ?, ?)`,
      [edge.sourceFileId, edge.targetFileId, 'sql', edge.label, edge.confidence],
    );
  }

  const total = inserts.length + sqlInserts.length;
  console.log(
    `[XS] Cross-system edges: ${inserts.length} HTTP pair${inserts.length === 1 ? '' : 's'}, ` +
      `${sqlInserts.length} SQL reference${sqlInserts.length === 1 ? '' : 's'} matched`,
  );
  return { added: total };
}

interface SqlEdge {
  sourceFileId: number;
  targetFileId: number;
  label: string;
  confidence: number;
}

/**
 * Pair `sql_query` callsites with the `.sql` file that defines the table.
 *
 * The rules that keep this honest:
 *
 *   - **An unknown table produces no edge.** If nothing in the repo
 *     CREATEs it, we do not know where it lives, and a guessed edge on
 *     an architecture graph is worse than a missing one because people
 *     act on it. This is also what stops ORM-managed and external tables
 *     from inventing couplings.
 *   - **Ambiguity produces no edge.** If two files define the same table
 *     name, we cannot say which one a query means. The migration fold
 *     (see services/sql/schema.ts) already collapses the common cause of
 *     this, so what survives is genuinely ambiguous.
 *   - **A file referencing its own table is not an edge.** A view
 *     selecting from a table in the same file is internal structure.
 */
function matchSqlEdges(db: ReturnType<typeof getDb>, rows: CallsiteRow[]): SqlEdge[] {
  const refs = rows.filter((r) => r.kind === 'sql_query' && r.urlPattern);
  if (refs.length === 0) return [];

  // Table name → defining .sql file. Built from symbols, because a
  // definition is a declaration, not a callsite.
  let symbolResult;
  try {
    symbolResult = db.exec(`
      SELECT s.name, s.modifiers, f.id
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE f.language = 'sql'
    `);
  } catch {
    return [];
  }

  const definers = new Map<string, number[]>();
  for (const row of symbolResult[0]?.values ?? []) {
    const name = String(row[0] ?? '');
    let modifiers: string[] = [];
    try {
      modifiers = JSON.parse(String(row[1] ?? '[]'));
    } catch { /* a malformed modifier list is not worth failing over */ }
    // Only tables and views are addressable by a query.
    if (!modifiers.includes('table') && !modifiers.includes('view')) continue;

    const bare = name.split('.').pop()!.toLowerCase();
    const bucket = definers.get(bare) ?? [];
    bucket.push(row[2] as number);
    definers.set(bare, bucket);
  }

  if (definers.size === 0) return [];

  const seen = new Set<string>();
  const edges: SqlEdge[] = [];

  for (const ref of refs) {
    const table = ref.urlPattern!.toLowerCase();
    const candidates = definers.get(table);
    if (!candidates || candidates.length !== 1) continue;

    const targetFileId = candidates[0];
    if (targetFileId === ref.fileId) continue;

    const op = (ref.method ?? 'READ').toUpperCase();
    const key = `${ref.fileId}:${targetFileId}:${op}:${table}`;
    if (seen.has(key)) continue;
    seen.add(key);

    edges.push({
      sourceFileId: ref.fileId,
      targetFileId,
      label: `${op} ${table}`,
      confidence: 1.0,
    });
  }

  return edges;
}

export function listCrossSystemEdges(): CrossSystemEdge[] {
  const db = getDb();
  let result;
  try {
    result = db.exec(`
      SELECT
        sf.path, tf.path, sf.relative_path, tf.relative_path,
        e.protocol, e.label, e.confidence
      FROM cross_system_edges e
      JOIN files sf ON e.source_file_id = sf.id
      JOIN files tf ON e.target_file_id = tf.id
      ORDER BY e.protocol, sf.relative_path
    `);
  } catch {
    return [];
  }

  if (!result[0]) return [];
  return result[0].values.map((r: any[]) => ({
    source: r[0] as string,
    target: r[1] as string,
    sourceRelative: r[2] as string,
    targetRelative: r[3] as string,
    protocol: r[4] as string,
    label: r[5] as string,
    confidence: (r[6] as number) ?? 1.0,
  }));
}

/** Quick stats for the UI / MCP. */
export function getCrossSystemStats(): {
  callsiteCount: number;
  routeCount: number;
  edgeCount: number;
  byProtocol: Record<string, number>;
} {
  const db = getDb();
  const empty = { callsiteCount: 0, routeCount: 0, edgeCount: 0, byProtocol: {} };
  try {
    const cs = db.exec(`SELECT COUNT(*), SUM(CASE WHEN kind = 'http_route' THEN 1 ELSE 0 END) FROM callsites`);
    const callsiteCount = (cs[0]?.values[0]?.[0] as number) ?? 0;
    const routeCount = (cs[0]?.values[0]?.[1] as number) ?? 0;
    const eg = db.exec(`SELECT COUNT(*), protocol FROM cross_system_edges GROUP BY protocol`);
    const byProtocol: Record<string, number> = {};
    let total = 0;
    if (eg[0]) {
      for (const row of eg[0].values) {
        const n = row[0] as number;
        const p = row[1] as string;
        byProtocol[p] = n;
        total += n;
      }
    }
    return { callsiteCount, routeCount, edgeCount: total, byProtocol };
  } catch {
    return empty;
  }
}
