/**
 * The graph, what changed, and plan review from the phone, over the real
 * peer path (Phase 32 §0.4j).
 *
 * The phone's graph and review screens are read-only views of what the
 * desktop computes. So the check is mostly agreement: each method returns
 * what the desktop's own route returns for the same question — and the
 * file reader stays inside the opened projects.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, pairPhone, type Harness, type Phone, type ScriptedAgent } from '../harness';

test.describe.serial('Graph and review from the phone', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let phone: Phone;
  let agent: ScriptedAgent;
  let root: string;
  let planUid: string;
  let checkpoint: number;
  const VALIDATORS = 'packages/shared/src/validators.ts';

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const q = (v: string) => encodeURIComponent(v);

  test.beforeAll(async () => {
    h = await setupHarness('phone-graph-review');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    planUid = (await h.client.createPlan({ title: 'Validators', projectPath: root })).uid;
    await req('POST', `/api/plans/${planUid}/items`, {
      kind: 'action', title: 'Tighten email validation', fileSpecs: [{ path: VALIDATORS, action: 'modify' }],
    });
    const text = (await agent.callTool('capture_checkpoint', { plan_uid: planUid, name: 'Start', project_path: root })).text;
    checkpoint = Number(/snapshot #(\d+)/.exec(text)?.[1]);
    // The planned change, and one nobody asked for.
    fs.appendFileSync(path.join(root, VALIDATORS), '\nexport const STRICT = true;\n');
    fs.appendFileSync(path.join(root, 'packages/shared/src/types.ts'), '\nexport type Unasked = true;\n');
    await h.client.scanProject(root);
    phone = await pairPhone(h.client, { alias: 'Graph phone' });
  });

  test.afterAll(async () => {
    await phone?.close();
    await h?.teardown();
  });

  // ── The graph ────────────────────────────────────────────────────────

  test('graph.overview is the desktop\'s architecture summary', async () => {
    const overview = await phone.rpc('graph.overview');
    const desktop = await req('GET', '/api/architecture-summary');
    const { mostImported: _a, ...rest } = overview;
    const { mostImported: _b, ...desktopRest } = desktop;
    expect(rest).toEqual(desktopRest);
    // Enriched with absolute paths, so the phone can open the file.
    for (const m of overview.mostImported) expect(path.isAbsolute(m.path), m.path).toBe(true);
  });

  test('graph.directory lists one directory\'s files and its subdirectories, not deeper', async () => {
    const shared = await phone.rpc('graph.directory', { dir: 'packages/shared/src' });
    expect(shared.files.map((f: { relativePath: string }) => f.relativePath).sort()).toEqual([
      'packages/shared/src/index.ts', 'packages/shared/src/types.ts', VALIDATORS,
    ]);
    const validators = shared.files.find((f: { relativePath: string }) => f.relativePath === VALIDATORS);
    expect(validators).toMatchObject({ path: path.join(root, VALIDATORS), language: 'typescript' });
    expect(validators.symbolCount).toBeGreaterThanOrEqual(3);

    const packages = await phone.rpc('graph.directory', { dir: 'packages' });
    expect(packages.files).toEqual([]);
    expect(packages.subdirectories.map((d: { name: string }) => d.name).sort()).toEqual(['shared', 'web']);
    expect(await phone.rpcError('graph.directory', {})).toMatch(/dir/);
  });

  test('graph.file: symbols and imports as the desktop has them', async () => {
    const file = path.join(root, VALIDATORS);
    const detail = await phone.rpc('graph.file', { filePath: file });
    expect(detail).toMatchObject({ filePath: file, language: 'typescript' });
    expect(detail.symbols).toEqual(await req('GET', `/api/symbols/file?path=${q(file)}`));
    const deps = await req('GET', `/api/dependencies/file?path=${q(file)}`);
    expect(detail.imports).toEqual(deps.imports);
    expect(detail.importedBy).toEqual(deps.importedBy);
    expect(detail.symbols.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(['isValidEmail', 'validateCreateUser', 'validateCreateOrder']));
  });

  test('graph.fileSource reads a file in an opened project, with its git gutter, and nothing outside one', async () => {
    const file = path.join(root, VALIDATORS);
    const source = await phone.rpc('graph.fileSource', { filePath: file });
    expect(source.content).toBe(fs.readFileSync(file, 'utf-8'));
    expect(source).toMatchObject({ language: 'typescript', truncated: false });
    const lines = source.content.split('\n');
    const strictLine = lines.findIndex((l: string) => l.includes('STRICT'));
    expect(source.lineStatus?.[strictLine], 'the added line is marked in the gutter').toBeTruthy();

    expect(await phone.rpcError('graph.fileSource', { filePath: '/etc/hostname' })).toMatch(/outside every opened project/);
    expect(await phone.rpcError('graph.fileSource', { filePath: `${root}-evil/x.ts` })).toMatch(/outside every opened project/);
    // A link inside the project that points out of it is not a way out.
    fs.symlinkSync('/etc/hostname', path.join(root, 'escape.txt'));
    try {
      expect(await phone.rpcError('graph.fileSource', { filePath: path.join(root, 'escape.txt') })).toMatch(/link|outside|confin/i);
    } finally {
      fs.unlinkSync(path.join(root, 'escape.txt'));
    }
  });

  test('graph.fileSearch finds files by path, and a query is text, not a pattern', async () => {
    const found = await phone.rpc('graph.fileSearch', { query: 'VALIDAT' });
    expect(found).toEqual([{ path: path.join(root, VALIDATORS), relativePath: VALIDATORS, name: 'validators.ts' }]);
    // `%` and `_` are SQL LIKE wildcards. Unescaped, "a%z" matched most paths
    // and "validator_" matched validators.ts; as text, neither is in any path.
    expect(await phone.rpc('graph.fileSearch', { query: 'a%z' })).toEqual([]);
    expect(await phone.rpc('graph.fileSearch', { query: 'validator_' })).toEqual([]);
    // Real underscores are still found.
    expect((await phone.rpc('graph.fileSearch', { query: '__init__' })).map((f: { name: string }) => f.name)).toContain('__init__.py');
    // Matched against the path inside the project, not the machine's.
    expect(await phone.rpc('graph.fileSearch', { query: path.basename(path.dirname(root)) })).toEqual([]);
  });

  test('graph.search is the desktop\'s symbol search', async () => {
    const found = await phone.rpc('graph.search', { query: 'validate' });
    expect(found).toEqual(await req('GET', '/api/symbols/search?q=validate'));
    expect(found.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(['validateCreateUser', 'validateCreateOrder']));
  });

  test('graph.scene: clusters and edges; live marks what changed, planned marks what the plan will touch', async () => {
    const live = await phone.rpc('graph.scene', { mode: 'live' });
    expect(live).toMatchObject({ mode: 'live', granularity: 'cluster', projectPath: root });
    const shared = live.nodes.find((n: { id: string }) => n.id === 'packages/shared');
    expect(shared).toMatchObject({ state: 'changed', fileCount: 3 });
    expect(live.counts).toMatchObject({ nodes: live.nodes.length, edges: live.edges.length });
    expect(live.counts.changed).toBeGreaterThanOrEqual(2);
    for (const e of live.edges) {
      expect(live.nodes.some((n: { id: string }) => n.id === e.source), e.source).toBe(true);
      expect(live.nodes.some((n: { id: string }) => n.id === e.target), e.target).toBe(true);
    }

    const planned = await phone.rpc('graph.scene', { mode: 'planned', planUid, granularity: 'file' });
    expect(planned.granularity).toBe('file');
    expect(planned.nodes.find((n: { id: string }) => n.id === VALIDATORS)?.state).toBe('planned_modify');
    expect(planned.counts.planned).toBe(1);
  });

  test('changes.summary: git\'s view and the architecture diff agree on what changed', async () => {
    const changes = await phone.rpc('changes.summary');
    expect(changes.hasBaseline).toBe(true);
    expect(changes.git.unstagedModified.sort()).toEqual(['packages/shared/src/types.ts', VALIDATORS]);
    // The source files agree. The plan this suite made is shared (the
    // default), so it was written into .codetrellis/plans/ and git sees it
    // as new too — that is how it reaches the team (bug 48, Phase 32 §0.6).
    // This compared the whole list when a REST-made plan stayed in the DB.
    expect(changes.changedFiles.filter((f: string) => !f.startsWith('.codetrellis/')).sort())
      .toEqual(['packages/shared/src/types.ts', VALIDATORS]);
    expect(changes.git.untracked.some((f: string) => f.startsWith('.codetrellis/plans/'))).toBe(true);
    expect(await phone.rpcError('changes.summary', { projectPath: '/etc' })).toMatch(/not|trusted|opened/i);
  });

  test('fs.browse lists folders to open, project-looking ones first, and needs the files capability', async () => {
    const listing = await phone.rpc('fs.browse', { dir: path.dirname(root) });
    expect(listing.path).toBe(path.dirname(root));
    const me = listing.entries.find((e: { path: string }) => e.path === root);
    expect(me).toMatchObject({ name: path.basename(root), isGitRepo: true });
    expect((await phone.rpc('fs.browse', { dir: root })).entries.map((e: { name: string }) => e.name)).toEqual(expect.arrayContaining(['packages', 'services']));
    await phone.grant(['read', 'write', 'project']);
    try {
      expect(await phone.rpcError('fs.browse', { dir: root })).toMatch(/does not hold the "files" capability/);
      expect(await phone.rpcError('graph.fileSource', { filePath: path.join(root, VALIDATORS) })).toMatch(/does not hold the "files" capability/);
    } finally {
      await phone.grant(['read', 'write', 'project', 'files']);
    }
  });

  // ── Review ───────────────────────────────────────────────────────────

  test('review.comparands and review.compare: the desktop\'s points and the desktop\'s answer', async () => {
    const comparands = await phone.rpc('review.comparands', { planUid });
    expect(comparands).toEqual(await req('GET', `/api/comparands?project=${q(root)}`));
    expect(JSON.stringify(comparands)).toContain(`checkpoint:${checkpoint}`);

    const cmp = await phone.rpc('review.compare', { before: `checkpoint:${checkpoint}`, after: 'live' });
    expect(cmp).toEqual(await req('GET', `/api/compare?project=${q(root)}&before=checkpoint:${checkpoint}&after=live`));
    expect(cmp.diff.modifiedFiles.sort()).toEqual(['packages/shared/src/types.ts', VALIDATORS]);
    expect(await phone.rpcError('review.compare', { before: 'checkpoint:99999' })).toMatch(/checkpoint|not found|snapshot/i);
    expect(await phone.rpcError('review.comparands', { planUid: 'no-such-plan' })).toMatch(/not associated|not found/i);
  });

  test('review.get and review.prDraft: the planned change landed, the unasked one is named, as on the desktop', async () => {
    const before = `checkpoint:${checkpoint}`;
    const review = await phone.rpc('review.get', { planUid, before });
    expect(review).toEqual(await req('GET', `/api/plans/${planUid}/review?project=${q(root)}&before=${before}`));
    expect(review.items[0].verdict).toBe('landed');
    expect(review.unclaimedChanges).toEqual(['packages/shared/src/types.ts']);

    const draft = await phone.rpc('review.prDraft', { planUid, before });
    expect(draft).toEqual(await req('GET', `/api/plans/${planUid}/pr-draft?project=${q(root)}&before=${before}`));
    expect(draft.title).toBe('Validators');
    expect(draft.body).toContain('types.ts');
    expect(await phone.rpcError('review.get', { planUid: 'no-such-plan' })).toMatch(/not associated|not found/i);
  });
});
