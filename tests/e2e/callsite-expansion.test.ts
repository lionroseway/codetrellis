/**
 * Callsite extractors for Ruby, C#, Kotlin and Swift — Phase 28.
 *
 * See [docs/PHASE-28-CALLSITE-EXPANSION.md](../../docs/PHASE-28-CALLSITE-EXPANSION.md).
 *
 * Phase 27 put these four languages in the symbol graph and the import
 * graph, but they could not appear on the **cross-system** map: nothing
 * extracted their HTTP routes or calls, so a .NET or Rails service
 * showed as a cluster of files with no relationship to anything else in
 * the repo. It looked like an isolated service. It was an unread one.
 *
 * The fixture now contains a chain that crosses four languages —
 * Swift → Kotlin → C# → Python — plus Ruby → Python. That chain is the
 * point: each hop is a different framework with a different way of
 * spelling a route, and the matcher pairs them only because every
 * extractor normalises to one canonical form.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

interface Edge {
  sourceRelative: string;
  targetRelative: string;
  label: string;
  protocol: string;
}

const httpOnly = (edges: Edge[]): Edge[] => edges.filter((e) => e.protocol === 'http');

/** An edge from a file whose path contains `from` to one containing `to`. */
function edgeBetween(edges: Edge[], from: string, to: string, label: string): Edge | undefined {
  return edges.find(
    (e) => e.sourceRelative.includes(from) && e.targetRelative.includes(to) && e.label === label,
  );
}

test.describe('Callsite expansion (Phase 28)', () => {
  test.setTimeout(120_000);

  test('a four-language call chain is drawn end to end', async () => {
    const h = await setupHarness('callsites-chain');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = httpOnly((await h.client.getCrossSystemEdges()) as Edge[]);

      // Swift → Kotlin. The Swift side builds the URL with
      // `URL(string:)` and sets `httpMethod` two lines later; the
      // Kotlin side declares it with a nested Ktor `route` block.
      expect(
        edgeBetween(edges, 'MobileApp/main.swift', 'scheduler', 'GET /api/jobs'),
        'Swift → Kotlin GET /api/jobs',
      ).toBeTruthy();
      expect(
        edgeBetween(edges, 'MobileApp/main.swift', 'scheduler', 'DELETE /api/jobs/:id'),
        'Swift → Kotlin DELETE /api/jobs/:id — the verb comes from httpMethod, not the URL',
      ).toBeTruthy();

      // Kotlin → C#. The C# side declares this route through
      // `[Route("api/[controller]")]` on `LedgerController`, so the
      // edge only exists if the token was expanded from the class name.
      expect(
        edgeBetween(edges, 'scheduler', 'reporting', 'GET /api/ledger'),
        'Kotlin → C# GET /api/ledger — requires [controller] expansion',
      ).toBeTruthy();

      // C# → Python, closing the chain on the existing FastAPI service.
      expect(
        edgeBetween(edges, 'reporting', 'routes/orders.py', 'GET /api/orders'),
        'C# → Python GET /api/orders',
      ).toBeTruthy();
    } finally {
      await h.teardown();
    }
  });

  test('a Rails resources declaration becomes real endpoints', async () => {
    const h = await setupHarness('callsites-rails');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = httpOnly((await h.client.getCrossSystemEdges()) as Edge[]);

      // Ruby as a caller — Net::HTTP and HTTParty into the Python API.
      expect(
        edgeBetween(edges, 'notifier/app.rb', 'routes/users.py', 'GET /api/users'),
        'Ruby → Python GET /api/users (Net::HTTP)',
      ).toBeTruthy();
      expect(
        edgeBetween(edges, 'notifier/app.rb', 'routes/users.py', 'POST /api/users'),
        'Ruby → Python POST /api/users (HTTParty)',
      ).toBeTruthy();

      // Ruby as a server. `config/routes.rb` declares its API with
      // `resources`, never with explicit verbs, so these routes exist
      // only because the extractor expands the declaration the way
      // Rails does.
      // A call added to the TS app must pair with a route that only
      // `resources :notifications` could have produced.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const apiTs = path.join(h.fixture.projectPath, 'packages/web/src/api.ts');
      fs.appendFileSync(
        apiTs,
        `
export async function listNotifications() {
  const res = await fetch('/api/notifications');
  return res.json();
}
`,
        'utf-8',
      );

      const { waitFor } = await import('../harness');
      await waitFor(
        async () => {
          const current = httpOnly((await h.client.getCrossSystemEdges()) as Edge[]);
          return edgeBetween(current, 'packages/web/src/api.ts', 'routes.rb', 'GET /api/notifications')
            ? current
            : null;
        },
        {
          timeoutMs: 20_000,
          intervalMs: 250,
          description: 'TS → Rails GET /api/notifications, from `resources :notifications`',
        },
      );
    } finally {
      await h.teardown();
    }
  });

  test('every new language contributes callsites of its own', async () => {
    const h = await setupHarness('callsites-coverage');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = httpOnly((await h.client.getCrossSystemEdges()) as Edge[]);

      // The regression this guards: a language whose extractor is
      // registered but never fires looks exactly like a language with
      // no extractor at all — an isolated cluster, no error.
      const touched = new Set<string>();
      for (const edge of edges) {
        for (const p of [edge.sourceRelative, edge.targetRelative]) {
          const ext = p.slice(p.lastIndexOf('.'));
          touched.add(ext);
        }
      }
      for (const ext of ['.cs', '.kt', '.swift', '.rb']) {
        expect(touched.has(ext), `${ext} contributes no cross-system edge`).toBe(true);
      }
    } finally {
      await h.teardown();
    }
  });
});
