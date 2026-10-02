/**
 * Phase 32 E1 — source control with no plan, end to end, and the defect
 * that started Track E.
 *
 * The owner saw it: someone edited, the graph showed changes, the code view
 * showed no diff, and there was no plan. It reproduces three ways, each
 * pinned here as the code view now reads it:
 *
 *  A. an agent edits and commits in the opened checkout: the working tree
 *     is clean, so last commit against working tree is empty, while the
 *     graph's diff against its baseline is not;
 *  B. an agent edits in another worktree: this checkout's copy is
 *     unchanged;
 *  C. the project is a subfolder of its repository: `git show <ref>:<path>`
 *     read the path from the repository's top, found nothing, and the file
 *     read as added wholesale.
 *
 * Each now appears in GET /api/source-control in the group that names the
 * two points, and those two points read differently through /api/file/at.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, startBackend, createClient, type Harness } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };

interface Group { id: string; kind: string; title: string; words: string; before: string; after: string; files: Array<{ path: string; status: string }>; workstream?: { agents: string[] } }
interface SC { git: boolean; branch: string | null; head: { sha: string } | null; groups: Group[]; words: string }

test.describe.serial('Source control with no plan', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let file: string;
  let worktree: string;

  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8' }).trim();
  const q = () => `project=${encodeURIComponent(root)}`;
  const sc = async () => (await (await h.client.raw('GET', `/api/source-control?${q()}`)).json()) as SC;
  const at = async (spec: string, rel: string) =>
    ((await (await h.client.raw('GET', `/api/file/at?${q()}&path=${encodeURIComponent(rel)}&at=${encodeURIComponent(spec)}`)).json()) as { content: string | null }).content;

  test.beforeAll(async () => {
    h = await setupHarness('source-control', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    git(root, 'config', 'user.name', 'Sam Lee');
    git(root, 'config', 'user.email', 'sam@acme.test');
    await h.client.scanProject(root);
    file = git(root, 'ls-files').split('\n').find((f) => /\.(ts|js|py)$/.test(f))!;
  });

  test.afterAll(async () => {
    if (worktree) { try { git(root, 'worktree', 'remove', '--force', worktree); } catch { /* */ } }
    await h?.teardown();
  });

  test('a fresh checkout: nothing has changed, and it says so', async () => {
    const s = await sc();
    expect(s.git).toBe(true);
    expect(s.groups).toEqual([]);
    expect(s.words).toMatch(/^Nothing has changed: this checkout matches its last commit/);
  });

  test('uncommitted edits: changes, staged and untracked, each diffed between its own two points', async () => {
    fs.appendFileSync(path.join(root, file), '\n// edited, not staged\n');
    fs.writeFileSync(path.join(root, 'notes.md'), 'new\n');
    const s = await sc();
    expect(s.groups.map((g) => [g.kind, g.before, g.after, g.files.map((f) => f.path)])).toEqual([
      ['changes', 'index', 'live', [file]],
      ['untracked', 'none', 'live', ['notes.md']],
    ]);
    expect(await at('index', file)).not.toBe(await at('live', file));
    git(root, 'checkout', '--', file);
    fs.rmSync(path.join(root, 'notes.md'));
  });

  test('the defect, A: an agent commits its edit; the code view\'s old comparison is empty, the committed group is not', async () => {
    fs.appendFileSync(path.join(root, file), '\n// an agent\'s committed edit\n');
    git(root, 'commit', '-qam', 'Round refunds half-even');
    // As the code view compared before: its last commit against its working tree.
    expect(await at('commit:HEAD', file)).toBe(await at('live', file));
    // The graph's baseline diff still shows the file…
    await h.client.scanProject(root);
    expect(JSON.stringify(await (await h.client.raw('GET', `/api/diff?${q()}`)).json())).toContain(path.basename(file));
    // …and source control names where its change is, with two sides that differ.
    const g = (await sc()).groups.find((x) => x.kind === 'since-opened')!;
    expect(g.title).toBe('Committed since you opened it');
    expect(g.words).toMatch(/^1 commit since [0-9a-f]{7}, when the graph's baseline was taken$/);
    expect(g.files).toEqual([{ path: file, status: 'modified' }]);
    expect(await at(g.before, file)).not.toBe(await at(g.after, file));
  });

  test('the defect, B: an agent edits in another worktree; this checkout is unchanged, its group is not', async () => {
    worktree = `${root}-billing`;
    git(root, 'worktree', 'add', '-q', worktree, '-b', 'billing-v2');
    fs.appendFileSync(path.join(worktree, file), '\n// edited in the worktree\n');
    await h.client.raw('GET', `/api/workstreams?${q()}`);
    let g: Group | undefined;
    await expect.poll(async () => {
      g = (await sc()).groups.find((x) => x.kind === 'workstream');
      return g?.files.map((f) => f.path) ?? [];
    }, { timeout: 15_000 }).toEqual([file]);
    expect(g!.title).toBe('billing-v2');
    expect(g!.after).toBe(`workstream:${worktree}`);
    expect(g!.words).toBe('A worktree with 1 changed file since it left main');
    // This checkout's own copy has nothing to show.
    expect(await at('commit:HEAD', file)).toBe(await at('live', file));
    // The worktree's copy against where it left main does.
    expect(await at(g!.before, file)).not.toBe(await at(g!.after, file));
  });

  test('refused: no project, and a project that is not open', async () => {
    expect((await h.client.raw('GET', '/api/source-control')).status).toBe(400);
    expect((await h.client.raw('GET', `/api/source-control?project=${encodeURIComponent('/not/opened')}`)).status).toBe(403);
  });
});

test.describe.serial('Source control in a subfolder of its repository (the defect, C)', () => {
  test.setTimeout(120_000);
  test('a file reads at a commit, and only the subfolder\'s own changes are listed', async () => {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sc-sub-'));
    const sub = path.join(top, 'packages', 'api');
    fs.mkdirSync(sub, { recursive: true });
    fs.mkdirSync(path.join(top, 'packages', 'web'), { recursive: true });
    fs.writeFileSync(path.join(sub, 'index.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(top, 'packages', 'web', 'app.ts'), 'export const w = 1;\n');
    const git = (...a: string[]) => execFileSync('git', ['-C', top, ...a], { env: ENV, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'Start');
    fs.appendFileSync(path.join(sub, 'index.ts'), 'export const b = 2;\n');
    fs.appendFileSync(path.join(top, 'packages', 'web', 'app.ts'), 'export const x = 2;\n');

    const b = await startBackend({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sc-sub-data-')) });
    try {
      const c = createClient(b.baseUrl, b.capabilityToken);
      await c.scanProject(sub);
      const q = `project=${encodeURIComponent(sub)}`;
      const head = ((await (await c.raw('GET', `/api/file/at?${q}&path=index.ts&at=commit:HEAD`)).json()) as { content: string | null }).content;
      // Before, null: "added in this range" for a file that was always there.
      expect(head).toBe('export const a = 1;\n');
      const s = (await (await c.raw('GET', `/api/source-control?${q}`)).json()) as SC;
      expect(s.groups.map((g) => [g.kind, g.files.map((f) => f.path)])).toEqual([['changes', ['index.ts']]]);
    } finally {
      await b.stop();
    }
  });
});
