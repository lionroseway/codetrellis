/**
 * Phase 33 R8 — folder rules (RULES-AND-CLARITY §3.1).
 *
 * The API keeps one service per file, named for its domain, the way this
 * repository keeps src/backend/services/. One rule on main, set over REST:
 * files in packages/api/src/services/ are named *-service.ts and export one
 * thing each, with the judgement half as a guide. An old helpers.ts is there
 * already: the rules view lists it as debt, and editing it does not fail a
 * change.
 *
 * An agent's branch adds payments.ts, and refunds-service.ts exporting two
 * names. The check fails, saying what is wrong with each; the old helper it
 * also touched is not a new finding. The brief of a task in that folder
 * carries the guide.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const DIR = 'packages/api/src/services/';
const GUIDE = 'One service per file, named for its domain; pure helpers go in lib/.';

interface Gate { ok: boolean; rules: Array<{ path: string; imports: string; rule: string; words: string; strength: string }> }
interface RuleView { rule: { id: string; kind?: string; guide?: string }; words: string; breaches: Array<{ from: string; to: string }> | null }

test.describe.serial('R8: services are *-service.ts, one export each', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let root: string;
  let main: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  const ct = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args, '--data-dir', h.fixture.dataDir], {
      cwd: root, env: { ...(process.env as Record<string, string>), ...ENV, CLAUDECODE: '1', CODETRELLIS_AGENT: '', FORCE_COLOR: '', GITHUB_BASE_REF: '' }, encoding: 'utf8', timeout: 120_000,
    });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const q = () => `project=${encodeURIComponent(root)}`;
  const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  const rulesNow = async () => ((await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as { rules: RuleView[] }).rules;

  test.beforeAll(async () => {
    h = await setupHarness('folder-rules');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    write(`${DIR}orders-service.ts`, 'export function listOrders() { return []; }\n');
    write(`${DIR}users-service.ts`, 'export function listUsers() { return []; }\n');
    write(`${DIR}helpers.ts`, 'export const cents = (n: number) => Math.round(n * 100);\nexport const euros = (n: number) => n / 100;\n');
    git('add', '-A');
    git('commit', '-qm', 'The API services');
    await h.client.scanProject(root);
    const res = await h.client.raw('PUT', `/api/rules/services-are-services?${q()}`, {
      kind: 'folder', folder: DIR, files: ['*-service.ts'], exports: 'one', guide: GUIDE, strength: 'block', suite: 'conventions',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const suite = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'conventions.yaml'), 'utf-8');
    expect(suite).toContain('kind: folder');
    expect(suite).toContain(`folder: ${DIR}`);
    expect(suite).toContain(`guide: ${GUIDE}`);
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rule: services are services');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the rule says what the folder\'s files are, with its guide, and lists the old helper as what breaks it today', async () => {
    const rule = (await rulesNow()).find((r) => r.rule.id === 'services-are-services')!;
    expect(rule.rule.kind).toBe('folder');
    expect(rule.rule.guide).toBe(GUIDE);
    expect(rule.words).toBe(`files in ${DIR} are named *-service.ts and export one thing each`);
    expect(rule.breaches).toEqual([{ rule: 'services-are-services', from: `${DIR}helpers.ts`, to: 'folder:is named helpers.ts, not *-service.ts' }]);
  });

  test('a branch adding a misnamed file and a service with two exports fails, saying what is wrong with each; the old helper it edits is not new', async () => {
    git('checkout', '-qb', 'more-services');
    write(`${DIR}payments.ts`, 'export function charge() { return 1; }\n');
    write(`${DIR}refunds-service.ts`, 'export function refund() { return 1; }\nexport function voidRefund() { return 0; }\n');
    fs.appendFileSync(path.join(root, `${DIR}helpers.ts`), '// rounding is half-even\n');
    git('add', '-A');
    git('commit', '-qm', 'Payments and refunds');

    const r = ct('check', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(3);
    const g = JSON.parse(r.out) as Gate;
    expect(g.rules.map((x) => `${x.path}: ${x.imports}`).sort()).toEqual([
      `${DIR}payments.ts: folder:is named payments.ts, not *-service.ts`,
      `${DIR}refunds-service.ts: folder:exports 2 names, not one`,
    ]);
    const text = ct('check', '--base', main);
    expect(text.code).toBe(3);
    expect(text.out).toContain(`      ${DIR}payments.ts:1 is named payments.ts, not *-service.ts`);
    expect(text.out).toContain(`      ${DIR}refunds-service.ts:1 exports 2 names, not one`);
  });

  test('a task working in the folder has the rule in its brief, with its guide', async () => {
    const plan = await h.client.createPlan({ title: 'Billing', projectPath: root });
    const made = await h.client.raw('POST', `/api/plans/${plan.uid}/items`, { kind: 'action', title: 'Add invoices', fileSpecs: [{ path: `${DIR}invoices-service.ts`, action: 'create' }] });
    expect(made.ok, await made.clone().text()).toBe(true);
    const task = (await made.json()) as { uid: string };
    const rules = (await (await h.client.raw('GET', `/api/items/${task.uid}/rules`)).json()) as { in_scope: Array<{ rule: string; guide?: string }> };
    expect(rules.in_scope).toEqual([expect.objectContaining({ rule: 'services-are-services', guide: GUIDE })]);
  });

  test('a folder rule needs a folder and something to say about its files', async () => {
    const bad = await h.client.raw('PUT', `/api/rules/bad?${q()}`, { kind: 'folder', folder: DIR });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/files, kinds or exports/);
  });
});
