/**
 * A typo must not read as "clear my budget".
 *
 * The chip's ceiling inputs are free text — `inputMode` is only a soft-keyboard
 * hint — and `save()` sent `Number(draft)` with no validation. `Number('ten')`
 * is NaN, and `JSON.stringify` turns NaN into `null`, which is the wire form of
 * "remove this ceiling". The PUT handler did not validate either, so a mistyped
 * budget silently deleted a real one and reported success.
 *
 * Validated on the server because that is the boundary every client crosses —
 * the chip, the MCP tool, and a phone. The chip also parses before sending, so
 * the user is told rather than silently corrected, but that is the second line.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

test.describe('Budget ceilings are validated', () => {
  test.setTimeout(120_000);

  test('a non-numeric ceiling is refused and does not clear an existing one', async () => {
    const h = await setupHarness('budget-ceiling');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({ title: 'Budgeted', projectPath: h.fixture.projectPath });
      const url = `/api/plans/${encodeURIComponent(plan.uid)}/budget`;

      // Set a real ceiling first — this is what a typo used to destroy.
      const set = await h.client.raw('PUT', url, { minutes: 120, costUsd: 5 });
      expect(set.ok).toBe(true);

      // NaN on the wire is indistinguishable from an explicit null, which is
      // exactly why it has to be rejected rather than interpreted.
      const bad = await h.client.raw('PUT', url, { minutes: null, costUsd: null, __typo: true });
      expect(bad.ok).toBe(true); // explicit nulls ARE a legitimate clear

      await h.client.raw('PUT', url, { minutes: 120, costUsd: 5 });
      for (const body of [{ minutes: -5 }, { minutes: 0 }, { costUsd: -1 }, { minutes: 'ten' }]) {
        const res = await h.client.raw('PUT', url, body as Record<string, unknown>);
        expect(res.status, `${JSON.stringify(body)} must be refused`).toBe(400);
      }

      // And the ceiling that was there is still there.
      const after = await h.client.raw('GET', url.replace('/budget', '/budget'));
      expect(after.ok).toBe(true);
      const report = (await after.json()) as { budget?: { minutes: number | null } | null };
      expect(report.budget?.minutes).toBe(120);
    } finally {
      await h.teardown();
    }
  });
});
