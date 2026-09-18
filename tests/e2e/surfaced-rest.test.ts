/**
 * Phase 29 §4.15 — the REST routes the newly-wired components call.
 *
 * `cdev-phase7.test.ts` already exercises promote / accept / pantry
 * through their **MCP tools**, so the services are covered. The REST
 * handlers are a separate layer with their own validation and their own
 * Phase 19 confinement, and until §4.15 nothing in either client called
 * them — `ContributionPanel`, `PantryPlaceholder`, `TeamActivityPanel`
 * and `AudioCaptureBar` all existed and none was imported by anything,
 * which is why the §2 endpoint grep reported them as surfaced.
 *
 * So these test the half the MCP tests cannot reach: the routes, as the
 * UI calls them.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupHarness, type Harness } from '../harness';

async function promote(h: Harness, title: string, uid: string) {
  return h.client.raw('POST', '/api/contributions/promote', {
    projectPath: h.fixture.projectPath,
    itemUid: uid,
    title,
    kind: 'object',
    body: `Body for ${title}`,
  });
}

test.describe('Surfaced REST routes (Phase 29 §4.15)', () => {
  test.setTimeout(120_000);

  test('promote → list → accept, the loop the panel now drives', async () => {
    const h = await setupHarness('surfaced-contributions');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // Nothing staged yet — the panel renders nothing on this answer,
      // so it has to be the answer for an ordinary project.
      const empty = await (await h.client.raw(
        'GET', `/api/contributions?project=${encodeURIComponent(h.fixture.projectPath)}`,
      )).json() as { total: number; branch: string };
      expect(empty.total).toBe(0);

      const res = await promote(h, 'Architecture notes', 'contrib-rest-001');
      expect(res.ok).toBe(true);

      const listed = await (await h.client.raw(
        'GET', `/api/contributions?project=${encodeURIComponent(h.fixture.projectPath)}`,
      )).json() as { total: number; branch: string; items: Array<{ title: string }> };
      expect(listed.total).toBe(1);
      expect(listed.items[0].title).toBe('Architecture notes');

      // The panel accepts into the plan's ON-DISK directory, and it
      // finds that directory from file-status rather than re-deriving
      // the slug. Mirror that here — a test that computed the slug
      // itself would pass even if the two disagreed.
      const plan = await h.client.createPlan({
        title: 'Receiving plan', projectPath: h.fixture.projectPath,
      });
      const exportRes = await h.client.raw(
        'POST', `/api/plans/${plan.uid}/export?path=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      expect(exportRes.ok).toBe(true);

      const status = await h.client.getPlanFileStatus(plan.uid, h.fixture.projectPath);
      expect(status.linked).toBe(true);
      const planSlug = status.planDir!.split(path.sep).filter(Boolean).pop()!;

      const acceptRes = await h.client.raw('POST', '/api/contributions/accept', {
        projectPath: h.fixture.projectPath,
        branch: listed.branch,
        planSlug,
      });
      expect(acceptRes.ok).toBe(true);
      const accepted = await acceptRes.json() as { accepted: number; errors: string[] };
      expect(accepted.accepted).toBe(1);
      expect(accepted.errors).toEqual([]);

      // Accept writes FILES — it does not touch the database, which is
      // exactly what the panel's wording promises. Assert the file, not
      // a plan item.
      const itemsDir = path.join(status.planDir!, 'items');
      const written = fs.readdirSync(itemsDir).filter((f) => f.endsWith('.yaml'));
      expect(written.length).toBeGreaterThan(0);
      const body = written.map((f) => fs.readFileSync(path.join(itemsDir, f), 'utf-8')).join('\n');
      expect(body).toContain('Architecture notes');
      // `promotedAt` is staging metadata and is stripped on accept.
      expect(body).not.toContain('promotedAt');
    } finally {
      await h.teardown();
    }
  });

  test('a projectPath outside every opened project is refused on both writes', async () => {
    const h = await setupHarness('surfaced-contributions-confinement');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-contrib-outside-'));
    try {
      await h.client.scanProject(h.fixture.projectPath);

      for (const [route, extra] of [
        ['/api/contributions/promote', { itemUid: 'x', title: 'x', kind: 'object' }],
        ['/api/contributions/accept', { branch: 'main', planSlug: 'x' }],
        ['/api/contributor-branch', { planSlug: 'x', branchName: 'x' }],
      ] as const) {
        const res = await h.client.raw('POST', route, { projectPath: outside, ...extra });
        expect(res.status, `${route} should refuse an unopened root`).toBe(403);
      }

      // Nothing was created out there.
      expect(fs.existsSync(path.join(outside, '.codetrellis'))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      await h.teardown();
    }
  });

  test('pantry resolve tells a missing reference apart from an external one', async () => {
    const h = await setupHarness('surfaced-pantry');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // The placeholder shows `reason` to explain why something cannot
      // be displayed, so a reason is what this has to return — the
      // difference between "not allowed" and "broken" is the whole
      // point of rendering a placeholder instead of a broken image.
      const res = await h.client.raw(
        'GET',
        `/api/pantry/resolve?project=${encodeURIComponent(h.fixture.projectPath)}`
        + `&refs=${encodeURIComponent('userdata://nope/missing.png')}`
        + `&refs=${encodeURIComponent('https://example.com/ok.png')}`,
      );
      expect(res.ok).toBe(true);
      const data = await res.json() as {
        total: number;
        results: Array<{ reference: string; status: string; reason?: string }>;
      };
      expect(data.total).toBe(2);

      const missing = data.results.find((r) => r.reference.startsWith('userdata://'))!;
      expect(missing.status).not.toBe('resolved');
      expect(missing.reason).toBeTruthy();

      // A URL needs no local file, so it must not be reported as a gap.
      const url = data.results.find((r) => r.reference.startsWith('https://'))!;
      expect(url.status).toBe('resolved');
    } finally {
      await h.teardown();
    }
  });

  test('team activity answers for a git project', async () => {
    const h = await setupHarness('surfaced-team-activity');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // The Team tab renders this. An error here would show as an empty
      // feed, which reads as "nobody did anything" rather than "this
      // did not work" — so the shape matters even when it is empty.
      const res = await h.client.raw(
        'GET',
        `/api/team-activity?project=${encodeURIComponent(h.fixture.projectPath)}&limit=10`,
      );
      expect(res.ok).toBe(true);
      const data = await res.json() as { total: number; entries: unknown[] };
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.total).toBe(data.entries.length);
    } finally {
      await h.teardown();
    }
  });
});
