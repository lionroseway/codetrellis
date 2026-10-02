/**
 * Phase 32 C3.4a — a project's plans in a linked plans folder.
 *
 * Dana's team keeps its plans in their own repository, apart from the code.
 * In Settings → Plans folder she names it by its remote, which goes in the
 * project's committed config; the path of her copy does not. Until she links
 * her copy on this device, nothing there is read and a plan cannot be
 * written there. Linked, her plan's files and its task records go to the
 * planning repository, not the code. Sam clones both, his planning copy at
 * another path: his app knows where the plans live from the config, reads
 * nothing until he links his copy, and then has Dana's plan, and his
 * progress reaches her through the planning repository. A folder that is not
 * a copy of the one named is refused, saying why; the person's alone, it is
 * refused from plain HTTP. A folder a sync client carries is named by its
 * place under the provider's root instead.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { tmpDirFor } from '../harness/paths';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (repo: string, ...args: string[]) => String(execFileSync('git', ['-C', repo, ...args], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })).trim();

interface Folder { state: string; named: unknown; linked: { path: string; confirmedBy: string } | null; says: string; imported?: number }
interface Item { uid: string; status: string; progressPercent: number | null }

test.describe.serial('A linked plans folder', () => {
  test.setTimeout(180_000);
  let dana: Harness;
  let sam: Harness;
  let danaCode: string;
  let samCode: string;
  let bare: string;
  let danaPlans: string;
  let samPlans: string;
  let plan: string;
  let task: string;

  const q = (repo: string) => `?project=${encodeURIComponent(repo)}`;
  const folderOf = async (h: Harness, repo: string) => (await (await h.client.raw('GET', `/api/plans-folder?project=${encodeURIComponent(repo)}`)).json()) as Folder;
  const files = (dir: string) => (fs.existsSync(dir) ? (fs.readdirSync(dir, { recursive: true }) as string[]).sort() : []);

  test.beforeAll(async () => {
    dana = await setupHarness('plans-folder-dana', { settings: { identity: { displayName: 'Dana Ortiz', email: 'dana@acme.test' } } });
    sam = await setupHarness('plans-folder-sam', { settings: { identity: { displayName: 'Sam Lee', email: 'sam@acme.test' } } });
    danaCode = dana.fixture.projectPath;
    await dana.client.scanProject(danaCode);

    // The team's planning repository, and Dana's copy of it.
    bare = path.join(dana.fixture.tmpDir, 'acme-plans.git');
    execFileSync('git', ['init', '-q', '--bare', bare], { env: ENV });
    danaPlans = path.join(dana.fixture.tmpDir, 'work', 'acme-plans');
    execFileSync('git', ['clone', '-q', bare, danaPlans], { env: ENV, stdio: 'ignore' });
    fs.writeFileSync(path.join(danaPlans, 'README.md'), 'Acme plans\n');
    git(danaPlans, 'add', '-A');
    git(danaPlans, 'commit', '-q', '-m', 'start');
    git(danaPlans, 'push', '-q', 'origin', 'HEAD');
  });

  test.afterAll(async () => {
    await dana?.teardown();
    await sam?.teardown();
  });

  test('by default the plans live in the project', async () => {
    const f = await folderOf(dana, danaCode);
    expect(f).toMatchObject({ state: 'here', named: null, linked: null });
    expect(f.says).toBe("This project's plans live in the project itself, under .codetrellis/plans.");
  });

  test('named by its remote, the committed config holds no path; unlinked, nothing is written there', async () => {
    const res = await dana.client.raw('PUT', `/api/plans-folder${q(danaCode)}`, { folder: { kind: 'git', remote: bare } });
    expect(res.status, await res.clone().text()).toBe(200);
    const f = (await res.json()) as Folder;
    expect(f.state).toBe('unlinked');
    expect(f.says).toMatch(/^This project's plans live in the planning repository .*acme-plans\. Link your copy of it on this device to see them; until then nothing there is read\.$/);
    const config = JSON.parse(fs.readFileSync(path.join(danaCode, '.codetrellis', 'config.json'), 'utf8')) as { plans: { folder: unknown } };
    expect(config.plans.folder).toEqual({ kind: 'git', remote: bare });
    expect(JSON.stringify(config)).not.toContain(danaPlans);

    plan = (await dana.client.createPlan({ title: 'Q4 board pack', projectPath: danaCode })).uid;
    task = ((await (await dana.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title: 'Write the board report' })).json()) as { uid: string }).uid;
    const exported = await dana.client.raw('POST', `/api/plans/${plan}/export?path=${encodeURIComponent(danaCode)}`);
    expect(exported.status).toBe(400);
    expect(((await exported.json()) as { error: string }).error).toBe(f.says);
    expect(files(path.join(danaCode, '.codetrellis', 'plans'))).toEqual([]);
  });

  test('a folder that is not a copy of the one named is refused, saying why', async () => {
    const other = path.join(dana.fixture.tmpDir, 'work', 'not-plans');
    fs.mkdirSync(other, { recursive: true });
    execFileSync('git', ['init', '-q', other], { env: ENV });
    const res = await dana.client.raw('POST', `/api/plans-folder/link${q(danaCode)}`, { path: other });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/is not the planning repository .*acme-plans: it is not a git repository with a remote\.$/);
    expect((await dana.client.raw('POST', `/api/plans-folder/link${q(danaCode)}`, { path: danaCode })).status).toBe(400);
    expect((await dana.client.raw('POST', `/api/plans-folder/link${q(danaCode)}`, { path: 'relative/path' })).status).toBe(400);
  });

  test('linked, the plan and its records go to the planning repository, not the code', async () => {
    const res = await dana.client.raw('POST', `/api/plans-folder/link${q(danaCode)}`, { path: danaPlans });
    expect(res.status, await res.clone().text()).toBe(200);
    const f = (await res.json()) as Folder;
    expect(f.state).toBe('linked');
    expect(f.linked?.path).toBe(fs.realpathSync(danaPlans));
    expect(f.says).toBe(`This project's plans live in the planning repository ${f.says.match(/repository (\S+)\./)![1]}. On this device that is ${fs.realpathSync(danaPlans)}.`);

    const exported = await dana.client.raw('POST', `/api/plans/${plan}/export?path=${encodeURIComponent(danaCode)}`);
    expect(exported.status, await exported.clone().text()).toBe(200);
    const planDir = ((await exported.json()) as { planDir: string }).planDir;
    expect(planDir.startsWith(fs.realpathSync(danaPlans))).toBe(true);
    expect(fs.existsSync(path.join(planDir, 'plan.yaml'))).toBe(true);
    expect(files(path.join(danaCode, '.codetrellis', 'plans'))).toEqual([]);

    // Task state too, once shared (C3.1): the record lands beside the plan.
    expect((await dana.client.raw('PUT', `/api/shared-task-state${q(danaCode)}`, { enabled: true })).status).toBe(200);
    expect((await dana.client.raw('PUT', `/api/items/${task}`, { status: 'in_progress' })).ok).toBe(true);
    expect(files(path.join(fs.realpathSync(danaPlans), '.codetrellis', 'records', plan, task))).toHaveLength(1);
    expect(fs.existsSync(path.join(danaCode, '.codetrellis', 'records'))).toBe(false);

    git(danaPlans, 'add', '-A');
    git(danaPlans, 'commit', '-q', '-m', 'plan: Q4 board pack');
    git(danaPlans, 'push', '-q', 'origin', 'HEAD');
    git(danaCode, 'add', '.codetrellis/config.json');
    git(danaCode, 'commit', '-q', '-m', 'plans live in acme-plans');
  });

  test('Sam, cloning both, reads nothing until he links his copy at his own path; then he has the plan', async () => {
    samCode = path.join(sam.fixture.tmpDir, 'board-pack');
    execFileSync('git', ['clone', '-q', danaCode, samCode], { env: ENV, stdio: 'ignore' });
    samPlans = path.join(sam.fixture.tmpDir, 'elsewhere', 'my-plans-copy');
    execFileSync('git', ['clone', '-q', `file://${bare}`, samPlans], { env: ENV, stdio: 'ignore' });
    await sam.client.scanProject(samCode);

    expect((await folderOf(sam, samCode)).state).toBe('unlinked');
    expect((await (await sam.client.raw('GET', `/api/plans/discover?project=${encodeURIComponent(samCode)}`)).json())).toEqual([]);
    expect((await sam.client.raw('GET', `/api/plans/${plan}`)).status).toBe(404);

    const res = await sam.client.raw('POST', `/api/plans-folder/link${q(samCode)}`, { path: samPlans });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()) as Folder).toMatchObject({ state: 'linked', imported: 1 });
    const got = (await (await sam.client.raw('GET', `/api/plans/${plan}`)).json()) as { title: string; projectPath: string };
    expect(got).toMatchObject({ title: 'Q4 board pack', projectPath: samCode });
  });

  test('Sam\'s progress reaches Dana through the planning repository', async () => {
    expect((await sam.client.raw('PUT', `/api/shared-task-state${q(samCode)}`, { enabled: true })).status).toBe(200);
    expect((await sam.client.raw('PUT', `/api/items/${task}`, { status: 'in_progress', progressPercent: 70 })).ok).toBe(true);
    git(samPlans, 'add', '-A');
    git(samPlans, 'commit', '-q', '-m', 'state: 70');
    git(samPlans, 'push', '-q', 'origin', 'HEAD');
    git(danaPlans, 'pull', '-q', '--no-rebase', '--no-edit', 'origin', git(danaPlans, 'rev-parse', '--abbrev-ref', 'HEAD'));
    await expect.poll(async () => ((await (await dana.client.raw('GET', `/api/items/${task}`)).json()) as Item).progressPercent, { timeout: 15_000 }).toBe(70);
  });

  test('unlinked, his app stops reading there; the plans stay where they are', async () => {
    const res = await sam.client.raw('DELETE', `/api/plans-folder/link${q(samCode)}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Folder).state).toBe('unlinked');
    expect((await (await sam.client.raw('GET', `/api/plans/discover?project=${encodeURIComponent(samCode)}`)).json())).toEqual([]);
    expect(fs.existsSync(path.join(samPlans, '.codetrellis', 'plans'))).toBe(true);
  });

  test('a synced folder is named by its place under the provider\'s root, and matched by it', async () => {
    const res = await sam.client.raw('PUT', `/api/plans-folder${q(samCode)}`, { folder: { kind: 'synced', provider: 'onedrive', place: 'Acme/Board pack' } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as Folder).says).toBe("This project's plans live in OneDrive: Acme/Board pack. Link your copy of it on this device to see them; until then nothing there is read.");
    const right = path.join(sam.fixture.tmpDir, 'OneDrive - Acme', 'Acme', 'Board pack');
    const wrong = path.join(sam.fixture.tmpDir, 'OneDrive - Acme', 'Acme', 'Other');
    fs.mkdirSync(right, { recursive: true });
    fs.mkdirSync(wrong, { recursive: true });
    const refused = await sam.client.raw('POST', `/api/plans-folder/link${q(samCode)}`, { path: wrong });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe(`${wrong} is not OneDrive: Acme/Board pack: it is not a folder named Acme/Board pack.`);
    const ok = await sam.client.raw('POST', `/api/plans-folder/link${q(samCode)}`, { path: right });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(((await ok.json()) as Folder).state).toBe('linked');
    // A place that climbs out of the root, or credentials in a remote, are not kept.
    expect((await sam.client.raw('PUT', `/api/plans-folder${q(samCode)}`, { folder: { kind: 'synced', provider: 'onedrive', place: '../secrets' } })).status).toBe(400);
    expect((await sam.client.raw('PUT', `/api/plans-folder${q(samCode)}`, { folder: { kind: 'git', remote: 'https://sam:hunter2@github.com/acme/plans' } })).status).toBe(400);
    // Cleared, the plans are the project's again.
    const cleared = await sam.client.raw('PUT', `/api/plans-folder${q(samCode)}`, { folder: null });
    expect(((await cleared.json()) as Folder).state).toBe('here');
  });
});

test.describe.serial('Only the person chooses where plans live', () => {
  test.setTimeout(90_000);
  let h: Harness;

  test.beforeAll(async () => {
    h = await setupHarness('plans-folder-grant', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
    await h.client.scanProject(h.fixture.projectPath);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('from plain HTTP, naming a folder and linking one are refused with where to do it; unlinking is not', async () => {
    const root = encodeURIComponent(h.fixture.projectPath);
    const named = await h.client.raw('PUT', `/api/plans-folder?project=${root}`, { folder: { kind: 'git', remote: 'git@github.com:acme/plans.git' } });
    expect(named.status).toBe(403);
    expect(((await named.json()) as { error: string }).error).toBe("Only you can choose where this project's plans live — in the CodeTrellis app, Settings → Plans folder.");
    const linked = await h.client.raw('POST', `/api/plans-folder/link?project=${root}`, { path: h.fixture.tmpDir });
    expect(linked.status).toBe(403);
    expect(((await linked.json()) as { error: string }).error).toBe('Only you can link a plans folder on this device — in the CodeTrellis app, Settings → Plans folder.');
    expect((await h.client.raw('DELETE', `/api/plans-folder/link?project=${root}`)).status).toBe(200);
  });
});

/**
 * C3.4b — OneDrive and SharePoint, and files still in the cloud.
 *
 * Dana's team keeps its plans in OneDrive, under "Acme/Board pack". Her app
 * finds her OneDrive folder where the client put it and offers her copy of
 * the place to link. Files the client has not brought down (placeholders: a
 * file with a size and nothing on disk) are never opened: a task file is
 * skipped and its task kept as it was, a teammate's record waits, and a
 * material is not hashed, each saying it is not on this device. Settings
 * counts them and says how to keep the folder on this device.
 */
