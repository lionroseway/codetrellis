/**
 * Go language support — Phase 20.
 *
 * Covers the three plugin slots the phase fills, against the fixture's
 * `services/billing` (module `github.com/codetrellis/fixture/billing`)
 * and its sibling module `services/shared-go`
 * (`github.com/codetrellis/fixture/shared`, wired in via a `replace`
 * directive).
 *
 * See [docs/PHASE-20-GO-SUPPORT.md](../../docs/PHASE-20-GO-SUPPORT.md).
 *
 * Why each test exists:
 *
 *  - Before this phase `.go` files were already scanned (the scanner's
 *    LANG_MAP has always had `.go`) but had no parser, so they rendered
 *    as isolated nodes with zero symbols and zero edges. Test 1 is the
 *    regression guard for that specific failure — a missing grammar is
 *    logged and skipped at load time, so a Go build that silently stops
 *    producing symbols would otherwise look like a healthy scan.
 *  - Go resolution is by module path, not containment, so tests 2–4
 *    pin the three cases that distinguish it: in-module, `replace`d
 *    sibling, and external/stdlib.
 *  - Test 6 is the one that would have failed with a naive regex
 *    extractor: the route literal in the fixture is `/invoices`, and
 *    only resolving chi's block-scoped group prefix turns it into
 *    `/api/billing/invoices` so it can pair with the web app's fetch.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, waitFor } from '../harness';

interface DepEdge {
  sourceRelative: string;
  targetRelative: string;
  specifiers: string[];
}

interface SymbolRow {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  modifiers: string[];
}

/** Symbols for one file, via `/api/symbols/file` (absolute path). */
async function fileSymbols(
  h: { client: { raw(method: string, path: string): Promise<Response> } },
  absPath: string,
): Promise<SymbolRow[]> {
  const resp = await h.client.raw('GET', `/api/symbols/file?path=${encodeURIComponent(absPath)}`);
  return (await resp.json()) as SymbolRow[];
}

const BILLING = 'services/billing';

function goEdges(edges: DepEdge[]): DepEdge[] {
  return edges.filter((e) => e.sourceRelative.endsWith('.go'));
}

