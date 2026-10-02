/**
 * A second checkout does not take the first one's docs and plans (Phase 32
 * A1.7b, bug 46).
 *
 * Docs and plans live in the repository, so a linked worktree carries the
 * same files with the same uids. Scanning the worktree used to move every
 * system doc to it — the main checkout then listed none — and overwrote each
 * plan with the worktree's copy. Now a row stays with the checkout that holds
 * it while that folder exists; the worktree's different copy is its own
 * change, not an import.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness } from '../harness';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

interface Doc { uid: string; title: string; body: string; projectPath: string }
interface Plan { uid: string; title: string; projectPath: string }

test.describe.serial('Docs and plans across checkouts', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let main: string;
  let wt: string;
  let doc: Doc;
  const PLAN_UID = 'plan-checkout-identity';

  const docs = async (project: string) =>
    (await (await h.client.raw('GET', `/api/system-docs?project=${encodeURIComponent(project)}`)).json()) as Doc[];
  const plan = async () => (await (await h.client.raw('GET', `/api/plans/${PLAN_UID}`)).json()) as Plan;

  test.beforeAll(async () => {
    h = await setupHarness('checkout-identity');
    main = h.fixture.projectPath;
    wt = path.join(h.fixture.tmpDir, 'sample-app-wt');
    await h.client.scanProject(main);

    // A system doc and a plan on main, committed, so every checkout has them.
    const res = await h.client.raw('POST', '/api/system-docs', { projectPath: main, title: 'Auth flow', body: 'Tokens refresh every hour.' });
    expect(res.ok).toBe(true);
    doc = (await res.json()) as Doc;
    const planDir = path.join(main, '.codetrellis', 'plans', 'billing-v2');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, 'plan.yaml'), `uid: ${PLAN_UID}\ntitle: Billing v2\nstatus: active\nversion: 2\n`);
    git(main, 'add', '-A', '.codetrellis');
    git(main, 'commit', '-q', '-m', 'doc and plan');
    await h.client.scanProject(main);
    expect((await plan()).title).toBe('Billing v2');

    // A worktree whose copies differ: its branch is drafting changes to both.
    git(main, 'worktree', 'add', '-q', '-b', 'billing-draft', wt);
    const docFile = fs.readdirSync(path.join(wt, '.codetrellis', 'docs')).find((f) => f.endsWith('.md'))!;
    const docPath = path.join(wt, '.codetrellis', 'docs', docFile);
    fs.writeFileSync(docPath, fs.readFileSync(docPath, 'utf-8').replace('Tokens refresh every hour.', 'Tokens refresh every 5 minutes (draft).'));
    const wtPlan = path.join(wt, '.codetrellis', 'plans', 'billing-v2', 'plan.yaml');
    fs.writeFileSync(wtPlan, fs.readFileSync(wtPlan, 'utf-8').replace('title: Billing v2', 'title: Billing v2 (worktree draft)'));
    // A doc that exists only in the worktree.
    fs.writeFileSync(path.join(wt, '.codetrellis', 'docs', 'only-here.md'), '---\nuid: doc-only-in-worktree\ntitle: Only in the worktree\n---\nNew here.\n');

    await h.client.scanProject(wt);
  });

  test.afterAll(async () => {
    try { git(main, 'worktree', 'remove', '--force', wt); } catch { /* */ }
    await h?.teardown();
  });

  test("the main checkout keeps its doc, with main's text", async () => {
    const list = await docs(main);
    const mine = list.find((d) => d.uid === doc.uid);
    expect(mine, 'before the fix the worktree scan moved it away').toBeTruthy();
    const full = (await (await h.client.raw('GET', `/api/system-docs/${doc.uid}`)).json()) as Doc;
    expect(full.body).toContain('every hour');
    expect(full.body).not.toContain('draft');
  });

  test("the plan keeps main's title, not the worktree's draft", async () => {
    const p = await plan();
    expect(p.title).toBe('Billing v2');
    expect(fs.realpathSync(p.projectPath)).toBe(fs.realpathSync(main));
  });

  test('a doc that exists only in the worktree still imports there', async () => {
    const list = await docs(wt);
    expect(list.map((d) => d.uid)).toContain('doc-only-in-worktree');
    expect(list.map((d) => d.uid)).not.toContain(doc.uid);
  });

  test("the worktree's differing copies are its own changes, which its workstream shows", async () => {
    const res = await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(main)}&idle=1`);
    const ws = (await res.json()) as Array<{ root: string; changes: { files: Array<{ path: string }> } }>;
    const mineWt = ws.find((w) => fs.realpathSync(w.root) === fs.realpathSync(wt))!;
    const files = mineWt.changes.files.map((f) => f.path);
    expect(files).toContain('.codetrellis/plans/billing-v2/plan.yaml');
    expect(files.some((f) => f.startsWith('.codetrellis/docs/'))).toBe(true);
  });
});