test.describe.serial('OneDrive and files still in the cloud', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let code: string;
  let oneDrive: string;
  let place: string;
  let plan: string;
  let items: string[];
  const q = () => `?project=${encodeURIComponent(code)}`;
  /** What a sync client leaves for a file it has not downloaded: its size, and no blocks on disk. */
  const toPlaceholder = (file: string) => {
    const size = Math.max(fs.statSync(file).size, 1);
    fs.rmSync(file);
    const fd = fs.openSync(file, 'w');
    fs.ftruncateSync(fd, size);
    fs.closeSync(fd);
    const st = fs.statSync(file);
    expect({ size: st.size > 0, blocks: st.blocks }).toEqual({ size: true, blocks: 0 });
  };

  test.beforeAll(async () => {
    oneDrive = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'OneDrive - Acme '));
    place = path.join(oneDrive, 'Acme', 'Board pack');
    fs.mkdirSync(place, { recursive: true });
    // The project itself is kept in SharePoint too, as a business team's is:
    // its materials can be placeholders.
    const sharePoint = tmpDirFor('plans-folder-onedrive');
    h = await setupHarness('plans-folder-onedrive', {
      env: { CODETRELLIS_CLOUD_ROOTS: JSON.stringify([{ provider: 'onedrive', path: oneDrive, account: 'Acme' }, { provider: 'sharepoint', path: sharePoint, account: 'Acme' }]) },
      settings: { identity: { displayName: 'Dana Ortiz', email: 'dana@acme.test' } },
    });
    code = h.fixture.projectPath;
    await h.client.scanProject(code);
  });
  test.afterAll(async () => {
    await h?.teardown();
    fs.rmSync(oneDrive, { recursive: true, force: true });
  });

  test('her OneDrive folder is found where the client put it, and her copy of the place offered', async () => {
    const res = await h.client.raw('PUT', `/api/plans-folder${q()}`, { folder: { kind: 'synced', provider: 'onedrive', place: 'Acme/Board pack' } });
    expect(res.status, await res.clone().text()).toBe(200);
    const f = (await res.json()) as { state: string; roots: Array<{ provider: string; path: string; account: string }>; found: string | null };
    expect(f.state).toBe('unlinked');
    expect(f.roots[0]).toEqual({ provider: 'onedrive', path: oneDrive, account: 'Acme' });
    expect(f.roots.map((r) => r.provider)).toEqual(['onedrive', 'sharepoint']);
    expect(f.found).toBe(place);
    const linked = await h.client.raw('POST', `/api/plans-folder/link${q()}`, { path: f.found });
    expect(((await linked.json()) as { state: string }).state).toBe('linked');
  });

  test('a task file still in the cloud is skipped, never opened, and its task kept as it was', async () => {
    plan = (await h.client.createPlan({ title: 'Q4 board pack', projectPath: code })).uid;
    items = [];
    for (const title of ['Write the board report', 'Check the figures']) {
      items.push(((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title })).json()) as { uid: string }).uid);
    }
    const planDir = (await h.client.exportPlan(plan, code)).planDir;
    expect(planDir.startsWith(place)).toBe(true);
    const itemFile = (fs.readdirSync(path.join(planDir, 'items'), { recursive: true }) as string[])
      .map((f) => path.join(planDir, 'items', f))
      .find((f) => f.endsWith('.yaml') && fs.readFileSync(f, 'utf8').includes(items[1]))!;
    toPlaceholder(itemFile);

    const res = await h.client.raw('POST', '/api/plans/import', { planDir });
    expect(res.status, await res.clone().text()).toBe(200);
    const { warnings } = (await res.json()) as { warnings: string[] };
    expect(warnings).toContain(`${path.relative(planDir, itemFile)} is not on this device`);
    const kept = (await (await h.client.raw('GET', `/api/items/${items[1]}`)).json()) as { title: string };
    expect(kept.title).toBe('Check the figures');
    // Nor is it written over or deleted, even when the task is renamed and
    // its file would move: the copy in the cloud may be a teammate's newer one.
    expect((await h.client.raw('PUT', `/api/items/${items[1]}`, { body: 'Tie each figure to the ledger.' })).ok).toBe(true);
    expect((await h.client.raw('POST', `/api/plans/${plan}/export?path=${encodeURIComponent(code)}`)).status).toBe(200);
    expect(fs.statSync(itemFile).blocks).toBe(0);
    expect((await h.client.raw('PUT', `/api/items/${items[1]}`, { title: 'Check the figures twice' })).ok).toBe(true);
    expect((await h.client.raw('POST', `/api/plans/${plan}/export?path=${encodeURIComponent(code)}`)).status).toBe(200);
    expect(fs.statSync(itemFile).blocks).toBe(0);
  });

  test('a plan whose plan.yaml is still in the cloud is not found, and an import of it says why', async () => {
    const other = (await h.client.createPlan({ title: 'Q1 planning', projectPath: code })).uid;
    const dir = (await h.client.exportPlan(other, code)).planDir;
    toPlaceholder(path.join(dir, 'plan.yaml'));
    const found = (await (await h.client.raw('GET', `/api/plans/discover${q()}`)).json()) as string[];
    expect(found.map((d) => path.basename(d))).not.toContain(path.basename(dir));
    const res = await h.client.raw('POST', '/api/plans/import', { planDir: dir });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('plan.yaml is not on this device: it is still only in the cloud');
  });

  test('a teammate\'s record still in the cloud waits; Settings counts what is not on this device', async () => {
    expect((await h.client.raw('PUT', `/api/shared-task-state${q()}`, { enabled: true })).status).toBe(200);
    expect((await h.client.raw('PUT', `/api/items/${items[0]}`, { status: 'in_progress' })).ok).toBe(true);
    const folder = path.join(place, '.codetrellis', 'records', plan, items[0]);
    const mine = fs.readdirSync(folder)[0];
    const theirs = path.join(folder, `aaaaaaaa11112222-1.yaml`);
    fs.writeFileSync(theirs, fs.readFileSync(path.join(folder, mine), 'utf8').replace(/writer: \w+/, 'writer: aaaaaaaa11112222').replace('status: in_progress', 'status: done'));
    toPlaceholder(theirs);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(((await (await h.client.raw('GET', `/api/items/${items[0]}`)).json()) as { status: string }).status).toBe('in_progress');

    const f = (await (await h.client.raw('GET', `/api/plans-folder?project=${encodeURIComponent(code)}`)).json()) as { notOnDevice: number; says: string };
    expect(f.notOnDevice).toBe(3);
    expect(f.says).toBe(`This project's plans live in OneDrive: Acme/Board pack. On this device that is ${place}. 3 files in it are not on this device yet and are not read until they are: set the folder to "Always keep on this device" in OneDrive.`);
  });

  test('a material still in the cloud is not hashed: recording it says why', async () => {
    const pdf = path.join(code, 'docs', 'sales-2026.pdf');
    fs.mkdirSync(path.dirname(pdf), { recursive: true });
    fs.writeFileSync(pdf, '%PDF-1.4 sales');
    toPlaceholder(pdf);
    const res = await h.client.raw('POST', `/api/items/${items[0]}/artefacts`, { path: 'docs/sales-2026.pdf', role: 'material' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('docs/sales-2026.pdf is not on this device: it is still only in the cloud. Make it available on this device, then record it.');
    fs.rmSync(pdf);
  });
});

