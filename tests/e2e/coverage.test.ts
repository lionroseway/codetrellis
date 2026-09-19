/**
 * Scan coverage — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * The backend has always known how much of a codebase it could not
 * read — `/api/stats` carried `importCount` and `resolvedImports` long
 * before anything displayed them. This endpoint adds the split that
 * makes those numbers an answer rather than a number: the REASON for a
 * gap is a property of the language, so the breakdown has to come from
 * the query.
 *
 * The load-bearing assertion is the one about `unservedRoutes`: it is
 * derived by reconstructing `cross_system_edges.label` from a callsite's
 * method and pattern, which only works while this file and
 * `cross-system-service` agree on how that label is built. If they ever
 * drift, every callsite reads as unpaired and nothing errors — so a
 * paired callsite being counted as paired is asserted directly.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

interface CoverageReport {
  imports: {
    total: number;
    resolved: number;
    byLanguage: Array<{ language: string; imports: number; resolved: number }>;
  };
  http: {
    routes: number;
    calls: number;
    edges: number;
    unservedRoutes: number;
    unmatchedCalls: number;
    nearMisses: Array<{
      method: string;
      callPattern: string;
      routePattern: string;
      callFile: string;
      routeFile: string;
      differingSegment: { position: number; inCall: string; inRoute: string };
    }>;
  };
}

test.describe('Scan coverage (Phase 29)', () => {
  test.setTimeout(120_000);

  test('reports import coverage split by language', async () => {
    const h = await setupHarness('coverage-imports');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const res = await h.client.raw('GET', '/api/coverage');
      expect(res.ok).toBe(true);
      const report = (await res.json()) as CoverageReport;

      expect(report.imports.total).toBeGreaterThan(0);
      expect(report.imports.resolved).toBeGreaterThan(0);
      expect(report.imports.resolved).toBeLessThanOrEqual(report.imports.total);

      // The split is the point — a bare total is not an answer.
      expect(report.imports.byLanguage.length).toBeGreaterThan(1);

      // Per-language figures must add up to the totals, or the panel
      // shows rows that contradict its own header.
      const summed = report.imports.byLanguage.reduce(
        (acc, row) => ({ imports: acc.imports + row.imports, resolved: acc.resolved + row.resolved }),
        { imports: 0, resolved: 0 },
      );
      expect(summed.imports).toBe(report.imports.total);
      expect(summed.resolved).toBe(report.imports.resolved);

      for (const row of report.imports.byLanguage) {
        expect(row.resolved, `${row.language} resolved more than it has`).toBeLessThanOrEqual(row.imports);
        expect(row.language).toBeTruthy();
      }
    } finally {
      await h.teardown();
    }
  });

  test('the fixture languages that cannot resolve imports are represented', async () => {
    const h = await setupHarness('coverage-languages');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const report = (await (await h.client.raw('GET', '/api/coverage')).json()) as CoverageReport;
      const byLang = new Map(report.imports.byLanguage.map((r) => [r.language, r]));

      // Swift is the case this surface exists for: files inside a module
      // import each other with no import statement, so the graph looks
      // sparse for a reason that has nothing to do with coupling.
      const swift = byLang.get('swift');
      expect(swift, 'Swift must appear in the breakdown').toBeTruthy();
      expect(swift!.imports).toBeGreaterThan(0);

      // Every language in a realistic project has SOME import pointing
      // outside it — C# imports System, Go imports net/http, Python
      // imports its standard library. This assertion exists to record
      // that, because the first version of this surface led with
      // "45% resolved" and read like a broken scan when nothing was
      // broken. The framing is internal-versus-external for that reason.
      const allHaveExternals = report.imports.byLanguage.every(
        (r) => r.resolved < r.imports,
      );
      expect(
        allHaveExternals,
        'a language resolving 100% would be surprising — check the framing still makes sense',
      ).toBe(true);

      // And every language must link at least something internally, or
      // the resolver for it is doing nothing at all.
      for (const row of report.imports.byLanguage) {
        expect(row.resolved, `${row.language} links nothing internally`).toBeGreaterThan(0);
      }
    } finally {
      await h.teardown();
    }
  });

  test('HTTP coverage counts unpaired callsites without miscounting paired ones', async () => {
    const h = await setupHarness('coverage-http');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const report = (await (await h.client.raw('GET', '/api/coverage')).json()) as CoverageReport;

      expect(report.http.routes).toBeGreaterThan(0);
      expect(report.http.calls).toBeGreaterThan(0);
      expect(report.http.edges).toBeGreaterThan(0);

      // The guard on label reconstruction. `unservedRoutes` and
      // `unmatchedCalls` are derived by rebuilding
      // `cross_system_edges.label` from a callsite's method and pattern,
      // which only works while this and cross-system-service agree on
      // how that label is built. If they drift, everything reads as
      // unpaired and nothing errors.
      //
      // This asserted `calls - unmatchedCalls === edges`, which is not an
      // identity and was only true of this fixture. Calls and edges are
      // not in bijection in EITHER direction: cross-system-service fans
      // one call out to every file serving the route and deliberately
      // does not dedupe, so a second controller on an existing route
      // makes edges exceed paired calls; and two identical calls in one
      // file share a (file, label) pair, so paired calls can exceed
      // edges. Either change breaks the assertion for a reason with
      // nothing to do with label drift, and the obvious response is to
      // loosen it — which deletes the only guard on the contract.
      //
      // What drift actually looks like is total: no callsite matches any
      // label, so every call reads unpaired while the edges are plainly
      // there. That is what is asserted, and it is true whatever the
      // fixture's route topology.
      const pairedCalls = report.http.calls - report.http.unmatchedCalls;
      expect(
        pairedCalls,
        'no call was counted as paired, though edges exist — the label expression has drifted '
          + 'from cross-system-service',
      ).toBeGreaterThan(0);
      expect(report.http.unmatchedCalls).toBeLessThan(report.http.calls);

      // Routes are the other way round: the fixture serves more
      // endpoints than it calls, which is the number worth surfacing.
      expect(report.http.unservedRoutes).toBeGreaterThan(0);
      expect(report.http.unservedRoutes).toBeLessThan(report.http.routes);
    } finally {
      await h.teardown();
    }
  });

  test('a near miss is suggested, and does not become an edge', async () => {
    const h = await setupHarness('coverage-near-miss');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const report = (await (await h.client.raw('GET', '/api/coverage')).json()) as CoverageReport;

      // The fixture's Kotlin client calls /api/ledger/42; the C# side
      // serves /api/ledger/:id. 42 is a value and :id is a pattern, so
      // the exact matcher cannot pair them — and should not, because we
      // cannot prove 42 is an id rather than a path segment the route
      // does not serve.
      const miss = report.http.nearMisses.find((m) => m.callPattern === '/api/ledger/42');
      expect(miss, 'the /api/ledger/42 near miss should be suggested').toBeTruthy();
      expect(miss!.routePattern).toBe('/api/ledger/:id');
      expect(miss!.method).toBe('GET');
      expect(miss!.differingSegment.inCall).toBe('42');
      expect(miss!.differingSegment.inRoute).toBe(':id');
      // Both sides named, so the panel can point at them.
      expect(miss!.callFile).toContain('scheduler');
      expect(miss!.routeFile).toContain('reporting');

      // And it must NOT have become an edge. A suggestion is not a line
      // on the architecture diagram.
      const edges = await h.client.getCrossSystemEdges();
      expect(
        edges.find((e) => e.label === 'GET /api/ledger/42'),
        'a near miss must never be promoted to an edge',
      ).toBeUndefined();
    } finally {
      await h.teardown();
    }
  });

  test('coverage is available before a scan without erroring', async () => {
    const h = await setupHarness('coverage-empty');
    try {
      // The chip renders nothing on an empty report rather than showing
      // "0 of 0" — but the endpoint still has to answer cleanly, or the
      // UI has an error state to design for that should not exist.
      const res = await h.client.raw('GET', '/api/coverage');
      expect(res.ok).toBe(true);
      const report = (await res.json()) as CoverageReport;
      expect(report.imports.total).toBe(0);
      expect(report.imports.byLanguage).toEqual([]);
      expect(report.http.edges).toBe(0);
    } finally {
      await h.teardown();
    }
  });
});
