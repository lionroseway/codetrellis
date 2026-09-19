/**
 * Ruby support — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * This closes a live bug rather than adding a feature. `'ruby'` was in
 * `SupportedLanguage` and `.rb` was in the scanner's `LANG_MAP` with no
 * parser behind either, so a Ruby repository scanned cleanly and showed
 * zero symbols and zero edges — the same failure Go had before Phase 20,
 * and just as silent.
 *
 * The first test is therefore the regression guard for "confidently
 * empty", not a symbol-shape check.
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

const NOTIFIER = 'services/notifier';

async function fileSymbols(
  h: { client: { raw(method: string, p: string): Promise<Response> } },
  absPath: string,
): Promise<SymbolRow[]> {
  const resp = await h.client.raw('GET', `/api/symbols/file?path=${encodeURIComponent(absPath)}`);
  return (await resp.json()) as SymbolRow[];
}

test.describe('Ruby support (Phase 27)', () => {
  test.setTimeout(120_000);

  test('a Ruby file contributes symbols instead of rendering as an empty node', async () => {
    const h = await setupHarness('ruby-symbols');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const symbols = await fileSymbols(
        h,
        path.join(h.fixture.projectPath, NOTIFIER, 'lib/notifier.rb'),
      );
      expect(symbols.length, 'notifier.rb must contribute symbols').toBeGreaterThan(0);

      const byName = new Map(symbols.map((s) => [s.name, s]));

      // Nesting is the norm in Ruby, not an edge case.
      expect(byName.has('Notifier')).toBe(true);
      expect(byName.has('Notifier::Dispatcher')).toBe(true);
      expect(byName.get('Notifier::Dispatcher')?.kind).toBe('class');

      // Methods qualified the way Ruby writes them.
      expect(byName.has('Notifier::Dispatcher#dispatch')).toBe(true);
      expect(byName.has('Notifier::Dispatcher.default')).toBe(true);
      expect(byName.has('dispatch'), 'the unqualified form must not leak').toBe(false);

      // attr_accessor defines real methods.
      expect(byName.has('Notifier::Dispatcher#channel')).toBe(true);

      // A module is not a class.
      expect(byName.get('Notifier::Formatting')?.kind).toBe('interface');
    } finally {
      await h.teardown();
    }
  });

  test('require_relative resolves; stdlib does not', async () => {
    const h = await setupHarness('ruby-resolve');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const edges = ((await h.client.getDependencyEdges()) as DepEdge[]).filter((e) =>
        e.sourceRelative.endsWith('.rb'),
      );

      // app.rb requires lib/notifier, which requires channels/email.
      expect(
        edges.find(
          (e) =>
            e.sourceRelative.endsWith(`${NOTIFIER}/app.rb`) &&
            e.targetRelative.endsWith(`${NOTIFIER}/lib/notifier.rb`),
        ),
        'app.rb → lib/notifier.rb',
      ).toBeTruthy();

      expect(
        edges.find(
          (e) =>
            e.sourceRelative.endsWith(`${NOTIFIER}/lib/notifier.rb`) &&
            e.targetRelative.endsWith(`${NOTIFIER}/lib/channels/email.rb`),
        ),
        'notifier.rb → channels/email.rb',
      ).toBeTruthy();

      // `require 'set'` and `require 'json'` are stdlib — an over-eager
      // resolver would invent an edge for them.
      for (const edge of edges) {
        expect(edge.targetRelative).not.toMatch(/(^|\/)(set|json)\.rb$/);
        expect(edge.targetRelative).toMatch(/\.rb$/);
      }
    } finally {
      await h.teardown();
    }
  });

  test('editing a Ruby file re-parses it', async () => {
    const h = await setupHarness('ruby-watch');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // The watcher's extension set is derived from the parser registry,
      // so registering the plugin is all it should take. This asserts
      // that, because the same list has silently gone stale twice.
      const target = path.join(h.fixture.projectPath, NOTIFIER, 'lib/notifier.rb');
      const fs = await import('node:fs');
      fs.appendFileSync(target, "\nmodule Notifier\n  class LateArrival\n  end\nend\n");

      const { waitFor } = await import('../harness');
      await waitFor(
        async () => {
          const symbols = await fileSymbols(h, target);
          return symbols.some((s) => s.name === 'Notifier::LateArrival') ? symbols : null;
        },
        { timeoutMs: 15_000, description: 'the edited Ruby file to re-parse' },
      );
    } finally {
      await h.teardown();
    }
  });
});
