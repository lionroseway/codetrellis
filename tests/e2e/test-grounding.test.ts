/**
 * Phase 32 B8.2 — tests mapped to the code they import.
 *
 * Sam's agent has two test files for the shared validators: one imports
 * `validators.ts` directly, the other through the package's `index.ts`
 * barrel. With their report handed over, `validators.ts` says which of its
 * tests fail and why; `types.ts`, which no test imports, says it has none.
 * Once the tests pass, the file reads "✓ passing", until it changes after
 * the run: then "⚠ tests older than the code", the line that stops "done"
 * on stale results. A test file shows its own tests. An agent asking with
 * get_test_results(for_file) and the window's Inspector hear the same.
 * CodeTrellis runs nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const SHARED = 'packages/shared/src';
const junit = (cases: string) => `<testsuites><testsuite name="shared">\n${cases}\n</testsuite></testsuites>\n`;
const DIRECT = `${SHARED}/validators.test.ts`;
const BARREL = `${SHARED}/barrel.test.ts`;
const run = (failing: boolean) => junit([
  `<testcase classname="validators" name="accepts a real email" file="${DIRECT}"/>`,
  failing
    ? `<testcase classname="validators" name="needs a name" file="${DIRECT}"><failure message="expected [] to include 'name is required'"/></testcase>`
    : `<testcase classname="validators" name="needs a name" file="${DIRECT}"/>`,
  `<testcase classname="barrel" name="re-exports isValidEmail" file="${BARREL}"/>`,
].join('\n'));

interface Grounding { path: string; state: string; words: string; testFiles: string[]; tests: Array<{ label: string; result: string; message: string | null }>; isTest: boolean }

test.describe.serial('Tests mapped to code', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  const write = (rel: string, body: string, mtime?: Date) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    if (mtime) fs.utimesSync(p, mtime, mtime);
  };
  const grounding = async (file: string) => (await (await h.client.raw('GET', `/api/tests/grounding?project=${encodeURIComponent(root)}&path=${encodeURIComponent(file)}`)).json()) as Grounding;
  const report = async (rel: string, body: string, at: Date) => {
    write(rel, body, at);
    const r = await agent.callTool('report_tests', { path: rel });
    expect(r.isError, r.text).toBeFalsy();
  };

  test.beforeAll(async () => {
    h = await setupHarness('test-grounding');
    root = h.fixture.projectPath;
    const old = new Date(Date.now() - 3_600_000);
    write(DIRECT, `import { validateCreateUser, isValidEmail } from './validators';\nexport const cases = [validateCreateUser, isValidEmail];\n`, old);
    write(BARREL, `import { isValidEmail } from './index';\nexport const cases = [isValidEmail];\n`, old);
    for (const f of ['validators.ts', 'types.ts', 'index.ts']) fs.utimesSync(path.join(root, SHARED, f), old, old);
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('before any report, a file says it has no tests', async () => {
    expect(await grounding(`${SHARED}/validators.ts`)).toMatchObject({ state: 'untested', words: '○ no tests: no test with a reported result imports it', tests: [] });
  });

  test('with the run handed over: its tests, directly and through the barrel, the failing one named', async () => {
    await report('reports/shared-1.xml', run(true), new Date(Date.now() - 600_000));
    const g = await grounding(`${SHARED}/validators.ts`);
    expect(g).toMatchObject({ state: 'failing', words: '✗ 1 of 3 tests failing', testFiles: [BARREL, DIRECT], isTest: false });
    expect(g.tests.find((t) => t.result === 'failed')).toMatchObject({ label: 'validators › needs a name', message: "expected [] to include 'name is required'" });
  });

  test('a file no test imports says so, even beside tested ones', async () => {
    expect(await grounding(`${SHARED}/types.ts`)).toMatchObject({ state: 'untested', testFiles: [] });
  });

  test('fixed and run again: passing', async () => {
    await report('reports/shared-2.xml', run(false), new Date(Date.now() - 300_000));
    expect(await grounding(`${SHARED}/validators.ts`)).toMatchObject({ state: 'passing', words: '✓ 3 tests passing' });
  });

  test('changed after the run: tests older than the code', async () => {
    const file = path.join(root, SHARED, 'validators.ts');
    fs.appendFileSync(file, '\nexport const touched = true;\n');
    expect(await grounding(`${SHARED}/validators.ts`)).toMatchObject({ state: 'stale', words: '⚠ tests older than the code: it changed after its 3 tests last ran' });
  });

  test('B8.3a: the map for the graph says the same as each file, and leaves out what no test reaches', async () => {
    const map = (await (await h.client.raw('GET', `/api/tests/grounding/map?project=${encodeURIComponent(root)}`)).json()) as { hasResults: boolean; files: Record<string, { state: string; words: string }> };
    expect(map.hasResults).toBe(true);
    expect(map.files[`${SHARED}/validators.ts`]).toEqual({ state: 'stale', words: '⚠ tests older than the code: it changed after its 3 tests last ran' });
    expect(map.files[`${SHARED}/types.ts`]).toBeUndefined();
    for (const [file, g] of Object.entries(map.files)) {
      const one = await grounding(file);
      expect({ state: one.state, words: one.words }, file).toEqual(g);
    }
  });

  test('a test file shows its own tests', async () => {
    expect(await grounding(DIRECT)).toMatchObject({ isTest: true, testFiles: [DIRECT], words: '✓ 2 tests passing' });
  });

  test('an agent asking for a file hears the same; a path outside the project is refused', async () => {
    const r = await agent.callTool('get_test_results', { for_file: `${SHARED}/validators.ts` });
    expect(r.isError, r.text).toBeFalsy();
    expect(JSON.parse(r.text)).toMatchObject({ file: `${SHARED}/validators.ts`, state: 'stale', says: '⚠ tests older than the code: it changed after its 3 tests last ran', test_files: [BARREL, DIRECT] });
    const out = await agent.callTool('get_test_results', { for_file: '../elsewhere.ts' });
    expect(out.isError).toBe(true);
    expect(out.text).toBe('../elsewhere.ts is not a file inside this project.');
    expect((await h.client.raw('GET', `/api/tests/grounding?project=${encodeURIComponent(root)}&path=${encodeURIComponent('../elsewhere.ts')}`)).status).toBe(400);
    // A folder has no tests of its own: asked about one, it says so rather than "no tests".
    const folder = await h.client.raw('GET', `/api/tests/grounding?project=${encodeURIComponent(root)}&path=${encodeURIComponent(SHARED)}`);
    expect(folder.status).toBe(400);
    expect((await folder.json()).error).toBe(`${SHARED} is a folder, not a file.`);
  });
});
