/**
 * Capturing a baseline does not stop the server answering. Pinning a
 * project with no git parses and stores every file; the storing ran in one
 * synchronous loop, about a millisecond a file, so on a project of a few
 * thousand files every other request (the window's, an agent's) waited
 * seconds for it. A scan stored the same way.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupHarness, type Harness } from '../harness';

const FILES = 2500;

test.describe.serial('Baseline capture and the rest of the server', () => {
  test.setTimeout(300_000);

  let h: Harness;
  let root: string;

  /** The slowest answer to a cheap request while `work` runs. */
  const worstWhile = async (work: () => Promise<unknown>) => {
    let done = false;
    const waits: number[] = [];
    const poll = (async () => {
      while (!done) {
        const started = Date.now();
        await h.client.raw('GET', '/api/health');
        waits.push(Date.now() - started);
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    const result = await work();
    done = true;
    await poll;
    return { result, worst: Math.max(...waits), answered: waits.length };
  };

  test.beforeAll(async () => {
    h = await setupHarness('baseline-responsive');
    // No .git: the baseline is the working tree, parsed and stored here.
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-many-files-'));
    for (let i = 0; i < FILES; i++) {
      const dir = path.join(root, 'src', `m${Math.floor(i / 100)}`);
      fs.mkdirSync(dir, { recursive: true });
      const next = `./f${i + 1}`;
      const fns = Array.from({ length: 8 }, (_, k) => `export function f${i}_${k}(n: number): number {\n  return n * ${k} + ${i};\n}\n`).join('');
      fs.writeFileSync(path.join(dir, `f${i}.ts`), `${i % 100 === 99 ? '' : `import { f${i + 1}_0 } from '${next}';\n`}${fns}`);
    }
    await h.client.scanProject(root);
  });

  test.afterAll(async () => {
    await h?.teardown();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a working-tree capture of thousands of files leaves cheap requests prompt', async () => {
    const { result, worst, answered } = await worstWhile(() => h.client.raw('POST', '/api/baseline/capture', { projectPath: root }));
    const res = result as Response;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; data: { files: unknown[]; edges: unknown[] } };
    expect(body.source).toBe('working-tree');
    expect(body.data.files).toHaveLength(FILES);
    expect(body.data.edges.length).toBeGreaterThan(FILES / 2);
    expect(answered).toBeGreaterThan(5);
    expect(worst).toBeLessThan(750);
  });

  test('so does a full scan', async () => {
    // A file changed on disk makes the next scan of this project incremental;
    // a different project first makes it full.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-small-'));
    fs.writeFileSync(path.join(other, 'a.ts'), 'export const a = 1;\n');
    await h.client.scanProject(other);
    const { worst } = await worstWhile(() => h.client.scanProject(root));
    fs.rmSync(other, { recursive: true, force: true });
    expect(worst).toBeLessThan(750);
  });
});
