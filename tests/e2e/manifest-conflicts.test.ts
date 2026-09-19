/**
 * Manifest conflicts — Phase 29 §4.9.
 *
 * `plan-conflict-service` (Phase 6.4) detects git merge conflicts under
 * `.codetrellis/`, parses both sides into typed fields where it can,
 * and resolves them either field by field or by taking a whole side.
 * Detection *and* resolution shipped behind `/api/conflicts` and
 * `/api/conflicts/resolve`, and until Phase 29 nothing in either client
 * called either one — so nothing exercised them at all.
 *
 * These tests drive a real merge conflict rather than a synthetic file
 * with markers pasted in: `detectManifestConflicts` returns early
 * unless `.git/MERGE_HEAD` exists and `git diff --diff-filter=U` lists
 * the file, so a fabricated conflict would pass through code that never
 * runs in production.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupHarness, type Harness } from '../harness';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'CodeTrellis Harness',
  GIT_AUTHOR_EMAIL: 'harness@codetrellis.local',
  GIT_COMMITTER_NAME: 'CodeTrellis Harness',
  GIT_COMMITTER_EMAIL: 'harness@codetrellis.local',
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: GIT_ENV,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Branch, change `.codetrellis/plans/<slug>/plan.yaml` on both sides,
 * merge, and leave the repo mid-conflict. Returns the file's path
 * relative to the project root — which is the spelling the service
 * reports and the API expects back.
 */
