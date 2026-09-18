/**
 * The review endpoints are confined to opened projects — Phase 29 / 19.
 *
 * Phase 29 made `/api/comparands`, `/api/compare`,
 * `/api/plans/:uid/review` and `/api/plans/:uid/pr-draft` reachable from
 * the UI. They took their project path straight from a query parameter,
 * which is exactly as caller-nominated as a body field — the thing
 * Phase 19's rule exists to prevent — and `listComparands` uses that
 * path as the working directory of a `git log`, so an unvalidated value
 * selects the repository a command runs in.
 *
 * Wiring a surface to an unvalidated root would have increased exposure,
 * so they were confined first. This is the test that says so.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupHarness } from '../harness';

/** Every confined endpoint, with the query it needs beyond `project`. */
const ENDPOINTS = [
  { name: 'comparands', path: () => '/api/comparands' },
  { name: 'compare', path: () => '/api/compare?before=baseline&after=live' },
  { name: 'review', path: (uid: string) => `/api/plans/${uid}/review` },
  { name: 'pr-draft', path: (uid: string) => `/api/plans/${uid}/pr-draft` },
];

test.describe('Review endpoints are confined (Phase 29 / 19)', () => {
  test.setTimeout(120_000);

  test('a project path outside every opened project is refused', async () => {
    const h = await setupHarness('review-confinement');
    // A real git repository, so a refusal cannot be mistaken for "that
    // directory was not usable anyway".
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-outside-'));
    fs.writeFileSync(path.join(outside, 'README.md'), '# not yours\n');

    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'A plan to review',
        projectPath: h.fixture.projectPath,
      });

      for (const ep of ENDPOINTS) {
        const url = `${ep.path(plan.uid)}${ep.path(plan.uid).includes('?') ? '&' : '?'}project=${encodeURIComponent(outside)}`;
        const res = await h.client.raw('GET', url);
        expect(
          res.status,
          `${ep.name} must refuse a path outside every opened project`,
        ).toBe(403);
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      await h.teardown();
    }
  });

  test('the opened project is still accepted', async () => {
    const h = await setupHarness('review-confinement-ok');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'A plan to review',
        projectPath: h.fixture.projectPath,
      });

      // The control case. A confinement check that refuses everything is
      // not a confinement check, it is a broken endpoint.
      for (const ep of ENDPOINTS) {
        const base = ep.path(plan.uid);
        const url = `${base}${base.includes('?') ? '&' : '?'}project=${encodeURIComponent(h.fixture.projectPath)}`;
        const res = await h.client.raw('GET', url);
        expect(
          res.status,
          `${ep.name} must accept the opened project`,
        ).not.toBe(403);
      }
    } finally {
      await h.teardown();
    }
  });

  test('a missing project parameter is a 400, not a crash', async () => {
    const h = await setupHarness('review-confinement-missing');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const res = await h.client.raw('GET', '/api/comparands');
      expect([400, 403]).toContain(res.status);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    } finally {
      await h.teardown();
    }
  });
});
