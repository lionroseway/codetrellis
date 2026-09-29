/**
 * A project's diff is only ever its own (Phase 32 HD1).
 *
 * The backend holds one project's baseline and files at a time. When
 * another window scanned another project, `/api/diff?project=<this one>`
 * compared that project's files against its baseline and sent the result:
 * files this canvas does not have, drawn as extra ghost nodes on it (about
 * twenty on the browser suite's repository; the follow-up logged at #196).
 *
 * Now it says whose data it holds instead, as `/api/dependencies` does
 * (#195): `{ otherProject: true, project }` and the project in
 * `X-CodeTrellis-Project`, and the canvas keeps the diff it has.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, prepareFixture, type Harness, type PreparedFixture } from '../harness';

interface Diff {
  summary?: { added: number; removed: number; modified: number };
  addedFiles?: unknown[]; removedFiles?: unknown[];
  otherProject?: boolean; project?: string; error?: string;
}

test.describe.serial('A project\'s diff is its own', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let other: PreparedFixture;
  let a: string;
  let b: string;

  const diffOf = async (root: string) => {
    const res = await h.client.raw('GET', `/api/diff?project=${encodeURIComponent(root)}`);
    return { status: res.status, header: decodeURIComponent(res.headers.get('x-codetrellis-project') ?? ''), body: (await res.json()) as Diff };
  };

  test.beforeAll(async () => {
    h = await setupHarness('diff-own-project');
    a = h.fixture.projectPath;
    other = prepareFixture('diff-own-project-other');
    b = other.projectPath;
    // The other project differs from this one, so its files could never pass for this one's.
    fs.writeFileSync(path.join(b, 'services', 'extra.py'), 'def extra():\n    return 1\n');
  });

  test.afterAll(async () => {
    await h?.teardown();
    other?.cleanup();
  });

  test('its own project: the diff, and whose it is', async () => {
    await h.client.scanProject(a);
    const own = await diffOf(a);
    expect(own.status).toBe(200);
    expect(own.body.otherProject).toBeUndefined();
    expect(own.body.summary).toMatchObject({ added: 0, removed: 0 });
    expect(own.header).toBe(a);
  });

  test('after another project\'s scan: it says so, and sends none of that project\'s files', async () => {
    await h.client.scanProject(b);
    const stale = await diffOf(a);
    expect(stale.status).toBe(200);
    expect(stale.body).toMatchObject({ otherProject: true, project: b });
    expect(stale.body.addedFiles ?? []).toEqual([]);
    expect(stale.body.removedFiles ?? []).toEqual([]);
    expect(stale.header).toBe(b);

    // The project it holds still gets its own diff.
    const current = await diffOf(b);
    expect(current.body.otherProject).toBeUndefined();
    expect(current.body.summary).toMatchObject({ added: 0, removed: 0 });
  });

  test('scanned again, the first project has its own diff back', async () => {
    await h.client.scanProject(a);
    const back = await diffOf(a);
    expect(back.body.otherProject).toBeUndefined();
    expect(back.body.summary).toMatchObject({ added: 0, removed: 0 });
    expect(back.header).toBe(a);
  });
});
