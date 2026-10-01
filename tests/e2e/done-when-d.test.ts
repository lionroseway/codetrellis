/**
 * Phase 32 D1.5b — the Track D done-when.
 *
 * A cloud session and a CI job work on Sam's repository with no desktop app,
 * and Sam's desktop, after a pull, shows what they did.
 *
 * The session's SessionStart hook (`docs/recipes/claude-code-settings.json`)
 * starts CodeTrellis headless, sharing task state. Its agent runs only
 * `codetrellis`: `next` names "Write the export endpoint"; it claims it,
 * reports 60% with a note, changes `validators.ts` and commits its code, runs
 * the tests and hands the report over, adds a follow-up task to the plan, and
 * `codetrellis commit` commits CodeTrellis's files. It pushes.
 *
 * Then the CI job (`docs/recipes/github-actions.yml`, its steps run as
 * written) checks the pushed branch: it conforms.
 *
 * Sam pulls. His desktop says the task is in progress at 60%, in the
 * session's record, unverified; the plan has the follow-up; `validators.ts`
 * reads "✓ passing, in claude-code for Build bot's run"; and the plan's
 * commit is authored by the session's git identity, with the agent as
 * co-author.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { setupHarness, findFreePorts, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const CODE = 'packages/shared/src/validators.ts';
const TEST_FILE = 'packages/shared/src/validators.test.ts';
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const JUNIT = `<testsuites name="session run"><testsuite name="shared">
<testcase classname="validators" name="accepts a real email" file="${TEST_FILE}"/>
<testcase classname="validators" name="needs a name" file="${TEST_FILE}"/>
<testcase classname="validators" name="exports are strict" file="${TEST_FILE}"/>
</testsuite></testsuites>\n`;

interface Item { uid: string; title: string; status: string; progressPercent: number | null; parentUid: string | null }

/** A machine with no desktop app: its own home, cache and ports, and `codetrellis` on the PATH. */
async function machine(name: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `ct-${name}-`));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codetrellis'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
  const [port, mcpPort] = await findFreePorts(2);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>), PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), CODETRELLIS_DATA_DIR: '', CODETRELLIS_CLAUDE_DIR: path.join(home, '.claude'),
    CODETRELLIS_BACKEND_PORT: String(port), CODETRELLIS_MCP_PORT: String(mcpPort), GITHUB_BASE_REF: '', CODETRELLIS_AGENT: '',
  };
  return { home, env };
}

