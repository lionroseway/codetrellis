/**
 * Phase 32 D1.4 — sessions and pipelines pick the CLI up.
 *
 * Sam's cloud session runs the SessionStart hook from
 * `docs/recipes/claude-code-settings.json`: it starts CodeTrellis headless
 * for the repository once (a second session finds it running) and hands the
 * agent where the plan stands. `stop` ends it.
 *
 * Then the gate a pipeline runs, `codetrellis check` with no path, over the
 * branch's changes since its base: it passes on a clean change and fails
 * (exit 3), naming why, on each of the four things the plan and the docs
 * say: a breakpoint Sam set on a changed file, that file's tests failing or
 * older than the code, a task marked done whose criterion check fails, and
 * a system doc describing the file that changed after it was verified.
 * Each, put right, passes again. `status` gates the same way.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, findFreePorts, type Harness, type ScriptedAgent } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const SHARED = 'packages/shared/src';
const CODE = `${SHARED}/validators.ts`;
const TEST_FILE = `${SHARED}/validators.test.ts`;
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const junit = (failing: boolean, run: number) => `<testsuites name="run ${run}"><testsuite name="shared">
<testcase classname="validators" name="accepts a real email" file="${TEST_FILE}"/>
${failing ? `<testcase classname="validators" name="needs a name" file="${TEST_FILE}"><failure message="expected [] to include 'name is required'"/></testcase>` : `<testcase classname="validators" name="needs a name" file="${TEST_FILE}"/>`}
</testsuite></testsuites>\n`;

interface Gate { ok: boolean; says: string[]; files: number; base: string | null; breakpoints: unknown[]; tests: Array<{ path: string; state: string }>; criteria: Array<{ task: string }>; docs: Array<{ title: string; files: string[] }> }

test.describe.serial('codetrellis in sessions and pipelines', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  let base: string;
  let plan: string;
  let totals: string;

  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  const ct = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args, '--data-dir', h.fixture.dataDir], {
      cwd: root, env: { ...(process.env as Record<string, string>), ...ENV, CLAUDECODE: '1', CODETRELLIS_AGENT: '', GITHUB_BASE_REF: '' }, encoding: 'utf8', timeout: 120_000,
    });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const gate = () => {
    const r = ct('check', '--base', base, '--json');
    return { code: r.code, g: JSON.parse(r.out || '{}') as Gate, err: r.err };
  };
  const at = (rel: string, when: Date) => fs.utimesSync(path.join(root, rel), when, when);

  test.beforeAll(async () => {
    h = await setupHarness('cli-gate');
    root = h.fixture.projectPath;
    git('config', 'user.name', 'Sam Lee');
    git('config', 'user.email', 'sam@acme.test');
    const old = new Date(Date.now() - 3_600_000);
    fs.writeFileSync(path.join(root, TEST_FILE), `import { validateCreateUser, isValidEmail } from './validators';\nexport const cases = [validateCreateUser, isValidEmail];\n`);
    at(TEST_FILE, old);
    at(CODE, old);
    await h.client.scanProject(root);
    plan = (await h.client.createPlan({ title: 'Exports', projectPath: root })).uid;
    const add = async (title: string) => ((await (await h.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title })).json()) as { uid: string }).uid;
    await add('Write the export endpoint');
    totals = await add('Check the totals');
    await h.client.exportPlan(plan, root);
    git('add', '-A');
    git('commit', '-qm', 'Exports plan, and a test for the validators');
    base = git('rev-parse', '--abbrev-ref', 'HEAD');
    git('checkout', '-qb', 'sam/exports');
    agent = await h.spawnAgent({ agentType: 'claude-code' });
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('the session-start hook starts CodeTrellis once, tells the agent where the plan stands, and stop ends it', async () => {
    const recipe = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/recipes/claude-code-settings.json'), 'utf8')) as { hooks: { SessionStart: Array<{ hooks: Array<{ type: string; command: string }> }> } };
    const command = recipe.hooks.SessionStart[0].hooks[0].command;
    expect(command).toContain('codetrellis start');
    // `codetrellis` on the PATH, as `npm link` puts it there.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hook-'));
    const binDir = path.join(home, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'codetrellis'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
    const [port, mcpPort] = await findFreePorts(2);
    const env = {
      ...(process.env as Record<string, string>), ...ENV, PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), CODETRELLIS_DATA_DIR: '', CODETRELLIS_CLAUDE_DIR: path.join(home, '.claude'),
      CODETRELLIS_BACKEND_PORT: String(port), CODETRELLIS_MCP_PORT: String(mcpPort), CLAUDECODE: '1', GITHUB_BASE_REF: '',
    };
    const hook = () => spawnSync('/bin/sh', ['-c', command], { cwd: root, env, encoding: 'utf8', timeout: 180_000 });
    try {
      const first = hook();
      expect(first.status, first.stderr).toBe(0);
      // What the agent starts with: the plan, from its files, and the work so far.
      expect(first.stdout).toMatch(/^Exports/m);
      expect(first.stdout).toContain('Conforms:');
      const dataDir = fs.readdirSync(path.join(home, '.cache', 'codetrellis')).map((d) => path.join(home, '.cache', 'codetrellis', d))[0];
      const pid = (JSON.parse(fs.readFileSync(path.join(dataDir, 'mcp-endpoint.json'), 'utf8')) as { pid: number }).pid;

      // A second session finds it running: no second backend.
      const again = spawnSync(path.join(binDir, 'codetrellis'), ['start', '--json'], { cwd: root, env, encoding: 'utf8', timeout: 60_000 });
      expect(again.status, again.stderr).toBe(0);
      expect(JSON.parse(again.stdout)).toMatchObject({ state: 'running', pid });
      expect(hook().status).toBe(0);
      expect((JSON.parse(fs.readFileSync(path.join(dataDir, 'mcp-endpoint.json'), 'utf8')) as { pid: number }).pid).toBe(pid);

      const stopped = spawnSync(path.join(binDir, 'codetrellis'), ['stop'], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
      expect(stopped.stdout.trim()).toBe(`Stopped CodeTrellis for ${fs.realpathSync(root)}.`);
      expect(() => process.kill(pid, 0)).toThrow();
      expect(spawnSync(path.join(binDir, 'codetrellis'), ['stop'], { cwd: root, env, encoding: 'utf8' }).stdout.trim()).toBe(`CodeTrellis is not running for ${fs.realpathSync(root)}.`);
    } finally {
      spawnSync(path.join(binDir, 'codetrellis'), ['stop'], { cwd: root, env, encoding: 'utf8' });
    }
  });

  test('nothing changed, then a plain change: it conforms, exit 0', async () => {
    const none = gate();
    expect(none.code, none.err).toBe(0);
    expect(none.g).toMatchObject({ ok: true, files: 0, base });
    fs.appendFileSync(path.join(root, CODE), '\nexport const STRICT_EXPORTS = true;\n');
    git('commit', '-qam', 'Strict exports');
    const text = ct('check', '--base', base);
    expect(text.code, text.err).toBe(0);
    expect(text.out).toBe(`Conforms: 1 changed file since ${base}. No breakpoint holds them, none of their tests fail or are older than the code, no done task fails its checks, and no doc that describes them is stale.`);
  });

  test('a breakpoint Sam set on a changed file fails it, and nothing is held by the check', async () => {
    const set = (await (await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: CODE, note: 'Ask me before changing validation' })).json()) as { breakpoint: { id: string } };
    const r = gate();
    expect(r.code, r.err).toBe(3);
    expect(r.g.ok).toBe(false);
    expect(r.g.says.join('\n')).toContain(`■ ${CODE}:`);
    expect(r.g.says.join('\n')).toContain('“Ask me before changing validation”');
    // An agent asking the tool itself hears the same.
    const direct = await agent.callTool('check_changes', { paths: [CODE] });
    expect(direct.isError, direct.text).toBeFalsy();
    expect(JSON.parse(direct.text)).toMatchObject({ ok: false, says: r.g.says, files: 1 });
    // The gate reads: no decision is waiting on Sam because of it.
    expect(((await (await h.client.raw('GET', '/api/breakpoint-hits')).json()) as { hits: unknown[] }).hits.length).toBe(0);
    await h.client.raw('DELETE', `/api/breakpoints/${set.breakpoint.id}`);
    expect(gate().code).toBe(0);
  });

  test('a system doc describing the file, verified before it changed again, fails it; verified again, it conforms', async () => {
    const doc = (await (await h.client.raw('POST', '/api/system-docs', {
      projectPath: root, title: 'Validation rules', body: 'Emails are checked in `validators.ts`.', references: { files: [CODE] },
    })).json()) as { uid: string };
    expect((await h.client.raw('POST', `/api/system-docs/${doc.uid}/verify`)).status).toBe(200);
    expect(gate().code).toBe(0);
    // The branch changes the file the doc describes, and nobody re-reads the doc.
    fs.appendFileSync(path.join(root, CODE), '\nexport const ALLOW_PLUS_ADDRESSES = true;\n');
    git('commit', '-qam', 'Allow plus addresses');
    const r = gate();
    expect(r.code).toBe(3);
    expect(r.g.docs).toEqual([expect.objectContaining({ title: 'Validation rules', files: [CODE] })]);
    expect(r.g.says.join('\n')).toMatch(/⚠ The system doc "Validation rules" describes packages\/shared\/src\/validators\.ts, which changed after it was verified at [0-9a-f]{7}/);
    expect((await h.client.raw('POST', `/api/system-docs/${doc.uid}/verify`)).status).toBe(200);
    expect(gate().code).toBe(0);
  });

  test('the changed file\'s tests failing, then older than the code, fail it; run again and passing, it conforms', async () => {
    let runs = 0;
    // Each run's report is its own (the same bytes twice are one report).
    const report = async (failing: boolean, when: Date) => {
      fs.writeFileSync(path.join(root, 'reports', 'unit.xml'), junit(failing, ++runs));
      at('reports/unit.xml', when);
      const a = await agent.callTool('report_tests', { path: 'reports/unit.xml' });
      expect(a.isError, a.text).toBeFalsy();
    };
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    await report(true, new Date());
    let r = gate();
    expect(r.code).toBe(3);
    expect(r.g.tests).toEqual(expect.arrayContaining([expect.objectContaining({ path: CODE, state: 'failing' })]));
    expect(r.g.says).toContain(`${CODE}: ✗ 1 of 2 tests failing`);

    await report(false, new Date());
    expect(gate().code).toBe(0);
    // The code changes after the run: its tests no longer speak for it.
    at(CODE, new Date(Date.now() + 10_000));
    r = gate();
    expect(r.code).toBe(3);
    expect(r.g.says.join('\n')).toContain(`${CODE}: ⚠ tests older than the code`);
    await report(false, new Date(Date.now() + 20_000));
    expect(gate().code).toBe(0);
  });

  test('a task marked done whose criterion check fails fails it; reopened, it conforms', async () => {
    const c = (await (await h.client.raw('POST', `/api/items/${totals}/criteria`, { text: 'The totals file is written', kind: 'artefact' })).json()) as { uid?: string; criterion?: { uid: string } };
    expect(c.uid ?? c.criterion?.uid).toBeTruthy();
    expect((await h.client.raw('PUT', `/api/items/${totals}`, { status: 'done' })).status).toBe(200);
    const r = gate();
    expect(r.code).toBe(3);
    expect(r.g.criteria).toEqual([expect.objectContaining({ task: 'Check the totals' })]);
    expect(r.g.says.join('\n')).toContain('✗ "Check the totals" is marked done, but its criterion "The totals file is written" fails');
    expect((await h.client.raw('PUT', `/api/items/${totals}`, { status: 'in_progress' })).status).toBe(200);
    expect(gate().code).toBe(0);
  });

  test('status gates the same way; a base that is not a commit is a usage error', async () => {
    const set = (await (await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: CODE })).json()) as { breakpoint: { id: string } };
    const r = ct('status', '--base', base, '--json');
    expect(r.code, r.err).toBe(3);
    const s = JSON.parse(r.out) as { plans: Array<{ uid: string }>; conformity: Gate };
    expect(s.plans.map((p) => p.uid)).toContain(plan);
    expect(s.conformity).toMatchObject({ ok: false });
    expect(s.conformity.says).toEqual(gate().g.says);
    const text = ct('status', '--base', base);
    expect(text.code).toBe(3);
    expect(text.out).toMatch(new RegExp(`Does not conform \\(\\d+ changed files? since ${base}\\):\\n  ■ ${CODE}: sam@acme.test set a breakpoint on it; ask them before changing it`));
    await h.client.raw('DELETE', `/api/breakpoints/${set.breakpoint.id}`);
    expect(ct('status', '--base', base).code).toBe(0);

    const bad = ct('check', '--base', 'no-such-branch');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('no-such-branch is not a commit in this repository');
  });
});