/**
 * C3.4c — materials by their place in the plans folder, and their hash.
 *
 * Dana's team keeps the sales export in its OneDrive folder, beside the
 * plans. Two tasks rely on it. Recorded from Dana's copy, it is stored by its
 * place there, `plans://Materials/sales.csv`, never her path. Sam's copy of
 * the folder sits somewhere else: his app reads the same material at his own
 * path, with the same hash, and when the file is replaced, one signal names
 * both tasks that read it.
 */
test.describe.serial('Materials in the plans folder', () => {
  test.setTimeout(180_000);
  const people: Record<'dana' | 'sam', { h: Harness; code: string; root: string; place: string }> = {} as never;
  let plan: string;
  const items: Record<string, string> = {};
  const PLACE = 'Acme/Board pack';
  const q = (code: string) => `?project=${encodeURIComponent(code)}`;

  const setUp = async (who: 'dana' | 'sam', name: string) => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `OneDrive - Acme ${who} `));
    const h = await setupHarness(`plans-folder-materials-${who}`, {
      env: { CODETRELLIS_CLOUD_ROOTS: JSON.stringify([{ provider: 'onedrive', path: root, account: 'Acme' }]) },
      settings: { identity: { displayName: name, email: `${who}@acme.test` } },
    });
    const code = h.fixture.projectPath;
    await h.client.scanProject(code);
    const place = path.join(root, ...PLACE.split('/'));
    fs.mkdirSync(place, { recursive: true });
    people[who] = { h, code, root, place };
  };
  const link = async (who: 'dana' | 'sam') => {
    const { h, code, place } = people[who];
    expect((await h.client.raw('PUT', `/api/plans-folder${q(code)}`, { folder: { kind: 'synced', provider: 'onedrive', place: PLACE } })).status).toBe(200);
    const res = await h.client.raw('POST', `/api/plans-folder/link${q(code)}`, { path: place });
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as { imported?: number };
  };

  test.beforeAll(async () => {
    await setUp('dana', 'Dana Ortiz');
    await setUp('sam', 'Sam Lee');
  });
  test.afterAll(async () => {
    for (const p of Object.values(people)) {
      await p.h.teardown();
      fs.rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('recorded from Dana\'s copy, the material is stored by its place in the folder, never her path', async () => {
    const { h, code, place } = people.dana;
    await link('dana');
    fs.mkdirSync(path.join(place, 'Materials'), { recursive: true });
    fs.writeFileSync(path.join(place, 'Materials', 'sales.csv'), 'region,q3\nEMEA,120\n');
    plan = (await h.client.createPlan({ title: 'Quarter close', projectPath: code })).uid;
    for (const title of ['Q3 report', 'Board pack']) {
      items[title] = ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title })).json()) as { uid: string }).uid;
      const res = await h.client.raw('POST', `/api/items/${items[title]}/artefacts`, { path: path.join(place, 'Materials', 'sales.csv'), role: 'material' });
      expect(res.status, await res.clone().text()).toBe(201);
      expect((await res.json()) as { path: string }).toMatchObject({ path: 'plans://Materials/sales.csv' });
    }
    const planDir = (await h.client.exportPlan(plan, code)).planDir;
    const files = (fs.readdirSync(planDir, { recursive: true }) as string[]).map((f) => path.join(planDir, f)).filter((f) => f.endsWith('.yaml'));
    const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(text).toContain('plans://Materials/sales.csv');
    expect(text).not.toContain(people.dana.root);
  });

  test('a place that climbs out of the folder is refused', async () => {
    const { h } = people.dana;
    const res = await h.client.raw('POST', `/api/items/${items['Q3 report']}/artefacts`, { path: 'plans://../secrets.csv', role: 'material' });
    expect(res.status).toBe(400);
  });

  test('Sam\'s copy sits elsewhere: his app reads the same material at his path, with the same hash', async () => {
    // The sync client brings Dana's folder to Sam's machine.
    fs.cpSync(people.dana.place, people.sam.place, { recursive: true });
    expect((await link('sam')).imported).toBe(1);
    const { h } = people.sam;
    const theirs = (await (await people.dana.h.client.raw('GET', `/api/items/${items['Q3 report']}/artefacts`)).json()) as Array<{ path: string; sha256: string }>;
    const mine = (await (await h.client.raw('GET', `/api/items/${items['Q3 report']}/artefacts`)).json()) as Array<{ uid: string; path: string; sha256: string }>;
    expect(mine.map((a) => a.path)).toEqual(['plans://Materials/sales.csv']);
    expect(mine[0].sha256).toBe(theirs[0].sha256);
    const agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    expect((await agent.callTool('get_brief', { item_uid: items['Q3 report'] })).isError).toBeFalsy();
    const read = await agent.callTool('read_material', { attachment_uid: mine[0].uid });
    expect(read.isError, read.text).toBeFalsy();
    expect(read.text).toContain('EMEA,120');
  });

  test('both tasks read it; when it is replaced, one signal names both, by its place', async () => {
    const { h, code, place } = people.sam;
    for (const title of ['Q3 report', 'Board pack']) {
      const [a] = (await (await h.client.raw('GET', `/api/items/${items[title]}/artefacts`)).json()) as Array<{ uid: string }>;
      const agent = await h.spawnAgent({ agentType: 'claude-desktop' });
      expect((await agent.callTool('get_brief', { item_uid: items[title] })).isError).toBeFalsy();
      const read = await agent.callTool('read_material', { attachment_uid: a.uid });
      expect(read.isError, read.text).toBeFalsy();
    }
    fs.writeFileSync(path.join(place, 'Materials', 'sales.csv'), 'region,q3\nEMEA,125\n');
    type Signal = { kind: string; workstreams: string[]; subject: Record<string, unknown>; summary: string };
    const signals = async () => ((await (await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(code)}`)).json()) as { signals: Signal[] }).signals.filter((s) => s.subject.material);
    let found: Signal[] = [];
    await expect.poll(async () => (found = await signals()).length, { timeout: 15_000 }).toBe(1);
    expect(found[0]).toMatchObject({ kind: 'stale-base', subject: expect.objectContaining({ material: 'plans://Materials/sales.csv' }) });
    expect(found[0].workstreams).toEqual([`task:${items['Board pack']}`, `task:${items['Q3 report']}`].sort());
  });
});
