/**
 * Import accuracy (Phase 32 A2.2), end to end on the sample app: the scanner
 * records the shared package's barrel (`export * from './validators'`), the
 * inspector's dependency answer says who uses a file through it, and an agent's
 * `check_footprint` finds importers through barrels and by name — including a
 * Python import written with an alias.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

interface Dep { relativePath: string; specifiers: string[]; reexport?: boolean; via?: string[]; possibly?: boolean }
interface Deps { imports: Dep[]; importedBy: Dep[]; throughReexports: Dep[] }
interface Footprint { paths: Array<{ path: string; imported_by: string[]; importers: Array<{ path: string; names: string[]; possibly: boolean; via: string[] }> }> }

const VALIDATORS = 'packages/shared/src/validators.ts';
const BARREL = 'packages/shared/src/index.ts';

test.describe.serial('Import accuracy', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;

  const deps = async (rel: string) =>
    (await (await h.client.raw('GET', `/api/dependencies/file?path=${encodeURIComponent(path.join(root, rel))}`)).json()) as Deps;
  const footprint = async (paths: string[], symbols?: string[]) =>
    JSON.parse((await agent.callTool('check_footprint', { paths, ...(symbols ? { symbols } : {}) })).text) as Footprint;

  test.beforeAll(async () => {
    h = await setupHarness('import-accuracy');
    root = h.fixture.projectPath;
    // A Python import written with an alias, as real code often is.
    const orders = path.join(root, 'services/api/app/routes/orders.py');
    fs.writeFileSync(orders, fs.readFileSync(orders, 'utf-8').replace('from app.db import add_order, list_orders', 'from app.db import add_order as insert_order, list_orders'));
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
  });

  test.afterAll(async () => { await h?.teardown(); });

  test("the shared package's barrel is recorded: its re-exports are imports that pass names on", async () => {
    const barrel = await deps(BARREL);
    expect(barrel.imports.filter((d) => d.reexport).map((d) => d.relativePath).sort())
      .toEqual(['packages/shared/src/types.ts', VALIDATORS]);
    const v = await deps(VALIDATORS);
    expect(v.importedBy.map((d) => [d.relativePath, d.reexport ?? false])).toContainEqual([BARREL, true]);
  });

  test('the components that use validators through the barrel are named, and the types-only importer is not', async () => {
    const through = (await deps(VALIDATORS)).throughReexports;
    expect(through.map((d) => `${d.relativePath}: ${d.specifiers.join(',')} via ${d.via!.join(' → ')}`).sort()).toEqual([
      `packages/web/src/OrderList.tsx: validateCreateOrder via ${BARREL}`,
      `packages/web/src/UserList.tsx: validateCreateUser via ${BARREL}`,
    ]);
    expect(through.some((d) => d.relativePath === 'packages/web/src/api.ts')).toBe(false);
  });

  test('check_footprint finds them through the barrel, and narrows by name', async () => {
    const all = (await footprint([VALIDATORS])).paths[0];
    expect(all.imported_by.sort()).toEqual(['packages/web/src/OrderList.tsx', 'packages/web/src/UserList.tsx']);
    const one = (await footprint([VALIDATORS], ['validateCreateUser'])).paths[0];
    expect(one.importers).toEqual([{ path: 'packages/web/src/UserList.tsx', names: ['validateCreateUser'], possibly: false, via: [BARREL] }]);
  });

  test('a Python import written with an alias is found by the name it imports', async () => {
    const byName = (await footprint(['services/api/app/db.py'], ['add_order'])).paths[0];
    expect(byName.importers.map((i) => [i.path, i.names])).toEqual([['services/api/app/routes/orders.py', ['add_order']]]);
    expect((await footprint(['services/api/app/db.py'], ['insert_order'])).paths[0].importers).toEqual([]);
  });
});