test.describe('Go support (Phase 20)', () => {
  test.setTimeout(120_000);

  test('parses Go symbols, including qualified methods and grouped type specs', async () => {
    const h = await setupHarness('go-symbols');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const inLedger = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, BILLING, 'internal/ledger/ledger.go'),
      );

      // Zero symbols here is the exact pre-Phase-20 failure mode, and
      // also what a missing/incompatible grammar degrades to.
      expect(inLedger.length, 'ledger.go must contribute symbols').toBeGreaterThan(0);

      const byName = new Map(inLedger.map((s) => [s.name, s]));

      // struct / interface / grouped type specs
      expect(byName.get('Ledger')?.kind).toBe('class');
      expect(byName.get('Ledger')?.modifiers).toContain('struct');
      expect(byName.get('Reader')?.kind).toBe('interface');
      // `type ( Page []Entry; Cursor string )` — both specs, not just
      // the first.
      expect(byName.has('Page'), 'grouped type spec Page').toBe(true);
      expect(byName.has('Cursor'), 'grouped type spec Cursor').toBe(true);

      // Methods are qualified by receiver type so `Post`/`Total`/
      // `String` don't collide across the codebase.
      expect(byName.has('(Ledger).Post'), 'method qualified by receiver').toBe(true);
      expect(byName.has('(Ledger).Total')).toBe(true);
      expect(byName.has('Post'), 'unqualified method name must not be used').toBe(false);

      // Exportedness is captured; unexported helpers are not flagged.
      expect(byName.get('All')?.modifiers).toContain('exported');
      expect(byName.get('reset')?.modifiers ?? []).not.toContain('exported');

      // const / var
      expect(byName.get('MaxEntries')?.kind).toBe('variable');
      expect(byName.get('MaxEntries')?.modifiers).toContain('const');
      expect(byName.get('defaultLedger')?.modifiers).toContain('var');
    } finally {
      await h.teardown();
    }
  });

  test('resolves in-module imports by module path', async () => {
    const h = await setupHarness('go-resolve-module');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = goEdges((await h.client.getDependencyEdges()) as DepEdge[]);

      // main.go imports github.com/codetrellis/fixture/billing/internal/ledger
      const mainToLedger = edges.find(
        (e) =>
          e.sourceRelative.endsWith(`${BILLING}/main.go`) &&
          e.targetRelative.includes(`${BILLING}/internal/ledger/`),
      );
      expect(mainToLedger, 'main.go → internal/ledger').toBeTruthy();

      // ledger.go imports internal/store — a second in-module hop.
      const ledgerToStore = edges.find(
        (e) =>
          e.sourceRelative.endsWith(`${BILLING}/internal/ledger/ledger.go`) &&
          e.targetRelative.includes(`${BILLING}/internal/store/`),
      );
      expect(ledgerToStore, 'ledger.go → internal/store').toBeTruthy();
    } finally {
      await h.teardown();
    }
  });

  test('resolves a sibling module through a replace directive', async () => {
    const h = await setupHarness('go-resolve-replace');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = goEdges((await h.client.getDependencyEdges()) as DepEdge[]);

      // billing's go.mod has:
      //   replace github.com/codetrellis/fixture/shared => ../shared-go
      // Without reading that, this import is indistinguishable from an
      // external dependency — and monorepos are wired exactly this way.
      const toShared = edges.find(
        (e) =>
          e.sourceRelative.includes(`${BILLING}/internal/ledger/`) &&
          e.targetRelative.includes('services/shared-go/money/'),
      );
      expect(toShared, 'ledger → shared-go/money via replace').toBeTruthy();
    } finally {
      await h.teardown();
    }
  });

  test('leaves stdlib and external imports unresolved', async () => {
    const h = await setupHarness('go-resolve-external');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = goEdges((await h.client.getDependencyEdges()) as DepEdge[]);

      // `net/http`, `fmt`, `context`, `errors` are stdlib; `github.com/lib/pq`
      // is external. None of them may produce a resolved edge — an
      // over-eager prefix match would invent one.
      for (const edge of edges) {
        expect(edge.targetRelative).not.toMatch(/(^|\/)(net\/http|fmt|context|errors)$/);
        expect(edge.targetRelative).not.toContain('lib/pq');
      }

      // Every Go edge that does exist must land inside the repo.
      for (const edge of edges) {
        expect(edge.targetRelative).toMatch(/^(services|packages)\//);
      }

      // That blank and dot imports are still *recorded* (they are
      // deliberate side-effect dependencies) is asserted in
      // `src/backend/services/parsers/go.test.ts` — the REST surface
      // only exposes resolved edges, so it cannot see them.
    } finally {
      await h.teardown();
    }
  });

  test('ignores testdata/, which is deliberately unparseable Go', async () => {
    const h = await setupHarness('go-testdata');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const fromTestdata = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, BILLING, 'testdata/broken.go'),
      );
      expect(fromTestdata, 'testdata must contribute nothing').toHaveLength(0);

      const edges = (await h.client.getDependencyEdges()) as DepEdge[];
      expect(edges.some((e) => e.sourceRelative.includes('testdata/'))).toBe(false);
    } finally {
      await h.teardown();
    }
  });

  test('pairs a web fetch with a chi route behind a group prefix', async () => {
    const h = await setupHarness('go-cross-system');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const resp = await h.client.getCrossSystem();

      // The Go source says `r.Get("/invoices", …)` inside
      // `r.Route("/api/billing", …)`. Only prefix resolution turns
      // that into the path the web app actually calls.
      const edge = resp.edges.find(
        (e) =>
          e.sourceRelative.includes('packages/web/src/api.ts') &&
          e.targetRelative.includes(`${BILLING}/main.go`),
      );
      expect(edge, 'web fetch → Go chi route').toBeTruthy();
      expect(edge?.label).toBe('GET /api/billing/invoices');
      expect(edge?.protocol).toMatch(/^http/i);
    } finally {
      await h.teardown();
    }
  });

  test('pairs a Go outbound call with a Python route', async () => {
    const h = await setupHarness('go-outbound');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const resp = await h.client.getCrossSystem();

      // client/orders.go builds its URL with fmt.Sprintf("%s/api/orders", …),
      // which is how Go clients are usually written.
      const edge = resp.edges.find(
        (e) =>
          e.sourceRelative.includes(`${BILLING}/client/orders.go`) &&
          e.targetRelative.includes('services/api/app/routes/orders.py'),
      );
      expect(edge, 'Go client → Python route').toBeTruthy();
      expect(edge?.label).toBe('GET /api/orders');
    } finally {
      await h.teardown();
    }
  });

  test('adding a Go route auto-refreshes cross-system edges without a rescan', async () => {
    const h = await setupHarness('go-mutation');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const before = (await h.client.getCrossSystem()).edges.length;

      // Add a matching pair: a new Go route and a new web fetch.
      const mainGo = path.join(h.fixture.projectPath, BILLING, 'main.go');
      const src = fs.readFileSync(mainGo, 'utf-8');
      fs.writeFileSync(
        mainGo,
        src.replace(
          '\t\tr.Get("/invoices", listInvoices)',
          '\t\tr.Get("/invoices", listInvoices)\n\t\tr.Get("/statements", listStatements)',
        ) + '\nfunc listStatements(w http.ResponseWriter, req *http.Request) {}\n',
      );

      const apiTs = path.join(h.fixture.projectPath, 'packages/web/src/api.ts');
      fs.appendFileSync(
        apiTs,
        `
export async function listStatements(): Promise<unknown[]> {
  const res = await fetch('/api/billing/statements');
  return res.json();
}
`,
      );

      await waitFor(
        async () => (await h.client.getCrossSystem()).edges.length > before,
        { timeoutMs: 15_000, description: 'new Go route edge appears' },
      );

      const after = (await h.client.getCrossSystem()).edges;
      expect(after.some((e) => e.label === 'GET /api/billing/statements')).toBe(true);
    } finally {
      await h.teardown();
    }
  });
});
