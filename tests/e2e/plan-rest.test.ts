/**
 * Plan REST routes with no test (Phase 32 §0.4c-1).
 *
 * discover / reconcile / prune-orphans (the Plans panel's disk hygiene),
 * bulk delete, apply-template, import-external, doc search, projection,
 * a single proposed change, and plan history through git.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Plan REST routes', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let q: string;
  let plansDir: string;

  const post = (url: string, body: unknown) => h.client.raw('POST', url, body);
  const get = async (url: string) => {
    const res = await h.client.raw('GET', url);
    expect(res.ok, `${url}: ${res.status}`).toBe(true);
    return res.json();
  };
  const exportPlan = async (uid: string) => {
    const res = await post(`/api/plans/${uid}/export`, { projectRoot: root });
    expect(res.ok, await res.clone().text()).toBe(true);
  };

  test.beforeAll(async () => {
    h = await setupHarness('plan-rest');
    root = h.fixture.projectPath;
    q = encodeURIComponent(root);
    plansDir = path.join(root, '.codetrellis', 'plans');
    await h.client.scanProject(root);
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('discover and reconcile see exported plans, and an orphan once its plan is gone', async () => {
    const live = await h.client.createPlan({ title: 'Live plan', projectPath: root });
    const doomed = await h.client.createPlan({ title: 'Doomed plan', projectPath: root });
    await exportPlan(live.uid);
    await exportPlan(doomed.uid);

    const discovered = (await get(`/api/plans/discover?project=${q}`)) as string[];
    expect(discovered.length).toBe(2);

    // Archive in the DB only, leaving its directory: that is an orphan.
    const del = await h.client.raw('DELETE', `/api/plans/${doomed.uid}?disk=false`);
    expect(del.ok).toBe(true);
    const doomedDir = discovered.find((d) => d.endsWith(doomed.uid.split('-')[0]))!;
    expect(fs.existsSync(doomedDir)).toBe(true);

    const rec = (await get(`/api/plans/reconcile?project=${q}`)) as {
      orphanedOnDisk: Array<{ dirPath: string; title: string | null }>; totalDisk: number; totalDb: number;
    };
    expect(rec.orphanedOnDisk.map((o) => o.dirPath)).toEqual([doomedDir]);
    expect(rec.orphanedOnDisk[0].title).toBe('Doomed plan');
  });

  test('prune-orphans removes only the project\'s current orphans', async () => {
    const rec = (await get(`/api/plans/reconcile?project=${q}`)) as { orphanedOnDisk: Array<{ dirPath: string }> };
    const orphan = rec.orphanedOnDisk[0].dirPath;
    const liveDir = ((await get(`/api/plans/discover?project=${q}`)) as string[]).find((d) => d !== orphan)!;
    const outside = path.join(h.fixture.tmpDir, 'not-a-plan-dir');
    fs.mkdirSync(outside, { recursive: true });

    const res = await post(`/api/plans/prune-orphans?project=${q}`, { dirPaths: [orphan, liveDir, outside, root] });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { removed: number; skipped: string[] };
    expect(body.removed).toBe(1);
    expect(body.skipped.sort()).toEqual([liveDir, outside, root].sort());
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(liveDir)).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(root)).toBe(true);
  });

  test('prune-orphans needs an opened project and a selection', async () => {
    expect((await post('/api/plans/prune-orphans', { dirPaths: ['x'] })).status).toBe(400);
    expect((await post(`/api/plans/prune-orphans?project=${encodeURIComponent(h.fixture.tmpDir)}`, { dirPaths: ['x'] })).status).toBe(403);
    expect((await post(`/api/plans/prune-orphans?project=${q}`, { dirPaths: [] })).status).toBe(400);
  });

  test('bulk-delete archives exactly the named plans', async () => {
    const a = await h.client.createPlan({ title: 'Bulk one', projectPath: root });
    const b = await h.client.createPlan({ title: 'Bulk two', projectPath: root });
    const keep = await h.client.createPlan({ title: 'Stays', projectPath: root });
    const res = await post('/api/plans/bulk-delete', { uids: [a.uid, b.uid] });
    expect(res.ok).toBe(true);
    const listed = ((await get(`/api/plans?projectPath=${q}`)) as Array<{ uid: string }>).map((p) => p.uid);
    expect(listed).not.toContain(a.uid);
    expect(listed).not.toContain(b.uid);
    expect(listed).toContain(keep.uid);
    expect((await post('/api/plans/bulk-delete', { uids: [] })).status).toBe(400);
  });

  test('apply-template seeds an existing plan with the template\'s items', async () => {
    const plan = await h.client.createPlan({ title: 'Seeded', projectPath: root });
    const res = await post(`/api/plans/${plan.uid}/apply-template`, { templateId: 'mass-refactor' });
    expect(res.ok, await res.clone().text()).toBe(true);
    const items = (await get(`/api/plans/${plan.uid}/items`)) as unknown[];
    expect(items.length).toBeGreaterThan(0);
    expect((await post(`/api/plans/${plan.uid}/apply-template`, {})).status).toBe(400);
  });

  test('import-external turns an issue checklist into a plan of Actions', async () => {
    const res = await post('/api/plans/import-external', {
      source: 'github_issue',
      projectPath: root,
      title: 'Harden signup',
      body: 'Some context.\n\n- [ ] Validate email format\n- [ ] Rate-limit signups\n- [x] Write the spec',
    });
    expect(res.ok, await res.clone().text()).toBe(true);
    const out = (await res.json()) as { plan?: { uid: string }; planUid?: string };
    const uid = out.plan?.uid ?? out.planUid!;
    const items = (await get(`/api/plans/${uid}/items`)) as Array<{ title: string; kind: string }>;
    expect(items.filter((i) => i.kind === 'action').map((i) => i.title))
      .toEqual(expect.arrayContaining(['Validate email format', 'Rate-limit signups']));
    expect((await post('/api/plans/import-external', { source: 'fax', projectPath: root })).status).toBe(400);
  });

  test('doc search finds a plan document by its body', async () => {
    const plan = await h.client.createPlan({ title: 'Docs', projectPath: root });
    const doc = await post(`/api/plans/${plan.uid}/docs`, { docType: 'spec', title: 'Rollout', body: 'We use a canary with 5% traffic.' });
    expect(doc.ok).toBe(true);
    const hits = (await get(`/api/plans/${plan.uid}/docs/search?q=canary`)) as Array<{ doc: { title: string }; excerpt: string }>;
    expect(hits.map((d) => d.doc.title)).toContain('Rollout');
    expect(hits[0].excerpt).toContain('canary');
    expect((await get(`/api/plans/${plan.uid}/docs/search?q=nothing-matches-this`)) as unknown[]).toEqual([]);
  });

  test('projection and a single proposed change follow an Action\'s file specs', async () => {
    const plan = await h.client.createPlan({ title: 'Projected', projectPath: root });
    const add = await post(`/api/plans/${plan.uid}/items`, {
      kind: 'action', title: 'New helper',
      fileSpecs: [{ path: 'packages/web/src/helpers.ts', action: 'create' }, { path: 'packages/web/src/api.ts', action: 'modify' }],
    });
    expect(add.ok).toBe(true);

    const proj = (await get(`/api/plans/${plan.uid}/projection`)) as { ghostFiles: Array<{ path: string }>; modifiedFiles: Array<{ path: string }> };
    expect(proj.ghostFiles.map((f) => f.path)).toContain('packages/web/src/helpers.ts');
    expect(proj.modifiedFiles.map((f) => f.path)).toContain('packages/web/src/api.ts');

    const changes = (await get(`/api/plans/${plan.uid}/changes`)) as Array<{ id: string; path?: string }>;
    expect(changes.length).toBeGreaterThanOrEqual(2);
    const one = (await get(`/api/plans/${plan.uid}/changes/${encodeURIComponent(changes[0].id)}`)) as { id: string };
    expect(one.id).toBe(changes[0].id);
    expect((await h.client.raw('GET', `/api/plans/${plan.uid}/changes/no-such-change`)).status).toBe(404);
  });

  test('plan history lists the commits that touched a plan, and searches them', async () => {
    const plan = await h.client.createPlan({ title: 'Versioned', projectPath: root });
    await exportPlan(plan.uid);
    const slug = fs.readdirSync(plansDir).find((d) => d.endsWith(plan.uid.split('-')[0]))!;
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' });
    git('add', path.join('.codetrellis', 'plans', slug));
    git('commit', '-q', '-m', 'plan: add Versioned');

    const hist = (await get(`/api/plan-history/${slug}?project=${q}`)) as { total: number; commits: Array<{ subject?: string; message?: string }> };
    expect(hist.total).toBe(1);
    expect(JSON.stringify(hist.commits[0])).toContain('plan: add Versioned');

    const found = (await get(`/api/plan-history/${slug}/search?project=${q}&q=Versioned`)) as { total: number };
    expect(found.total).toBeGreaterThan(0);
    expect((await h.client.raw('GET', `/api/plan-history/${slug}/search?project=${q}`)).status).toBe(400);
  });
});
