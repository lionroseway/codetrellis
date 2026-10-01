/**
 * Phase 32 D1.5a — test runs travel with the plan.
 *
 * Sam shares task state from his desktop. A CI job clones the repository,
 * starts CodeTrellis headless with `--share-task-state`, changes
 * `validators.ts` and commits it, runs the tests and hands the report over:
 * the run is written once to `.codetrellis/runs/`, naming the commit it ran
 * on, and a newer run replaces the job's older one. `codetrellis commit`
 * commits it. Sam pulls: the pull rewrote `validators.ts`, so by the file's
 * time his own results would read "older than the code", but the job's run
 * was on exactly this commit, and his app says the file's tests pass, in the
 * job's run, unverified until he trusts its key. Sam edits the file: now its
 * tests are older than the code. Off, the job's run is forgotten here.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, findFreePorts, type Harness, type ScriptedAgent } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const CODE = 'packages/shared/src/validators.ts';
const TEST_FILE = 'packages/shared/src/validators.test.ts';
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const junit = (run: number, failing: boolean) => `<testsuites name="ci run ${run}"><testsuite name="shared">
<testcase classname="validators" name="accepts a real email" file="${TEST_FILE}"/>
${failing ? `<testcase classname="validators" name="needs a name" file="${TEST_FILE}"><failure message="expected [] to include 'name is required'"/></testcase>` : `<testcase classname="validators" name="needs a name" file="${TEST_FILE}"/>`}
</testsuite></testsuites>\n`;

interface Grounding { state: string; words: string; testFiles: string[]; from: { who: string; verified: boolean; commit: string | null } | null }

test.describe.serial('Test runs shared through the plans folder', () => {
  test.setTimeout(240_000);
  let sam: Harness;
  let agent: ScriptedAgent;
  let samRepo: string;
  let ciRepo: string;
  let ciEnv: Record<string, string>;
  let ciCommit: string;
  const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: GIT_ENV }).trim();
  const ci = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd: ciRepo, env: ciEnv, encoding: 'utf8', timeout: 180_000 });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const runsIn = (repo: string) => {
    const dir = path.join(repo, '.codetrellis', 'runs');
    return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  };
  const grounding = async () => (await (await sam.client.raw('GET', `/api/tests/grounding?project=${encodeURIComponent(samRepo)}&path=${encodeURIComponent(CODE)}`)).json()) as Grounding;

  test.beforeAll(async () => {
    sam = await setupHarness('shared-test-runs', { settings: { identity: { displayName: 'Sam Lee', email: 'sam@acme.test' } } });
    samRepo = sam.fixture.projectPath;
    fs.writeFileSync(path.join(samRepo, TEST_FILE), `import { validateCreateUser, isValidEmail } from './validators';\nexport const cases = [validateCreateUser, isValidEmail];\n`);
    git(samRepo, 'add', '-A');
    git(samRepo, 'commit', '-qm', 'A test for the validators');
    await sam.client.scanProject(samRepo);
    const on = await sam.client.raw('PUT', `/api/shared-task-state?project=${encodeURIComponent(samRepo)}`, { enabled: true });
    expect(on.status, await on.clone().text()).toBe(200);
    agent = await sam.spawnAgent({ agentType: 'claude-code' });

    // The job's machine: its own clone, cache and ports; the CLI on its PATH.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ci-'));
    ciRepo = path.join(home, 'work', 'sample-app');
    execFileSync('git', ['clone', '-q', samRepo, ciRepo], { env: GIT_ENV, stdio: 'ignore' });
    git(ciRepo, 'config', 'user.name', 'Build bot');
    git(ciRepo, 'config', 'user.email', 'ci@acme.test');
    const [port, mcpPort] = await findFreePorts(2);
    ciEnv = {
      ...(process.env as Record<string, string>), HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), CODETRELLIS_DATA_DIR: '',
      CODETRELLIS_CLAUDE_DIR: path.join(home, '.claude'), CODETRELLIS_BACKEND_PORT: String(port), CODETRELLIS_MCP_PORT: String(mcpPort),
      CODETRELLIS_AGENT: 'ci', CLAUDECODE: '', GITHUB_BASE_REF: '',
    };
  });
  test.afterAll(async () => {
    if (ciRepo) ci('stop');
    await sam?.teardown();
  });

  test('the job shares its runs: each written once, naming its commit, the newest replacing the job\'s older', async () => {
    const started = ci('start', '--share-task-state', '--quiet');
    expect(started.code, started.err).toBe(0);
    // The job's own work: a code change, committed as it would be.
    fs.appendFileSync(path.join(ciRepo, CODE), '\nexport const ALLOW_PLUS_ADDRESSES = true;\n');
    git(ciRepo, 'commit', '-qam', 'Allow plus addresses');
    ciCommit = git(ciRepo, 'rev-parse', 'HEAD');

    fs.mkdirSync(path.join(ciRepo, 'reports'));
    fs.writeFileSync(path.join(ciRepo, 'reports', 'unit.xml'), junit(1, true));
    let r = ci('report-tests', 'reports/unit.xml');
    expect(r.code, r.err).toBe(0);
    const first = runsIn(ciRepo);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(/^[a-f0-9]{8,32}-1\.yaml$/);
    const text = fs.readFileSync(path.join(ciRepo, '.codetrellis', 'runs', first[0]), 'utf8');
    expect(text).toMatch(/^# CodeTrellis: one device's latest test run/);
    expect(text).toContain(`commit: ${ciCommit}`);
    expect(text).toContain('name: Build bot');
    expect(text).toContain('author: ci');
    expect(text).toContain(`file: ${TEST_FILE}`);
    expect(text).toContain("why: expected [] to include 'name is required'");

    fs.writeFileSync(path.join(ciRepo, 'reports', 'unit.xml'), junit(2, false));
    r = ci('report-tests', 'reports/unit.xml');
    expect(r.code, r.err).toBe(0);
    expect(runsIn(ciRepo)).toEqual([first[0].replace(/-1\.yaml$/, '-2.yaml')]);

    // `commit` takes the run with the plan's other files, and nothing of the job's.
    const committed = ci('commit', '-m', 'CI: test run');
    expect(committed.code, committed.err + committed.out).toBe(0);
    const files = git(ciRepo, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
    expect(files).toContain(`.codetrellis/runs/${runsIn(ciRepo)[0]}`);
    expect(files.every((f) => f.startsWith('.codetrellis/'))).toBe(true);
    expect(git(ciRepo, 'status', '--porcelain', '--', 'reports')).toBe('?? reports/');
  });

  test('Sam pulls: the file the pull rewrote is grounded by the job\'s run on that commit, unverified', async () => {
    expect((await grounding()).state).toBe('untested');
    git(samRepo, 'pull', '-q', '--no-rebase', '--no-edit', ciRepo, git(ciRepo, 'rev-parse', '--abbrev-ref', 'HEAD'));
    expect(git(samRepo, 'rev-parse', 'HEAD~1')).toBe(ciCommit);
    // The pull wrote the file after the run: by its time on this disk, the run is older.
    const runAt = fs.statSync(path.join(samRepo, CODE)).mtimeMs;
    expect(runAt).toBeGreaterThan(Date.now() - 60_000);

    await expect.poll(async () => (await grounding()).state, { timeout: 15_000 }).toBe('passing');
    const g = await grounding();
    expect(g.words).toBe(`✓ 2 tests passing, in ci for Build bot's run at ${ciCommit.slice(0, 7)}, unverified`);
    expect(g.from).toMatchObject({ who: 'ci for Build bot', verified: false, commit: ciCommit });
    expect(g.testFiles).toEqual([TEST_FILE]);

    const tests = (await (await sam.client.raw('GET', `/api/tests?project=${encodeURIComponent(samRepo)}`)).json()) as { teammates: Array<{ who: string; verified: boolean; says: string }> };
    expect(tests.teammates).toEqual([expect.objectContaining({ who: 'ci for Build bot', verified: false })]);
    expect(tests.teammates[0].says).toMatch(new RegExp(`^ci for Build bot's run at ${ciCommit.slice(0, 7)}: 2 passing \\(unverified: `));

    // An agent on Sam's machine hears the same.
    const a = await agent.callTool('get_test_results', { for_file: CODE });
    expect(a.isError, a.text).toBeFalsy();
    expect(JSON.parse(a.text)).toMatchObject({ state: 'passing', from: { who: 'ci for Build bot', verified: false, commit: ciCommit } });

    const shared = (await (await sam.client.raw('GET', `/api/shared-task-state?project=${encodeURIComponent(samRepo)}`)).json()) as { runs: { teammates: Array<{ who: string }>; says: string } };
    expect(shared.runs.teammates.map((t) => t.who)).toEqual(['ci for Build bot']);
    expect(shared.runs.says).toContain('Runs from ci for Build bot are here.');
  });

  test('Sam changes the file: the job\'s tests are older than the code; turned off, the job\'s run is forgotten', async () => {
    fs.appendFileSync(path.join(samRepo, CODE), '\nexport const STRICT = true;\n');
    await expect.poll(async () => (await grounding()).state, { timeout: 10_000 }).toBe('stale');
    expect((await grounding()).words).toBe(`⚠ tests older than the code: it changed after its 2 tests last ran, in ci for Build bot's run at ${ciCommit.slice(0, 7)}, unverified`);

    const off = await sam.client.raw('PUT', `/api/shared-task-state?project=${encodeURIComponent(samRepo)}`, { enabled: false });
    expect(off.status).toBe(200);
    expect(await grounding()).toMatchObject({ state: 'untested', from: null });
  });

  test('--share-task-state is for a headless backend: the app\'s own data dir keeps its switch in the window', async () => {
    // The desktop app's folder in this home.
    const appDir = path.join(ciEnv.HOME, '.codetrellis');
    const r = spawnSync(process.execPath, [BIN, 'serve', '--share-task-state', '--project', ciRepo, '--data-dir', appDir], {
      cwd: ciRepo, env: ciEnv, encoding: 'utf8', timeout: 60_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--share-task-state is for a headless backend');
    expect(fs.existsSync(appDir)).toBe(false); // refused before anything started
  });
});
