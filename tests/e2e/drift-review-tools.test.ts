/**
 * Drift and review tools with no test (Phase 32 §0.4h).
 *
 * Deviations (get, reconcile), proposed changes (list, summary, one
 * change), checkpoints and the comparands they become, conflict
 * resolution by side, and searching a plan's git history.
 *
 * Writing it found bug 30: reconcile, over MCP and REST, resolved
 * deviation ids from ANY plan, reported ids that do not exist as
 * resolved, stored whatever action string REST was sent, and credited an
 * accepted deviation's plan change to "codetrellis" rather than whoever
 * accepted it. get_change_status answered "not found" as a success.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

interface Deviation { id: number; planUid: string; deviationType: string; resolution: string; filePath?: string | null; resolvedBy?: string | null; resolvedByType?: string | null }

test.describe.serial('Drift and review tools', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  let planUid: string;
  let otherPlan: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(name, args);
    expect(res.isError, `${name}: ${res.text}`).not.toBe(true);
    return res.text;
  };
  const json = async (name: string, args: Record<string, unknown>) => JSON.parse(await tool(name, args));
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
  }).trim();
  /** A plan whose done Action promised a file that does not exist: one missing_file deviation. */
  const planWithDeviation = async (title: string, file: string) => {
    const uid = (await h.client.createPlan({ title, projectPath: root })).uid;
    await req('POST', `/api/plans/${uid}/items`, {
      kind: 'action', title: `Create ${file}`, status: 'done', fileSpecs: [{ path: file, action: 'create' }],
    });
    const detected = await json('detect_deviations', { plan_uid: uid });
    expect(detected.detected).toBe(1);
    return uid;
  };

  test.beforeAll(async () => {
    h = await setupHarness('drift-review-tools');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    planUid = await planWithDeviation('Drift', 'packages/web/src/cache.ts');
    otherPlan = await planWithDeviation('Other drift', 'packages/web/src/other.ts');
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  // ── Deviations ───────────────────────────────────────────────────────

  test('get_deviations lists the plan\'s own, and matches the REST list', async () => {
    const devs = (await json('get_deviations', { plan_uid: planUid })) as Deviation[];
    expect(devs.map((d) => [d.deviationType, d.resolution])).toEqual([['missing_file', 'pending']]);
    expect(await req('GET', `/api/plans/${planUid}/deviations`)).toEqual(devs);
    expect((await agent.callTool('get_deviations', { plan_uid: 'no-such-plan' })).isError).toBe(true);
  });

  test('reconcile resolves only this plan\'s deviations, and says which (bug 30)', async () => {
    const [mine] = (await json('get_deviations', { plan_uid: planUid })) as Deviation[];
    const [theirs] = (await json('get_deviations', { plan_uid: otherPlan })) as Deviation[];

    // Another plan's deviation, or one that does not exist: refused, nothing changed.
    for (const id of [theirs.id, 999999]) {
      const res = await agent.callTool('reconcile', { plan_uid: planUid, deviations: [{ id, action: 'ignored' }] });
      expect(res.isError, `id ${id}`).toBe(true);
      expect(res.text).toMatch(/not a deviation on this plan/);
    }
    expect(((await json('get_deviations', { plan_uid: otherPlan })) as Deviation[])[0].resolution).toBe('pending');

    const bad = await h.client.raw('POST', `/api/plans/${planUid}/reconcile`, { deviations: [{ id: mine.id, action: 'whatever' }] });
    expect(bad.status).toBe(400);
    const crossPlan = await h.client.raw('POST', `/api/plans/${planUid}/reconcile`, { deviations: [{ id: theirs.id, action: 'ignored' }] });
    expect(crossPlan.status).toBe(400);
    expect(((await json('get_deviations', { plan_uid: otherPlan })) as Deviation[])[0].resolution).toBe('pending');

    // Accepted by the agent: resolved in its name, and the plan change is its too.
    const text = await tool('reconcile', { plan_uid: planUid, deviations: [{ id: mine.id, action: 'accepted' }] });
    expect(text).toMatch(/Resolved 1 deviation/);
    const [resolved] = (await json('get_deviations', { plan_uid: planUid })) as Deviation[];
    expect(resolved).toMatchObject({ resolution: 'accepted', resolvedByType: expect.not.stringMatching(/^(system|human)$/) });
    const items = (await req('GET', `/api/plans/${planUid}/items`)) as Array<{ uid: string; title: string }>;
    const reconciled = items.find((i) => i.title === 'Reconciled changes')!;
    const full = await req('GET', `/api/items/${reconciled.uid}`);
    expect(full.fileSpecs).toEqual([{ path: 'packages/web/src/cache.ts', action: 'modify' }]);
    expect(full.authorType).not.toBe('system');

    // A person ignores the other plan's, over REST: recorded as the local API.
    await req('POST', `/api/plans/${otherPlan}/reconcile`, { deviations: [{ id: theirs.id, action: 'ignored' }] });
    const [ignored] = (await json('get_deviations', { plan_uid: otherPlan })) as Deviation[];
    expect(ignored).toMatchObject({ resolution: 'ignored', resolvedByType: 'unverified' });
  });

  test('detect_deviations refuses a plan that does not exist', async () => {
    const res = await agent.callTool('detect_deviations', { plan_uid: 'no-such-plan' });
    expect(res.isError).toBe(true);
  });

  // ── Proposed changes ─────────────────────────────────────────────────

  test('proposed changes: listed per target, summarised, and one fetched by id', async () => {
    const plan = (await h.client.createPlan({ title: 'Changes', projectPath: root })).uid;
    await req('POST', `/api/plans/${plan}/items`, {
      kind: 'action', title: 'Touch the API', fileSpecs: [
        { path: 'packages/web/src/api.ts', action: 'modify' },
        { path: 'packages/web/src/brand-new.ts', action: 'create' },
      ],
    });
    const changes = (await json('list_proposed_changes', { plan_uid: plan })) as Array<{ id: string; target: string; operation: string; kind: string; driftStatus: string }>;
    expect(changes.map((c) => [c.kind, c.operation, c.target]).sort()).toEqual([
      ['file', 'add', 'packages/web/src/brand-new.ts'],
      ['file', 'modify', 'packages/web/src/api.ts'],
    ]);
    const summary = await json('get_changes_summary', { plan_uid: plan });
    expect(summary.total).toBe(2);
    expect(summary.byKind).toMatchObject({ file: 2 });

    const one = await json('get_change_status', { plan_uid: plan, change_id: changes[0].id });
    expect(one).toMatchObject({ id: changes[0].id, target: changes[0].target });
    const missing = await agent.callTool('get_change_status', { plan_uid: plan, change_id: 'no-such-change' });
    expect(missing.isError).toBe(true);
  });

  // ── Checkpoints and comparands ───────────────────────────────────────

  test('a checkpoint becomes a comparand, and compares against the live tree', async () => {
    const text = await tool('capture_checkpoint', { plan_uid: planUid, name: 'Before the cache', project_path: root });
    const id = Number(/snapshot #(\d+)/.exec(text)?.[1]);
    expect(id).toBeGreaterThan(0);

    const comparands = (await json('list_comparands', { project_path: root })) as Array<{ spec: string; label: string; kind: string }>;
    expect(comparands[0]).toMatchObject({ spec: 'live', kind: 'live' });
    expect(comparands).toContainEqual(expect.objectContaining({ spec: 'baseline', kind: 'baseline' }));
    expect(comparands).toContainEqual(expect.objectContaining({ spec: `checkpoint:${id}`, label: expect.stringContaining('Before the cache') }));
    expect(comparands.some((c) => c.spec.startsWith('commit:'))).toBe(true);

    fs.writeFileSync(path.join(root, 'packages/web/src/cache.ts'), 'export const cache = new Map();\n');
    await expect.poll(async () => {
      const cmp = await agent.callTool('compare_snapshots', { project_path: root, before: `checkpoint:${id}`, after: 'live' });
      return cmp.isError ? [] : JSON.parse(cmp.text).diff.addedFiles as string[];
    }, { timeout: 10_000 }).toContain('packages/web/src/cache.ts');

    expect((await agent.callTool('capture_checkpoint', { plan_uid: 'no-such-plan', name: 'x', project_path: root })).isError).toBe(true);
  });

  // ── Plan history and conflicts ───────────────────────────────────────

  test('search_plan_history finds the commit where a decision was written into the plan', async () => {
    const made = await json('create_plan', { title: 'History', project_path: root });
    await json('add_item', { plan_uid: made.uid, kind: 'object', title: 'Why', body: 'We chose SQLite for the cache.' });
    const slug = fs.readdirSync(path.join(root, '.codetrellis', 'plans')).find((d) => {
      try { return fs.readFileSync(path.join(root, '.codetrellis', 'plans', d, 'plan.yaml'), 'utf-8').includes(made.uid); } catch { return false; }
    })!;
    const planDir = path.join(root, '.codetrellis', 'plans', slug);
    const written = () => (fs.readdirSync(planDir, { recursive: true }) as string[])
      .some((f) => { try { return fs.readFileSync(path.join(planDir, f), 'utf-8').includes('SQLite'); } catch { return false; } });
    await expect.poll(written, { timeout: 5000 }).toBe(true).catch((err) => {
      throw new Error(`${err.message}\nplan files now: ${JSON.stringify(fs.readdirSync(planDir, { recursive: true }))}\n${fs.readFileSync(path.join(planDir, 'plan.yaml'), 'utf-8')}`);
    });
    git('add', '.codetrellis'); git('commit', '-qm', 'Record the cache decision');

    // A second commit that touches the decision.
    const why = ((await (await h.client.raw('GET', `/api/plans/${made.uid}/items`)).json()) as Array<{ uid: string; title: string }>).find((i) => i.title === 'Why')!;
    await json('update_item', { uid: why.uid, body: 'We chose SQLite for the cache; revisit SQLite if we shard.' });
    // Wait for the new text itself, not for any change: the write-through can
    // touch plan.yaml before it rewrites the item, and a commit taken in
    // between records no change to the decision (seen under a full parallel run).
    const revised = () => (fs.readdirSync(planDir, { recursive: true }) as string[])
      .some((f) => { try { return fs.readFileSync(path.join(planDir, f), 'utf-8').includes('revisit SQLite'); } catch { return false; } });
    await expect.poll(revised, { timeout: 5000 }).toBe(true);
    git('add', '.codetrellis'); git('commit', '-qm', 'Note when to revisit');

    const found = await json('search_plan_history', { project_path: root, plan_slug: slug, query: 'sqlite' });
    expect(found.results.map((r: { subject: string }) => r.subject)).toEqual(['Note when to revisit', 'Record the cache decision']);
    for (const r of found.results) {
      expect(r.matchedFiles.length, r.subject).toBeGreaterThan(0);
      expect(r.matchedFiles.every((f: string) => f.includes(`.codetrellis/plans/${slug}/`)), r.subject).toBe(true);
    }
    expect((await json('search_plan_history', { project_path: root, plan_slug: slug, query: 'postgres' })).total).toBe(0);
  });

  test('resolve_conflict takes one side of a conflicted manifest file, and stages it', async () => {
    const rel = '.codetrellis/config.json';
    fs.mkdirSync(path.join(root, '.codetrellis'), { recursive: true });
    fs.writeFileSync(path.join(root, rel), JSON.stringify({ plans: { defaultVisibility: 'local' } }, null, 2) + '\n');
    git('add', rel); git('commit', '-qm', 'config');
    git('checkout', '-qb', 'theirs');
    fs.writeFileSync(path.join(root, rel), JSON.stringify({ plans: { defaultVisibility: 'shared' } }, null, 2) + '\n');
    git('commit', '-qam', 'theirs: shared');
    git('checkout', '-q', 'main');
    fs.writeFileSync(path.join(root, rel), JSON.stringify({ plans: { defaultVisibility: 'private' } }, null, 2) + '\n');
    git('commit', '-qam', 'ours: private');
    try { git('merge', 'theirs'); } catch { /* conflicted, as intended */ }

    const conflicts = await json('detect_conflicts', { project_path: root });
    expect(JSON.stringify(conflicts)).toContain('config.json');

    const missingSide = await agent.callTool('resolve_conflict', { project_path: root, file_path: rel, mode: 'by_side' });
    expect(missingSide.isError).toBe(true);
    expect((await agent.callTool('resolve_conflict', { project_path: root, file_path: '../outside.json', mode: 'by_side', side: 'ours' })).isError).toBe(true);

    expect(await tool('resolve_conflict', { project_path: root, file_path: rel, mode: 'by_side', side: 'theirs' })).toMatch(/Resolved .*theirs/);
    expect(JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8')).plans.defaultVisibility).toBe('shared');
    expect(git('diff', '--name-only', '--diff-filter=U')).toBe('');
    git('commit', '-qm', 'merge theirs');
  });
});