test.describe.serial('The Track D done-when: a session and a job with no desktop, seen on the desktop', () => {
  test.setTimeout(300_000);
  let sam: Harness;
  let samRepo: string;
  let remote: string;
  let branch: string;
  let plan: string;
  let write: string;
  let sessionRepo: string;
  let sessionEnv: Record<string, string>;
  const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: GIT_ENV }).trim();
  /** What the session's terminal showed, kept for the journey's picture. */
  const transcript: string[] = [];
  const ct = (...args: string[]) => {
    const r = spawnSync('codetrellis', args, { cwd: sessionRepo, env: sessionEnv, encoding: 'utf8', timeout: 180_000 });
    if (args[0] !== 'stop' && !args.includes('--json')) transcript.push(`$ codetrellis ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`, ...(r.stdout.trim() ? [r.stdout.trim()] : []));
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const items = async () => {
    const r = (await (await sam.client.raw('GET', `/api/plans/${plan}/items`)).json()) as Item[] | { items: Item[] };
    return Array.isArray(r) ? r : r.items;
  };

  test.beforeAll(async () => {
    sam = await setupHarness('done-when-d', { settings: { identity: { displayName: 'Sam Lee', email: 'sam@acme.test' } } });
    samRepo = sam.fixture.projectPath;
    fs.writeFileSync(path.join(samRepo, TEST_FILE), `import { validateCreateUser, isValidEmail } from './validators';\nexport const cases = [validateCreateUser, isValidEmail];\n`);
    await sam.client.scanProject(samRepo);
    const on = await sam.client.raw('PUT', `/api/shared-task-state?project=${encodeURIComponent(samRepo)}`, { enabled: true });
    expect(on.status, await on.clone().text()).toBe(200);
    plan = (await sam.client.createPlan({ title: 'Exports', projectPath: samRepo })).uid;
    const add = async (title: string) => ((await (await sam.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title })).json()) as { uid: string }).uid;
    write = await add('Write the export endpoint');
    await add('Check the totals');
    await sam.client.exportPlan(plan, samRepo);
    git(samRepo, 'add', '-A');
    git(samRepo, 'commit', '-qm', 'Exports plan, and a test for the validators');
    branch = git(samRepo, 'rev-parse', '--abbrev-ref', 'HEAD');
    remote = path.join(sam.fixture.tmpDir, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', remote], { env: GIT_ENV });
    git(samRepo, 'remote', 'add', 'origin', remote);
    git(samRepo, 'push', '-q', 'origin', branch);
  });
  test.afterAll(async () => {
    if (sessionRepo) ct('stop');
    await sam?.teardown();
  });

  test('a cloud session, through the hook and the CLI alone: claims, reports, commits its code, runs its tests, adds to the plan, commits the plan, pushes', async () => {
    const m = await machine('session');
    sessionEnv = { ...m.env, CLAUDECODE: '1' };
    sessionRepo = path.join(m.home, 'work', 'sample-app');
    execFileSync('git', ['clone', '-q', '-b', branch, remote, sessionRepo], { env: GIT_ENV, stdio: 'ignore' });
    git(sessionRepo, 'config', 'user.name', 'Build bot');
    git(sessionRepo, 'config', 'user.email', 'bot@acme.test');

    // The SessionStart hook, as the recipe has it.
    const recipe = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/recipes/claude-code-settings.json'), 'utf8')) as { hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> } };
    const hook = spawnSync('/bin/sh', ['-c', recipe.hooks.SessionStart[0].hooks[0].command], { cwd: sessionRepo, env: sessionEnv, encoding: 'utf8', timeout: 180_000 });
    expect(hook.status, hook.stderr).toBe(0);
    expect(hook.stdout).toMatch(/^Exports — 0 of 2 tasks done/m);
    transcript.push('# SessionStart hook', hook.stdout.trim());

    const next = ct('next');
    expect(next.code, next.err).toBe(0);
    expect(next.out).toContain('Write the export endpoint');
    expect(ct('claim', write.slice(0, 8)).code).toBe(0);
    const progress = ct('update', write.slice(0, 8), '--progress', '60', '--note', 'endpoint drafted');
    expect(progress.code, progress.err).toBe(0);

    // The agent's own work, committed as it would commit it.
    fs.appendFileSync(path.join(sessionRepo, CODE), '\nexport const STRICT_EXPORTS = true;\n');
    git(sessionRepo, 'commit', '-qam', 'Strict exports');
    transcript.push('$ git commit -am "Strict exports"   # the agent\'s own code', '$ npm test   # writes reports/unit.xml');
    fs.mkdirSync(path.join(sessionRepo, 'reports'));
    fs.writeFileSync(path.join(sessionRepo, 'reports', 'unit.xml'), JUNIT);
    const reported = ct('report-tests', 'reports/unit.xml');
    expect(reported.code, reported.err).toBe(0);
    expect(reported.out).toBe('3 tests, none failing.');

    const added = ct('plan', 'add', 'Add', 'the', 'CSV', 'export', '--body', 'Same columns as the screen.');
    expect(added.code, added.err).toBe(0);

    // Its files are written a moment after each change.
    await expect.poll(() => fs.existsSync(path.join(sessionRepo, '.codetrellis', 'runs')) && fs.readdirSync(path.join(sessionRepo, '.codetrellis', 'runs')).length, { timeout: 15_000 }).toBe(1);
    await expect.poll(() => (fs.readdirSync(path.join(sessionRepo, '.codetrellis'), { recursive: true }) as string[])
      .some((f) => f.endsWith('.yaml') && fs.readFileSync(path.join(sessionRepo, '.codetrellis', f), 'utf8').includes('Add the CSV export')), { timeout: 15_000 }).toBe(true);
    const committed = ct('commit');
    expect(committed.code, committed.err + committed.out).toBe(0);
    expect(committed.out).toMatch(/^Committed \d+ CodeTrellis files? as [0-9a-f]{7}: Update the plan: /);
    const files = git(sessionRepo, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
    expect(files.some((f) => f.startsWith(`.codetrellis/records/${plan}/${write}/`))).toBe(true);
    expect(files.some((f) => f.startsWith('.codetrellis/runs/'))).toBe(true);
    expect(files.every((f) => f.startsWith('.codetrellis/'))).toBe(true);
    git(sessionRepo, 'push', '-q', 'origin', branch);
    transcript.push('$ git push');
    fs.mkdirSync(path.join('test-results', 'done-when-d'), { recursive: true });
    fs.writeFileSync(path.join('test-results', 'done-when-d', 'session.txt'), `${transcript.join('\n')}\n`);
  });

  test('the CI job, its recipe run step by step as written, checks the pushed branch: it conforms', async () => {
    const m = await machine('ci');
    const ciRepo = path.join(m.home, 'work', 'sample-app');
    execFileSync('git', ['clone', '-q', '-b', branch, remote, ciRepo], { env: GIT_ENV, stdio: 'ignore' });
    const recipe = parseYaml(fs.readFileSync(path.join(REPO_ROOT, 'docs/recipes/github-actions.yml'), 'utf8')) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string; uses?: string }> }> };
    const steps = Object.values(recipe.jobs)[0].steps;
    const ran: string[] = [];
    for (const step of steps) {
      if (!step.run || step.name === 'Install CodeTrellis') continue; // checkout, setup-node and the install are the runner's
      // The project's own tests, as it runs them: here, the report the session's run wrote.
      const run = step.name === 'Tests'
        ? `mkdir -p test-results && cp "${path.join(sessionRepo, 'reports', 'unit.xml')}" test-results/junit.xml`
        : step.run;
      const r = spawnSync('/bin/sh', ['-ec', run], { cwd: ciRepo, env: m.env, encoding: 'utf8', timeout: 180_000 });
      expect(r.status, `${step.name}: ${r.stderr}${r.stdout}`).toBe(0);
      ran.push(step.name ?? run);
      if (step.name === 'Conformity') expect(r.stdout).toMatch(/^Conforms: /);
    }
    expect(ran).toEqual(['Tests', 'Start CodeTrellis', 'Report the tests', 'Conformity', 'Stop CodeTrellis']);
  });

  test('Sam pulls: his desktop shows the claim and progress, the new task, the tests, and who committed', async () => {
    git(samRepo, 'pull', '-q', '--no-rebase', '--no-edit', 'origin', branch);

    await expect.poll(async () => (await items()).find((i) => i.uid === write)?.progressPercent, { timeout: 20_000 }).toBe(60);
    // What the session said of the task, the desktop says: the same state, from the session's record.
    const there = JSON.parse(ct('status', '--json').out) as { plans: Array<{ uid: string; inProgress: Array<{ uid: string; says: string }> }> };
    const said = there.plans.find((p) => p.uid === plan)!.inProgress.find((w) => w.uid === write)!.says;
    expect((await items()).find((i) => i.uid === write)!.status).toBe('assigned'); // claimed
    const status = (await (await sam.client.raw('GET', `/api/plans/${plan}/status`)).json()) as { items: Array<{ itemUid: string; words: string; recorded: { by: string; byType: string; check?: { verified: boolean } } | null }>; inProgress: Array<{ itemUid: string; words: string }> };
    const line = status.items.find((i) => i.itemUid === write)!;
    expect(line.words).toBe(said);
    expect(status.inProgress.find((w) => w.itemUid === write)?.words).toBe(said);
    expect(line.recorded).toMatchObject({ byType: 'record', check: { verified: false } });

    await expect.poll(async () => (await items()).map((i) => i.title), { timeout: 20_000 }).toContain('Add the CSV export');

    await expect.poll(async () => ((await (await sam.client.raw('GET', `/api/tests/grounding?project=${encodeURIComponent(samRepo)}&path=${encodeURIComponent(CODE)}`)).json()) as { words: string }).words, { timeout: 20_000 })
      .toMatch(/^✓ 3 tests passing, in claude-code for Build bot's run at [0-9a-f]{7}, unverified$/);

    const log = git(samRepo, 'log', '-1', '--format=%an%n%B', '--', '.codetrellis');
    expect(log.split('\n')[0]).toBe('Build bot');
    expect(log).toContain('Update the plan:');
    expect(log).toMatch(/Co-Authored-By: .*claude-code/i);
  });
});
