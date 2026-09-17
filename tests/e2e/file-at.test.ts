/**
 * Reading a file at a point in time — Phase 26, the diff editor's
 * backing call.
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * The refusals matter more than the happy path here. A checkpoint and
 * the baseline store content *hashes*, not blobs, so they can say which
 * files changed but never how — and falling back to the live file would
 * diff a file against itself and render as "no changes", which is a
 * confident wrong answer where the honest one is "cannot".
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness } from '../harness';

interface FileAtResult {
  ok: boolean;
  content: string | null;
  unavailable?: string;
  label: string;
}

interface Comparand {
  spec: string;
  kind: string;
}

const TARGET = 'packages/shared/src/validators.ts';

async function fileAt(
  h: { client: { raw(m: string, p: string): Promise<Response> }; fixture: { projectPath: string } },
  at: string,
  relativePath = TARGET,
): Promise<{ status: number; body: FileAtResult }> {
  const res = await h.client.raw(
    'GET',
    `/api/file/at?project=${encodeURIComponent(h.fixture.projectPath)}` +
      `&path=${encodeURIComponent(relativePath)}&at=${encodeURIComponent(at)}`,
  );
  return { status: res.status, body: (await res.json()) as FileAtResult };
}

test.describe('File at a point in time (Phase 26)', () => {
  test.setTimeout(120_000);

  test('live returns the working tree', async () => {
    const h = await setupHarness('file-at-live');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const onDisk = fs.readFileSync(path.join(h.fixture.projectPath, TARGET), 'utf-8');

      const { body } = await fileAt(h, 'live');
      expect(body.ok).toBe(true);
      expect(body.content).toBe(onDisk);
    } finally {
      await h.teardown();
    }
  });

  test('a commit returns the file as it was, not as it is', async () => {
    const h = await setupHarness('file-at-commit');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const comparands = (await (
        await h.client.raw('GET', `/api/comparands?project=${encodeURIComponent(h.fixture.projectPath)}`)
      ).json()) as Comparand[];
      const commit = comparands.find((c) => c.kind === 'commit')!;

      // Change the working tree AFTER the commit.
      const abs = path.join(h.fixture.projectPath, TARGET);
      const original = fs.readFileSync(abs, 'utf-8');
      fs.appendFileSync(abs, '\nexport const ADDED_AFTER_COMMIT = true;\n');

      const atCommit = await fileAt(h, commit.spec);
      expect(atCommit.body.ok).toBe(true);
      expect(atCommit.body.content).toBe(original);
      expect(atCommit.body.content).not.toContain('ADDED_AFTER_COMMIT');

      const atLive = await fileAt(h, 'live');
      expect(atLive.body.content).toContain('ADDED_AFTER_COMMIT');
    } finally {
      await h.teardown();
    }
  });

  test('a file that did not exist at that commit reads as absent, not as an error', async () => {
    const h = await setupHarness('file-at-absent');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const comparands = (await (
        await h.client.raw('GET', `/api/comparands?project=${encodeURIComponent(h.fixture.projectPath)}`)
      ).json()) as Comparand[];
      const commit = comparands.find((c) => c.kind === 'commit')!;

      const { body } = await fileAt(h, commit.spec, 'packages/shared/src/not-yet-written.ts');
      // Ordinary — a file added since. The diff renders it as wholly
      // added rather than failing.
      expect(body.ok).toBe(true);
      expect(body.content).toBeNull();
    } finally {
      await h.teardown();
    }
  });

  test('a checkpoint says it cannot supply contents, rather than returning the live file', async () => {
    const h = await setupHarness('file-at-checkpoint');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      for (const spec of ['baseline', 'checkpoint:1']) {
        const { body } = await fileAt(h, spec);
        expect(body.ok, `${spec} must not claim to supply contents`).toBe(false);
        expect(body.content).toBeNull();
        expect(body.unavailable).toMatch(/content hashes/);
      }
    } finally {
      await h.teardown();
    }
  });

  test('an unknown comparand is refused', async () => {
    const h = await setupHarness('file-at-unknown');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const { body } = await fileAt(h, 'nonsense:42');
      expect(body.ok).toBe(false);
      expect(body.unavailable).toMatch(/Unknown comparand/);
    } finally {
      await h.teardown();
    }
  });

  test('a path traversing upwards is refused', async () => {
    const h = await setupHarness('file-at-traversal');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const res = await h.client.raw(
        'GET',
        `/api/file/at?project=${encodeURIComponent(h.fixture.projectPath)}` +
          `&path=${encodeURIComponent('../../../etc/hosts')}&at=live`,
      );
      expect(res.status).toBe(400);
    } finally {
      await h.teardown();
    }
  });

  test('a project that is not open is refused', async () => {
    const h = await setupHarness('file-at-closed');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const res = await h.client.raw(
        'GET',
        `/api/file/at?project=${encodeURIComponent('/tmp')}&path=${encodeURIComponent('x.ts')}&at=live`,
      );
      expect(res.status).toBe(403);
    } finally {
      await h.teardown();
    }
  });
});
