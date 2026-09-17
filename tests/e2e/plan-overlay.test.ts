/**
 * Plan overlay on code — Phase 26, layer A.
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * `FileSpec.edits[]` has carried `lineRange` and `symbol` since Phase 15
 * §M2 and nothing ever drew it. These tests cover the projection
 * end-to-end, and in particular the refusals — an edit that cannot be
 * placed is reported, never guessed at.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { setupHarness } from '../harness';

interface OverlayMarker {
  itemUid: string;
  itemTitle: string;
  anchor: 'lines' | 'symbol' | 'file' | 'unanchored';
  startLine: number | null;
  endLine: number | null;
  reason?: string;
}

interface FileOverlay {
  relativePath: string;
  markers: OverlayMarker[];
  fileLevel: OverlayMarker[];
  unanchored: OverlayMarker[];
  itemCount: number;
}

const TARGET = 'packages/shared/src/validators.ts';

async function overlayFor(
  h: { client: { raw(m: string, p: string): Promise<Response> }; fixture: { projectPath: string } },
): Promise<FileOverlay> {
  const abs = path.join(h.fixture.projectPath, TARGET);
  const res = await h.client.raw(
    'GET',
    `/api/file/overlay?path=${encodeURIComponent(abs)}&project=${encodeURIComponent(h.fixture.projectPath)}`,
  );
  expect(res.ok).toBe(true);
  return (await res.json()) as FileOverlay;
}

async function seedItem(
  h: { client: { createPlan(i: unknown): Promise<{ uid: string }> }; fixture: { projectPath: string } },
  agent: { callTool: (t: string, a: unknown) => Promise<{ text: string; isError?: boolean }> },
  title: string,
  fileSpecs: unknown[],
): Promise<string> {
  const plan = await h.client.createPlan({
    title,
    description: '',
    projectPath: h.fixture.projectPath,
    tasks: [],
  });
  const res = await agent.callTool('add_item', {
    plan_uid: plan.uid,
    kind: 'action',
    title,
    file_specs: fileSpecs,
  });
  expect(res.isError).toBeFalsy();
  return plan.uid;
}

test.describe('Plan overlay on code (Phase 26)', () => {
  test.setTimeout(120_000);

  test('a line-pinned edit lands on exactly those lines', async () => {
    const h = await setupHarness('overlay-lines');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-overlay' });

      await seedItem(h, agent, 'Tighten validation', [
        {
          path: TARGET,
          action: 'modify',
          edits: [{ lineRange: { start: 3, end: 6 }, instruction: 'add a length check', intent: 'modify' }],
        },
      ]);

      const overlay = await overlayFor(h);
      expect(overlay.markers).toHaveLength(1);
      expect(overlay.markers[0].anchor).toBe('lines');
      expect(overlay.markers[0].startLine).toBe(3);
      expect(overlay.markers[0].endLine).toBe(6);
      expect(overlay.markers[0].itemTitle).toBe('Tighten validation');
      expect(overlay.itemCount).toBe(1);
    } finally {
      await h.teardown();
    }
  });

  test('an edit pinned to a symbol resolves through the symbols table', async () => {
    const h = await setupHarness('overlay-symbol');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-overlay' });

      // Pick a symbol the scan actually found, so the test asserts
      // resolution rather than a guess about the fixture.
      const abs = path.join(h.fixture.projectPath, TARGET);
      const symbols = (await (
        await h.client.raw('GET', `/api/symbols/file?path=${encodeURIComponent(abs)}`)
      ).json()) as Array<{ name: string; startLine: number; endLine: number }>;
      expect(symbols.length).toBeGreaterThan(0);
      const target = symbols[0];

      await seedItem(h, agent, 'Rework a validator', [
        { path: TARGET, action: 'modify', edits: [{ symbol: target.name, instruction: 'rework it' }] },
      ]);

      const overlay = await overlayFor(h);
      const marker = overlay.markers.find((m) => m.anchor === 'symbol');
      expect(marker, `expected a symbol marker for ${target.name}`).toBeTruthy();
      expect(marker!.startLine).toBe(target.startLine);
      expect(marker!.endLine).toBe(target.endLine);
    } finally {
      await h.teardown();
    }
  });

  test('a range past the end of the file is reported unanchored, never clamped', async () => {
    const h = await setupHarness('overlay-unanchored');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-overlay' });

      await seedItem(h, agent, 'Stale plan', [
        {
          path: TARGET,
          action: 'modify',
          edits: [{ lineRange: { start: 9000, end: 9100 }, instruction: 'edit line 9000' }],
        },
      ]);

      const overlay = await overlayFor(h);
      // A marker in the wrong place is worse than no marker, because a
      // reader believes it.
      expect(overlay.markers).toHaveLength(0);
      expect(overlay.unanchored).toHaveLength(1);
      expect(overlay.unanchored[0].reason).toMatch(/but the file has/);
    } finally {
      await h.teardown();
    }
  });

  test('a file-wide target is a banner, not a whole-file highlight', async () => {
    const h = await setupHarness('overlay-file-level');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-overlay' });

      await seedItem(h, agent, 'Rewrite validators', [{ path: TARGET, action: 'modify' }]);

      const overlay = await overlayFor(h);
      expect(overlay.markers).toHaveLength(0);
      expect(overlay.fileLevel).toHaveLength(1);
      expect(overlay.fileLevel[0].anchor).toBe('file');
      expect(overlay.fileLevel[0].startLine).toBeNull();
    } finally {
      await h.teardown();
    }
  });

  test('a file no plan targets gets an empty overlay, not an error', async () => {
    const h = await setupHarness('overlay-empty');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const overlay = await overlayFor(h);
      expect(overlay.markers).toHaveLength(0);
      expect(overlay.fileLevel).toHaveLength(0);
      expect(overlay.itemCount).toBe(0);
    } finally {
      await h.teardown();
    }
  });

  test('a file outside every opened project is refused', async () => {
    const h = await setupHarness('overlay-confined');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const res = await h.client.raw(
        'GET',
        `/api/file/overlay?path=${encodeURIComponent('/etc/hosts')}&project=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      // Same confinement as /api/file/content — the owning root is
      // derived from the opened projects, never nominated by the caller.
      expect(res.status).toBe(403);
    } finally {
      await h.teardown();
    }
  });
});