function createManifestConflict(projectPath: string): string {
  const relPath = '.codetrellis/plans/demo/plan.yaml';
  const absPath = path.join(projectPath, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  // Base: the file exists on main, so both branches modify rather than
  // both add — an add/add conflict parses differently and is not the
  // case this service was written for.
  fs.writeFileSync(absPath, 'title: Demo plan\nstatus: draft\nowner: base\n');
  git(projectPath, ['add', '--', relPath]);
  git(projectPath, ['commit', '-q', '-m', 'Add demo plan manifest']);

  git(projectPath, ['checkout', '-q', '-b', 'theirs']);
  fs.writeFileSync(absPath, 'title: Demo plan\nstatus: approved\nowner: them\n');
  git(projectPath, ['commit', '-q', '-am', 'Their edit']);

  git(projectPath, ['checkout', '-q', 'main']);
  fs.writeFileSync(absPath, 'title: Demo plan\nstatus: in_progress\nowner: us\n');
  git(projectPath, ['commit', '-q', '-am', 'Our edit']);

  // Expected to fail — that failure is the point.
  try {
    git(projectPath, ['merge', '--no-edit', 'theirs']);
    throw new Error('merge unexpectedly succeeded — the fixture did not conflict');
  } catch (err) {
    if (err instanceof Error && /did not conflict/.test(err.message)) throw err;
  }

  expect(fs.existsSync(path.join(projectPath, '.git', 'MERGE_HEAD'))).toBe(true);
  return relPath;
}

interface ConflictSummary {
  hasConflicts: boolean;
  files: Array<{
    filePath: string;
    planSlug: string | null;
    entityType: string;
    fields: Array<{ field: string; type: string; ours: unknown; theirs: unknown; autoResolvable: boolean }> | null;
  }>;
  totalConflicts: number;
  autoResolvable: number;
}

async function getConflicts(h: Harness): Promise<ConflictSummary> {
  const res = await h.client.raw(
    'GET',
    `/api/conflicts?project=${encodeURIComponent(h.fixture.projectPath)}`,
  );
  expect(res.ok).toBe(true);
  return await res.json() as ConflictSummary;
}

test.describe('Manifest conflicts', () => {
  test.setTimeout(120_000);

  test('a clean repository reports no conflicts', async () => {
    const h = await setupHarness('conflicts-clean');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const summary = await getConflicts(h);

      // The bar renders nothing on this answer, so it has to be the
      // answer for an ordinary repo — not an error, not a throw.
      expect(summary.hasConflicts).toBe(false);
      expect(summary.totalConflicts).toBe(0);
      expect(summary.files).toEqual([]);
    } finally {
      await h.teardown();
    }
  });

  test('detects a real merge conflict and parses both sides per field', async () => {
    const h = await setupHarness('conflicts-detect');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const relPath = createManifestConflict(h.fixture.projectPath);

      const summary = await getConflicts(h);
      expect(summary.hasConflicts).toBe(true);
      expect(summary.totalConflicts).toBe(1);

      const file = summary.files.find((f) => f.filePath === relPath);
      expect(file).toBeTruthy();
      expect(file!.entityType).toBe('plan');
      expect(file!.planSlug).toBe('demo');

      // A YAML file whose sides both parse must produce fields — this
      // is what lets the UI show a choice rather than "too tangled".
      expect(file!.fields).not.toBeNull();
      const byName = new Map(file!.fields!.map((f) => [f.field, f]));

      // `title` is identical on both sides, so only the two that
      // actually differ should be offered.
      expect(byName.has('status')).toBe(true);
      expect(byName.has('owner')).toBe(true);
      expect(byName.get('status')!.ours).toBe('in_progress');
      expect(byName.get('status')!.theirs).toBe('approved');
      expect(byName.get('owner')!.ours).toBe('us');
      expect(byName.get('owner')!.theirs).toBe('them');
    } finally {
      await h.teardown();
    }
  });

  test('field-level resolution writes the picked sides and stages the file', async () => {
    const h = await setupHarness('conflicts-resolve-fields');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const relPath = createManifestConflict(h.fixture.projectPath);

      // Take their status, keep our owner — a mix, so a result that
      // matched one whole side would not look like a pass.
      const res = await h.client.raw('POST', '/api/conflicts/resolve', {
        projectPath: h.fixture.projectPath,
        filePath: relPath,
        mode: 'fields',
        resolutions: [
          { field: 'status', pick: 'theirs' },
          { field: 'owner', pick: 'ours' },
        ],
      });
      expect(res.ok).toBe(true);
      expect(await res.json()).toMatchObject({ resolved: true });

      const merged = fs.readFileSync(path.join(h.fixture.projectPath, relPath), 'utf-8');
      expect(merged).toContain('approved');
      expect(merged).toContain('us');
      expect(merged).not.toContain('<<<<<<<');

      // Staged, not committed — the UI promises exactly this.
      const staged = git(h.fixture.projectPath, ['diff', '--name-only', '--cached']);
      expect(staged.split('\n')).toContain(relPath);
      expect(fs.existsSync(path.join(h.fixture.projectPath, '.git', 'MERGE_HEAD'))).toBe(true);

      // And the file is no longer conflicted.
      expect((await getConflicts(h)).hasConflicts).toBe(false);
    } finally {
      await h.teardown();
    }
  });

  test('by-side resolution takes a whole side', async () => {
    const h = await setupHarness('conflicts-resolve-side');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const relPath = createManifestConflict(h.fixture.projectPath);

      const res = await h.client.raw('POST', '/api/conflicts/resolve', {
        projectPath: h.fixture.projectPath,
        filePath: relPath,
        mode: 'by_side',
        side: 'theirs',
      });
      expect(res.ok).toBe(true);
      expect(await res.json()).toMatchObject({ resolved: true });

      const merged = fs.readFileSync(path.join(h.fixture.projectPath, relPath), 'utf-8');
      expect(merged).toContain('status: approved');
      expect(merged).toContain('owner: them');
      expect(merged).not.toContain('<<<<<<<');
      expect((await getConflicts(h)).hasConflicts).toBe(false);
    } finally {
      await h.teardown();
    }
  });

  /**
   * Both modes now refuse an escaping `filePath` with a 403, and each
   * got there from a different wrong answer:
   *
   *   - field-level already threw `ConfinementError`, but the route did
   *     not catch it, so a refusal surfaced as a 500 — a server fault,
   *     not a decision.
   *   - by-side confined nothing and handed the path to
   *     `git checkout`. git refuses an out-of-repo pathspec, so this
   *     was never exploitable — but the control belonged to git, and
   *     the service reported the rejection as a 200 carrying
   *     `resolved: false`.
   *
   * So this test pins the refusal, not a patched hole. That matters
   * because a caller cannot tell "refused" from "failed" when both are
   * 200, and Phase 29 gives this endpoint a UI that has to.
   */
  test('a filePath escaping the project is refused on both resolve modes', async () => {
    const h = await setupHarness('conflicts-confinement');
    // A real file outside the project, so a refusal cannot be confused
    // with "there was nothing there anyway".
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-conflict-outside-'));
    const victimPath = path.join(outside, 'victim.yaml');
    fs.writeFileSync(victimPath, 'owner: untouched\n');

    try {
      await h.client.scanProject(h.fixture.projectPath);
      createManifestConflict(h.fixture.projectPath);

      const escape = path.relative(h.fixture.projectPath, victimPath);
      expect(escape.startsWith('..')).toBe(true);

      for (const body of [
        { mode: 'fields', resolutions: [{ field: 'owner', pick: 'theirs' }] },
        { mode: 'by_side', side: 'theirs' },
      ]) {
        const res = await h.client.raw('POST', '/api/conflicts/resolve', {
          projectPath: h.fixture.projectPath,
          filePath: escape,
          ...body,
        });
        // Refused, and specifically as a refusal — a 500 here would mean
        // the confinement throw is escaping as a server fault.
        expect(res.status).toBe(403);
      }

      // git would have refused the by-side path anyway; assert the file
      // is intact so that stays true if the implementation ever stops
      // going through git.
      expect(fs.readFileSync(victimPath, 'utf-8')).toBe('owner: untouched\n');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      await h.teardown();
    }
  });
});
