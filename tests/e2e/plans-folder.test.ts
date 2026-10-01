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
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

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
