/**
 * Phase 33 B2 — grep rules (BUILDING-BLOCKS.md §B2).
 *
 * The team's server logs through one module, and every route authenticates.
 * Neither needs a parser to check: two grep rules say it, set over REST the
 * way the app sets them and committed. The log module already has one
 * `console.log`, which the Rules view counts as breaking it today.
 *
 * A branch adds a second `console.log` above the old one, a test that logs
 * (excepted), and a route without `requireAuth`. The check fails on the new
 * line and on the route, each at its line, and says nothing of the old line,
 * though the edit moved it. With the old line baselined, a branch that
 * removes it is told the count fell.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const SERVER = 'packages/web/src/server/';
const LOG = `${SERVER}log.ts`;
const ROUTES = `${SERVER}routes/`;
const OLD = "console.log('audit', event);";

interface Gate { ok: boolean; says: string[]; notes: string[]; rules: Array<{ path: string; imports: string; rule: string; line?: number | null }> }
interface RuleView { rule: { id: string; kind?: string; must?: boolean }; words: string; breaches: Array<{ from: string; to: string }> | null; breachWords: string }

test.describe.serial('B2: a console.log the change adds is reported at its line, an old one is not; a route without auth is', () => {
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
    h = await setupHarness('grep-rules');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    write(LOG, `export function audit(event: string) {\n  ${OLD}\n}\n`);
    write(`${ROUTES}orders.ts`, "import { requireAuth } from '../auth';\n\nexport const orders = [requireAuth, () => 'orders'];\n");
    write(`${SERVER}auth.ts`, 'export const requireAuth = () => true;\n');
    git('add', '-A');
    git('commit', '-qm', 'The server: a log module and a route');
    await h.client.scanProject(root);
    const rules: Array<[string, Record<string, unknown>]> = [
      ['no-console', { kind: 'grep', in: [SERVER], except: ['**/*.test.ts'], mustNot: { match: 'regex', value: 'console\\.(log|debug)\\(' }, strength: 'block', because: 'The server logs through log.ts, which redacts.', suite: 'hygiene' }],
      ['routes-check-auth', { kind: 'grep', in: [`${ROUTES}*.ts`], must: 'requireAuth', strength: 'block', because: 'Every route authenticates; loopback is no boundary.', suite: 'hygiene' }],
    ];
    for (const [id, body] of rules) {
      const res = await h.client.raw('PUT', `/api/rules/${id}?${q()}`, body);
      expect(res.status, await res.clone().text()).toBe(200);
    }
    const suite = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'hygiene.yaml'), 'utf-8');
    expect(suite).toContain('kind: grep');
    expect(suite).toContain('mustNot: console\\.(log|debug)\\(');
    expect(suite).toContain('match: regex');
    expect(suite).toContain('must: requireAuth');
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rules: server hygiene');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the rules say what they read, and the old console.log is the one line that breaks them today', async () => {
    const rules = await rulesNow();
    const noConsole = rules.find((r) => r.rule.id === 'no-console')!;
    expect(noConsole.rule.kind).toBe('grep');
    expect(noConsole.words).toBe(`no file in ${SERVER} (except **/*.test.ts) may contain a line matching /console\\.(log|debug)\\(/: The server logs through log.ts, which redacts.`);
    expect(noConsole.breaches!.map((b) => `${b.from} ${b.to.replace(/^grep:[0-9a-f]{8}:/, '')}`)).toEqual([`${LOG} +${OLD}`]);
    expect(noConsole.breachWords).toBe('1 line breaks this today');
    const auth = rules.find((r) => r.rule.id === 'routes-check-auth')!;
    expect(auth.rule.must).toBe(true);
    expect(auth.words).toBe(`every file in ${ROUTES}*.ts must contain “requireAuth”: Every route authenticates; loopback is no boundary.`);
    expect(auth.breaches).toEqual([]);
  });

  test('a branch adding a console.log above the old one, a logging test and a route without auth fails on the new line and the route only', async () => {
    git('checkout', '-qb', 'noisy');
    write(LOG, `export function boot() {\n  console.log('booting');\n}\n\nexport function audit(event: string) {\n  ${OLD}\n}\n`);
    write(`${SERVER}log.test.ts`, "console.log('in a test, which the rule excepts');\n");
    write(`${ROUTES}admin.ts`, "export const admin = [() => 'admin'];\n");
    git('add', '-A');
    git('commit', '-qm', 'Boot logging, a test and the admin route');

    const r = ct('check', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(3);
    const g = JSON.parse(r.out) as Gate;
    expect(g.rules.map((x) => `${x.path}:${x.line} ${x.rule} ${x.imports.replace(/^grep:[0-9a-f]{8}:/, '')}`).sort()).toEqual([
      `${LOG}:2 no-console +console.log('booting');`,
      `${ROUTES}admin.ts:1 routes-check-auth -requireAuth`,
    ]);
    expect(g.says).toContain(`✗ ${LOG} now contains “console.log('booting');”, which the rule “no file in ${SERVER} may contain a line matching /console\\.(log|debug)\\(/” forbids: The server logs through log.ts, which redacts.`);
    expect(g.says).toContain(`✗ ${ROUTES}admin.ts now never contains “requireAuth”, which the rule “every file in ${ROUTES}*.ts must contain “requireAuth”” forbids: Every route authenticates; loopback is no boundary.`);
    expect(r.out).not.toContain("'audit'");
  });

  test('baselined like any rule: the old line is written down, and a branch that removes it is told the count fell', async () => {
    git('checkout', '-q', main);
    const wrote = ct('rules', 'baseline');
    expect(wrote.code, wrote.err || wrote.out).toBe(0);
    const baseline = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'baseline.yaml'), 'utf-8');
    expect(baseline).toContain(`${LOG} > grep:`);
    expect(baseline).toContain(OLD);
    git('add', '.codetrellis');
    git('commit', '-qm', 'Baseline: the old audit log line');

    git('checkout', '-qb', 'quiet');
    write(LOG, 'export function audit(event: string) {\n  return event;\n}\n');
    git('add', '-A');
    git('commit', '-qm', 'Audit through the logger');
    const r = ct('check', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(0);
    expect((JSON.parse(r.out) as Gate).notes.join('\n')).toMatch(/↓ no-console: 0 breaches? left, down from 1 in the baseline/);
  });
});
