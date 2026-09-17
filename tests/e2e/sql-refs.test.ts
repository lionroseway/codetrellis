/**
 * SQL schema + ref-tracker — Phase 21.
 *
 * See [docs/PHASE-21-SQL-REF-TRACKER.md](../../docs/PHASE-21-SQL-REF-TRACKER.md).
 *
 * The fixture holds two independent schemas on purpose:
 *
 *   `schema.sql`        users, orders      ← queried by the Python service
 *   `db/migrations/`    invoices, payments ← queried by the Go service
 *                       legacy_notes (created in 003, dropped in 031)
 *                       invoice_totals (a materialized view)
 *
 * Keeping the table names disjoint is deliberate: the matcher refuses to
 * emit an edge when two files define the same table name, so a colliding
 * fixture would silently test nothing.
 *
 * The unit suites under `src/backend/services/sql/` cover extraction in
 * detail — tokenizer, CTE exclusion, read/write attribution, per-language
 * quoting. This file proves the pipeline: scan → symbols → callsites →
 * cross-system edges.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { setupHarness } from '../harness';

interface SymbolRow {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  modifiers: string[];
}

interface XsEdge {
  sourceRelative: string;
  targetRelative: string;
  protocol: string;
  label: string;
}

const MIGRATIONS = 'db/migrations';

async function fileSymbols(
  h: { client: { raw(method: string, p: string): Promise<Response> } },
  absPath: string,
): Promise<SymbolRow[]> {
  const resp = await h.client.raw('GET', `/api/symbols/file?path=${encodeURIComponent(absPath)}`);
  return (await resp.json()) as SymbolRow[];
}

const sqlEdges = (edges: XsEdge[]): XsEdge[] => edges.filter((e) => e.protocol === 'sql');

const edgeBetween = (edges: XsEdge[], sourceEnds: string, targetEnds: string, label: string) =>
  sqlEdges(edges).find(
    (e) =>
      e.sourceRelative.endsWith(sourceEnds) &&
      e.targetRelative.endsWith(targetEnds) &&
      e.label === label,
  );

test.describe('SQL schema + refs (Phase 21)', () => {
  test.setTimeout(120_000);

  test('tables and views in a .sql file become symbols; indexes do not', async () => {
    const h = await setupHarness('sql-symbols');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const symbols = await fileSymbols(h, path.join(h.fixture.projectPath, 'schema.sql'));
      const byName = new Map(symbols.map((s) => [s.name.toLowerCase(), s]));

      expect(byName.has('users'), 'users is a symbol').toBe(true);
      expect(byName.has('orders'), 'orders is a symbol').toBe(true);
      expect(byName.get('orders')?.modifiers).toContain('table');

      // An index is an implementation detail of a table, not an
      // architectural object — emitting one per index buries the tables.
      expect(byName.has('idx_orders_user_id')).toBe(false);

      // Columns are not symbols either.
      expect(byName.has('email')).toBe(false);
      expect(byName.has('amount')).toBe(false);

      // A table symbol spans its definition rather than one line.
      expect(byName.get('orders')!.endLine).toBeGreaterThan(byName.get('orders')!.startLine);
    } finally {
      await h.teardown();
    }
  });

  test('the migration fold drops a dropped table and attributes the rest to their creator', async () => {
    const h = await setupHarness('sql-fold');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const created = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, MIGRATIONS, '001_create_invoices.sql'),
      );
      expect(created.map((s) => s.name.toLowerCase())).toContain('invoices');

      // 003 creates legacy_notes, 031 drops it. A graph that still shows
      // a table deleted two migrations ago is worse than one showing
      // none, so the symbol must be gone entirely.
      const legacy = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, MIGRATIONS, '003_create_legacy_notes.sql'),
      );
      expect(legacy.map((s) => s.name.toLowerCase()), 'dropped table is folded away').not.toContain(
        'legacy_notes',
      );

      // 014 only ALTERs invoices — it must not claim to define it, or two
      // files define the same table and the matcher goes ambiguous.
      const altered = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, MIGRATIONS, '014_add_invoice_status.sql'),
      );
      expect(altered.map((s) => s.name.toLowerCase())).not.toContain('invoices');
    } finally {
      await h.teardown();
    }
  });

  test('Python queries produce read and write edges to the schema that defines the tables', async () => {
    const h = await setupHarness('sql-python-refs');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = (await h.client.getCrossSystemEdges()) as unknown as XsEdge[];

      // LIST_ORDERS_SQL joins orders and users — both are reads.
      expect(edgeBetween(edges, 'app/db.py', 'schema.sql', 'READ orders')).toBeTruthy();
      expect(edgeBetween(edges, 'app/db.py', 'schema.sql', 'READ users')).toBeTruthy();

      // INSERT_USER_SQL writes. Read vs write is the finding that makes
      // this worth building, so it is asserted explicitly.
      expect(edgeBetween(edges, 'app/db.py', 'schema.sql', 'WRITE users')).toBeTruthy();
    } finally {
      await h.teardown();
    }
  });

  test('Go queries reach the migration that creates each table', async () => {
    const h = await setupHarness('sql-go-refs');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = (await h.client.getCrossSystemEdges()) as unknown as XsEdge[];

      expect(
        edgeBetween(edges, 'internal/store/store.go', '001_create_invoices.sql', 'READ invoices'),
      ).toBeTruthy();
      expect(
        edgeBetween(edges, 'internal/store/store.go', '002_create_payments.sql', 'WRITE payments'),
      ).toBeTruthy();
    } finally {
      await h.teardown();
    }
  });

  test('a view selecting from a table couples the two files', async () => {
    const h = await setupHarness('sql-view-refs');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = (await h.client.getCrossSystemEdges()) as unknown as XsEdge[];

      expect(
        edgeBetween(edges, '040_create_invoice_totals.sql', '001_create_invoices.sql', 'READ invoices'),
      ).toBeTruthy();
    } finally {
      await h.teardown();
    }
  });

  test('invents nothing — dropped tables, comments and prose produce no edges', async () => {
    const h = await setupHarness('sql-restraint');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = sqlEdges((await h.client.getCrossSystemEdges()) as unknown as XsEdge[]);

      // store.go queries legacy_notes, which no longer exists after the
      // fold. Nothing defines it, so there is nothing to point at.
      expect(edges.some((e) => e.label.includes('legacy_notes'))).toBe(false);

      // `-- SELECT * FROM ghost_table` appears in a migration comment.
      expect(edges.some((e) => e.label.includes('ghost_table'))).toBe(false);

      // Every SQL edge must land on a .sql file — the definition side is
      // always a schema file, never application code.
      for (const edge of edges) {
        expect(edge.targetRelative).toMatch(/\.sql$/);
        expect(edge.label).toMatch(/^(READ|WRITE) \w+$/);
      }
    } finally {
      await h.teardown();
    }
  });

  test('HTTP and SQL edges coexist, and stats count both protocols', async () => {
    const h = await setupHarness('sql-protocol-mix');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const resp = await h.client.getCrossSystem();

      expect(resp.stats?.byProtocol?.http ?? 0).toBeGreaterThan(0);
      expect(resp.stats?.byProtocol?.sql ?? 0).toBeGreaterThan(0);
      expect(resp.stats?.edgeCount).toBe(
        (resp.stats?.byProtocol?.http ?? 0) + (resp.stats?.byProtocol?.sql ?? 0),
      );
    } finally {
      await h.teardown();
    }
  });
});
