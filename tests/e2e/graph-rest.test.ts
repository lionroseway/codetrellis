/**
 * The graph's REST read side, by behaviour (Phase 32 §0.4b).
 *
 * `/api/diff` — the architecture diff the Diff mode and Changes tab draw —
 * was only ever called by a confinement test that expects a refusal, so
 * whether it reports a change was untested. The architecture summary and
 * systems list were checked for shape only.
 *
 * The live graph between scans is kept by the file watcher, and writing
 * these found it degrading with every edit (bug 20): a new file never got
 * its import edges, an edited file LOST its outgoing edges, and a deleted
 * file stayed in the graph — all until the next full rescan. No rescan
 * happens in this file on purpose.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setupHarness, waitFor, type Harness } from '../harness';

interface Diff {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  addedEdges: Array<{ source: string; target: string }>;
  blastRadius: string[];
  summary: { added: number; removed: number; modified: number; edgesAdded: number; edgesRemoved: number };
  git: { untracked: string[]; unstaged: string[] } | null;
}

test.describe.serial('Graph REST reads', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let q: string;

  test.beforeAll(async () => {
    h = await setupHarness('graph-rest');
    root = h.fixture.projectPath;
    q = encodeURIComponent(root);
    await h.client.scanProject(root);
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('architecture summary agrees with the stats and names the fixture\'s languages', async () => {
    const res = await h.client.raw('GET', '/api/architecture-summary');
    expect(res.ok).toBe(true);
    const s = (await res.json()) as {
      fileCount: number; symbolCount: number;
      topDirectories: Array<{ dir: string }>; languageBreakdown: Array<{ language: string; count: number }>;
      mostImported: Array<{ path: string; importerCount: number }>;
    };
    const stats = await h.client.getStats();
    expect(s.fileCount).toBe(stats.fileCount);
    expect(s.symbolCount).toBe(stats.symbolCount);
    expect(s.topDirectories.map((d) => d.dir)).toEqual(expect.arrayContaining(['packages', 'services']));
    const langs = s.languageBreakdown.map((l) => l.language);
    for (const lang of ['typescript', 'python', 'go']) expect(langs, JSON.stringify(langs)).toContain(lang);
    expect(s.mostImported.length).toBeGreaterThan(0);
    expect(s.mostImported[0].importerCount).toBeGreaterThan(0);
  });

  test('systems lists the fixture\'s services', async () => {
    const res = await h.client.raw('GET', `/api/systems?project=${q}`);
    const { systems } = (await res.json()) as { systems: Array<{ path?: string; root?: string; name?: string }> };
    const where = JSON.stringify(systems);
    for (const dir of ['packages/web', 'services/api', 'services/billing']) expect(where).toContain(dir);
  });

  test('the diff is empty straight after a scan', async () => {
    const d = (await (await h.client.raw('GET', `/api/diff?project=${q}`)).json()) as Diff;
    expect(d.summary).toMatchObject({ added: 0, removed: 0, modified: 0, edgesAdded: 0, edgesRemoved: 0 });
  });

  test('the diff reports an added file, its new import edge, a modified file and the blast radius', async () => {
    fs.writeFileSync(
      path.join(root, 'packages/web/src/Extra.ts'),
      "import { listUsers } from './api';\nexport const extra = listUsers;\n",
    );
    fs.appendFileSync(path.join(root, 'packages/web/src/api.ts'), '\nexport const touched = true;\n');

    const d = await waitFor(async () => {
      const body = (await (await h.client.raw('GET', `/api/diff?project=${q}`)).json()) as Diff;
      return body.summary.added >= 1 && body.summary.modified >= 1 ? body : null;
    }, { timeoutMs: 15_000, description: 'the file watcher to record both changes' });

    expect(d.addedFiles).toContain('packages/web/src/Extra.ts');
    expect(d.modifiedFiles).toContain('packages/web/src/api.ts');
    expect(d.addedEdges).toContainEqual({ source: 'packages/web/src/Extra.ts', target: 'packages/web/src/api.ts' });
    // Files that import the modified api.ts, and did not change themselves.
    expect(d.blastRadius).toContain('packages/web/src/UserList.tsx');
    expect(d.git?.untracked).toContain('packages/web/src/Extra.ts');
  });

  test('editing a file keeps its outgoing import edges', async () => {
    const file = path.join(root, 'packages/web/src/OrderList.tsx');
    const before = (await (await h.client.raw('GET', `/api/dependencies/file?path=${encodeURIComponent(file)}`)).json()) as { imports: Array<{ relativePath: string }> };
    expect(before.imports.length).toBeGreaterThan(0);

    fs.appendFileSync(file, '\n// edited\n');
    await waitFor(async () => {
      const d = (await (await h.client.raw('GET', `/api/diff?project=${q}`)).json()) as Diff;
      return d.modifiedFiles.includes('packages/web/src/OrderList.tsx');
    }, { timeoutMs: 15_000, description: 'the watcher to re-parse OrderList.tsx' });

    const after = (await (await h.client.raw('GET', `/api/dependencies/file?path=${encodeURIComponent(file)}`)).json()) as typeof before;
    expect(after.imports.map((d) => d.relativePath).sort()).toEqual(before.imports.map((d) => d.relativePath).sort());
  });

  test('deleting a file takes it, and its edges, out of the graph', async () => {
    const baseFiles = (await h.client.getStats()).fileCount;
    fs.rmSync(path.join(root, 'packages/web/src/Extra.ts'));
    await waitFor(async () => (await h.client.getStats()).fileCount === baseFiles - 1 || null, {
      timeoutMs: 15_000, description: 'the watcher to drop Extra.ts',
    });
    const d = (await (await h.client.raw('GET', `/api/diff?project=${q}`)).json()) as Diff;
    expect(d.addedFiles).not.toContain('packages/web/src/Extra.ts');
    expect(d.addedEdges.map((e) => e.source)).not.toContain('packages/web/src/Extra.ts');
  });
});
