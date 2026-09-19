/**
 * C#, Kotlin and Swift support — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * These are the "app languages" question: a .NET backend, an Android /
 * server Kotlin service, and an iOS client. Each one arrives with a
 * different relationship between imports and files, and the resolvers
 * are honest about it in different ways — so each language gets a
 * resolution test that asserts what it *does* claim and, just as
 * importantly, what it refuses to invent.
 *
 * The first test per language is the "confidently empty" guard that
 * Phase 27 exists for: a language that scans and shows nothing is worse
 * than one that is absent, because the absence is visible.
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

interface DepEdge {
  sourceRelative: string;
  targetRelative: string;
}

const REPORTING = 'services/reporting';
const SCHEDULER = 'services/scheduler';
const MOBILE = 'mobile-client';

async function fileSymbols(
  h: { client: { raw(method: string, p: string): Promise<Response> } },
  absPath: string,
): Promise<SymbolRow[]> {
  const resp = await h.client.raw('GET', `/api/symbols/file?path=${encodeURIComponent(absPath)}`);
  return (await resp.json()) as SymbolRow[];
}

test.describe('C# support (Phase 27)', () => {
  test.setTimeout(120_000);

  test('a C# file contributes symbols, and namespaces are not among them', async () => {
    const h = await setupHarness('csharp-symbols');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const symbols = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, REPORTING, 'Ledger/EntryReader.cs'),
      );
      expect(symbols.length, 'EntryReader.cs must contribute symbols').toBeGreaterThan(0);

      const byName = new Map(symbols.map((s) => [s.name, s]));

      expect(byName.get('IEntryReader')?.kind).toBe('interface');
      expect(byName.get('EntryKind')?.kind).toBe('enum');
      expect(byName.get('EntryReader')?.kind).toBe('class');
      expect(byName.get('Entry')?.modifiers).toContain('record');

      // Members qualified by their type — `Recent` is generic enough to
      // collide with half a real codebase.
      expect(byName.has('EntryReader.Recent')).toBe(true);
      expect(byName.has('Recent'), 'the unqualified form must not leak').toBe(false);

      // A type nested in a type keeps the name C# uses for it.
      expect(byName.has('EntryReader.Cursor')).toBe(true);

      // The namespace is a container, not a symbol.
      expect(
        [...byName.keys()].some((n) => n.startsWith('Acme.')),
        'a namespace must not appear as a symbol',
      ).toBe(false);
    } finally {
      await h.teardown();
    }
  });

  test('a using resolves through the project root namespace; the BCL does not', async () => {
    const h = await setupHarness('csharp-resolve');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = ((await h.client.getDependencyEdges()) as DepEdge[]).filter((e) =>
        e.sourceRelative.endsWith('.cs'),
      );

      // Reporting.csproj declares <RootNamespace>Acme.Reporting</…>, so
      // `using Acme.Reporting.Ledger` is the Ledger/ directory.
      expect(
        edges.find(
          (e) =>
            e.sourceRelative.endsWith(`${REPORTING}/Program.cs`) &&
            e.targetRelative.includes(`${REPORTING}/Ledger/`),
        ),
        'Program.cs → Ledger/',
      ).toBeTruthy();

      expect(
        edges.find(
          (e) =>
            e.sourceRelative.endsWith(`${REPORTING}/Services/StatementBuilder.cs`) &&
            e.targetRelative.includes(`${REPORTING}/Ledger/`),
        ),
        'StatementBuilder.cs → Ledger/',
      ).toBeTruthy();

      // `using System;` and friends are external by definition — an
      // over-eager resolver would point them at something local.
      for (const edge of edges) {
        expect(edge.targetRelative).toMatch(/\.cs$/);
      }
    } finally {
      await h.teardown();
    }
  });
});

test.describe('Kotlin support (Phase 27)', () => {
  test.setTimeout(120_000);

  test('a Kotlin file contributes symbols, with interfaces told apart from classes', async () => {
    const h = await setupHarness('kotlin-symbols');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const symbols = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, SCHEDULER, 'src/main/kotlin/com/acme/scheduler/Scheduler.kt'),
      );
      expect(symbols.length, 'Scheduler.kt must contribute symbols').toBeGreaterThan(0);

      const byName = new Map(symbols.map((s) => [s.name, s]));

      // `class`, `interface` and `enum class` are all one grammar node
      // separated by an anonymous token — the whole reason this language
      // needed a careful plugin rather than a copy of the Java one.
      expect(byName.get('Job')?.kind).toBe('interface');
      expect(byName.get('RunState')?.kind).toBe('enum');
      expect(byName.get('Scheduler')?.kind).toBe('class');
      expect(byName.get('RunReport')?.modifiers).toContain('data');

      expect(byName.has('Scheduler.register')).toBe(true);
      expect(byName.has('Scheduler.Companion.withDefaults')).toBe(true);
      expect(byName.has('Registry.lookup')).toBe(true);

      // Extension functions carry their receiver.
      expect(byName.has('Int.toIntervalLabel')).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('a package import resolves under the Gradle source root; the stdlib does not', async () => {
    const h = await setupHarness('kotlin-resolve');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = ((await h.client.getDependencyEdges()) as DepEdge[]).filter((e) =>
        e.sourceRelative.endsWith('.kt'),
      );

      expect(
        edges.find(
          (e) =>
            e.sourceRelative.endsWith('scheduler/Scheduler.kt') &&
            e.targetRelative.endsWith('scheduler/jobs/ReconcileJob.kt'),
        ),
        'Scheduler.kt → jobs/ReconcileJob.kt',
      ).toBeTruthy();

      // `import kotlinx.coroutines.flow.Flow as KFlow` is an external
      // dependency; nothing in the tree should absorb it.
      for (const edge of edges) {
        expect(edge.targetRelative).toMatch(/\.kts?$/);
        expect(edge.targetRelative).not.toMatch(/Flow/);
      }
    } finally {
      await h.teardown();
    }
  });
});

test.describe('Swift support (Phase 27)', () => {
  test.setTimeout(120_000);

  test('a Swift file contributes symbols, and an extension does not overwrite its type', async () => {
    const h = await setupHarness('swift-symbols');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const symbols = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, MOBILE, 'Sources/BillingCore/Invoice.swift'),
      );
      expect(symbols.length, 'Invoice.swift must contribute symbols').toBeGreaterThan(0);

      const byName = new Map(symbols.map((s) => [s.name, s]));

      expect(byName.get('Invoice')?.kind).toBe('class');
      // The extension is a separate place in the file and stays separate.
      expect(byName.has('Invoice (extension)')).toBe(true);

      const core = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, MOBILE, 'Sources/BillingCore/BillingCore.swift'),
      );
      const coreByName = new Map(core.map((s) => [s.name, s]));
      expect(coreByName.get('Poster')?.kind).toBe('interface');
      expect(coreByName.get('InvoiceStatus')?.kind).toBe('enum');
      expect(coreByName.get('Money')?.modifiers).toContain('struct');
      expect(coreByName.has('Money.doubled')).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('a module import resolves to its SwiftPM target; SDK frameworks do not', async () => {
    const h = await setupHarness('swift-resolve');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = ((await h.client.getDependencyEdges()) as DepEdge[]).filter((e) =>
        e.sourceRelative.endsWith('.swift'),
      );

      expect(
        edges.find(
          (e) =>
            e.sourceRelative.endsWith(`${MOBILE}/Sources/MobileApp/main.swift`) &&
            e.targetRelative.includes(`${MOBILE}/Sources/BillingCore/`),
        ),
        'MobileApp/main.swift → Sources/BillingCore/',
      ).toBeTruthy();

      // `import Foundation` is an SDK framework. Nothing local is it.
      for (const edge of edges) {
        expect(edge.targetRelative).toMatch(/\.swift$/);
        expect(edge.targetRelative).not.toMatch(/Foundation/);
      }
    } finally {
      await h.teardown();
    }
  });
});

test.describe('registry drift (Phase 27)', () => {
  test.setTimeout(120_000);

  test('editing a file in each new language re-parses it', async () => {
    const h = await setupHarness('jvm-apple-watch');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // The watcher's extension set is derived from the parser registry,
      // so registering a plugin should be all it takes. That list has
      // gone silently stale twice, so all three new extensions are
      // asserted rather than assumed.
      const fs = await import('node:fs');
      const { waitFor } = await import('../harness');

      const cases: Array<{ file: string; append: string; expect: string }> = [
        {
          file: path.join(h.fixture.projectPath, REPORTING, 'Ledger/EntryReader.cs'),
          append: '\npublic sealed class LateArrival { }\n',
          expect: 'LateArrival',
        },
        {
          file: path.join(h.fixture.projectPath, SCHEDULER, 'src/main/kotlin/com/acme/scheduler/Scheduler.kt'),
          append: '\nclass LateArrival\n',
          expect: 'LateArrival',
        },
        {
          file: path.join(h.fixture.projectPath, MOBILE, 'Sources/BillingCore/Invoice.swift'),
          append: '\nstruct LateArrival { }\n',
          expect: 'LateArrival',
        },
      ];

      for (const c of cases) {
        fs.appendFileSync(c.file, c.append);
        await waitFor(
          async () => {
            const symbols = await fileSymbols(h, c.file);
            return symbols.some((s) => s.name === c.expect) ? symbols : null;
          },
          { timeoutMs: 20_000, description: `${path.basename(c.file)} to re-parse` },
        );
      }
    } finally {
      await h.teardown();
    }
  });
});
