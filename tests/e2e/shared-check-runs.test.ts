/**
 * Phase 33 C7 — check runs are records that travel.
 *
 * Every check is a run. Sam's own agent checks a change: the run is kept,
 * saying it ran in the agent's session. Sam shares task state. A CI job
 * clones the repository, starts CodeTrellis headless with
 * `--share-task-state`, imports Stripe outside the wrapper and runs
 * `codetrellis check` in GitHub Actions: the check fails, and its run is
 * written once to `.codetrellis/runs/checks/`, saying where it ran, by whom,
 * at which commit, against which base and rulebook, and what it found.
 * `codetrellis commit` commits it. Sam pulls, and his app lists the job's run
 * beside his own, unverified until he trusts its key. Sharing off, the job's
 * run is forgotten here; his own stay.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, findFreePorts, type Harness, type ScriptedAgent } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const WRAPPER = 'packages/web/src/payments.ts';
const API = 'packages/web/src/api.ts';
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface Run {
  id: string; mine: boolean; who: string; verified: boolean; ranIn: string; commit: string | null; base: string | null; rulebook: string | null;
  outcome: { ok: boolean; files: number; blocks: number; warns: number }; says: string[];
  findings: Array<{ rule: string; suite: string; path: string; imports: string; strength: string; failing: boolean; fix: string | null }>; words: string;
}

test.describe.serial('Check runs shared through the plans folder', () => {
  test.setTimeout(240_000);
  let sam: Harness;
  let agent: ScriptedAgent;
  let samRepo: string;
  let mainSha: string;
  let ciRepo: string;
  let ciEnv: Record<string, string>;
  let ciCommit: string;
  const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: GIT_ENV }).trim();
  const ci = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd: ciRepo, env: ciEnv, encoding: 'utf8', timeout: 180_000 });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const checksIn = (repo: string) => {
    const dir = path.join(repo, '.codetrellis', 'runs', 'checks');
    return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  };
  const q = () => `project=${encodeURIComponent(samRepo)}`;
  const runs = async () => {
    const res = await sam.client.raw('GET', `/api/check-runs?${q()}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { runs: Run[] }).runs;
  };

  test.beforeAll(async () => {
    sam = await setupHarness('shared-check-runs', { settings: { identity: { displayName: 'Sam Lee', email: 'sam@acme.test' } } });
    samRepo = sam.fixture.projectPath;
    fs.writeFileSync(path.join(samRepo, WRAPPER), "import Stripe from 'stripe';\nexport const stripe = new Stripe('');\n");
    git(samRepo, 'add', '-A');
    git(samRepo, 'commit', '-qm', 'The payments wrapper');
    await sam.client.scanProject(samRepo);
    const rule = await sam.client.raw('PUT', `/api/rules/stripe-via-wrapper?${q()}`, {
      kind: 'package', package: 'npm:stripe', only: [WRAPPER], strength: 'block', because: 'The wrapper sets idempotency keys.', suite: 'payments',
    });
    expect(rule.status, await rule.clone().text()).toBe(200);
    git(samRepo, 'add', '.codetrellis');
    git(samRepo, 'commit', '-qm', 'Rule: Stripe through the wrapper');
    mainSha = git(samRepo, 'rev-parse', 'HEAD');
    agent = await sam.spawnAgent({ agentType: 'claude-code' });

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ci-'));
    ciRepo = path.join(home, 'work', 'sample-app');
    execFileSync('git', ['clone', '-q', samRepo, ciRepo], { env: GIT_ENV, stdio: 'ignore' });
    git(ciRepo, 'config', 'user.name', 'Build bot');
    git(ciRepo, 'config', 'user.email', 'ci@acme.test');
    const [port, mcpPort] = await findFreePorts(2);
    ciEnv = {
      ...(process.env as Record<string, string>), HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), CODETRELLIS_DATA_DIR: '',
      CODETRELLIS_CLAUDE_DIR: path.join(home, '.claude'), CODETRELLIS_BACKEND_PORT: String(port), CODETRELLIS_MCP_PORT: String(mcpPort),
      CODETRELLIS_AGENT: 'ci', CLAUDECODE: '', GITHUB_BASE_REF: '', FORCE_COLOR: '', GITHUB_ACTIONS: 'true', CI: 'true',
    };
  });
  test.afterAll(async () => {
    if (ciRepo) ci('stop');
    await sam?.teardown();
  });

  test('every check is a run: Sam\'s agent\'s check is kept, saying it ran in its session', async () => {
    const r = await agent.callTool('check_changes', { paths: [API], project_path: samRepo, base: mainSha });
    expect(r.isError, r.text).toBeFalsy();
    const { run: id, ok } = JSON.parse(r.answer) as { run: string; ok: boolean };
    expect(ok).toBe(true);
    const listed = await runs();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id, mine: true, who: 'claude-code', ranIn: 'claude-code\'s session', base: mainSha, rulebook: mainSha, outcome: { ok: true, blocks: 0 } });
    expect(listed[0].words).toBe(`claude-code in claude-code's session at ${mainSha.slice(0, 7)}, against ${mainSha}: ✓ conforms`);
    const one = await sam.client.raw('GET', `/api/check-runs/${encodeURIComponent(id)}?${q()}`);
    expect(one.status).toBe(200);
    expect((await sam.client.raw('GET', `/api/check-runs/no-such-run?${q()}`)).status).toBe(404);
    // Not shared yet: nothing is written to the plans folder.
    expect(checksIn(samRepo)).toEqual([]);
  });

  test('the job\'s check fails, and its run is written once, saying where it ran, by whom and what it found', async () => {
    const on = await sam.client.raw('PUT', `/api/shared-task-state?${q()}`, { enabled: true });
    expect(on.status, await on.clone().text()).toBe(200);
    const started = ci('start', '--share-task-state', '--quiet');
    expect(started.code, started.err).toBe(0);
    const api = path.join(ciRepo, API);
    fs.writeFileSync(api, `import Stripe from 'stripe';\n${fs.readFileSync(api, 'utf-8')}`);
    git(ciRepo, 'commit', '-qam', 'Charge from the API client');
    ciCommit = git(ciRepo, 'rev-parse', 'HEAD');

    const check = ci('check', '--base', mainSha);
    expect(check.code, check.err || check.out).toBe(3);
    expect(check.out).toContain(`${API}:1 imports npm:stripe`);
    const files = checksIn(ciRepo);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{8,32}-1\.yaml$/);
    const text = fs.readFileSync(path.join(ciRepo, '.codetrellis', 'runs', 'checks', files[0]), 'utf8');
    expect(text).toMatch(/^# CodeTrellis: one device's latest check run/);
    expect(text).toContain('ranIn: GitHub Actions');
    expect(text).toContain('name: Build bot');
    expect(text).toContain('author: ci');
    expect(text).toContain(`commit: ${ciCommit}`);
    expect(text).toContain(`rulebook: ${mainSha}`);
    expect(text).toContain('rule: stripe-via-wrapper');

    // A second check replaces the job's first: the folder holds each device's latest.
    expect(ci('check', '--base', mainSha).code).toBe(3);
    expect(checksIn(ciRepo)).toEqual([files[0].replace(/-1\.yaml$/, '-2.yaml')]);

    const committed = ci('commit', '-m', 'CI: check run');
    expect(committed.code, committed.err + committed.out).toBe(0);
    expect(git(ciRepo, 'show', '--name-only', '--format=', 'HEAD').split('\n')).toContain(`.codetrellis/runs/checks/${checksIn(ciRepo)[0]}`);
  });

  test('Sam pulls: the job\'s run is in his app beside his own, saying it ran in GitHub Actions, unverified', async () => {
    git(samRepo, 'pull', '-q', '--no-rebase', '--no-edit', ciRepo, git(ciRepo, 'rev-parse', '--abbrev-ref', 'HEAD'));
    await expect.poll(async () => (await runs()).filter((r) => !r.mine).length, { timeout: 15_000 }).toBe(1);
    const theirs = (await runs()).find((r) => !r.mine)!;
    expect(theirs).toMatchObject({
      who: 'ci for Build bot', verified: false, ranIn: 'GitHub Actions', commit: ciCommit, base: mainSha, rulebook: mainSha,
      outcome: { ok: false, blocks: 1, warns: 0 },
    });
    expect(theirs.findings).toEqual([{
      rule: 'stripe-via-wrapper', suite: 'payments', path: API, imports: 'npm:stripe', strength: 'block', failing: true,
      words: `only ${WRAPPER} may import npm:stripe`, fix: `use ${WRAPPER} instead`,
    }]);
    expect(theirs.words).toMatch(new RegExp(`^ci for Build bot in GitHub Actions at ${ciCommit.slice(0, 7)}, against ${mainSha}: ✗ 1 blocks \\(unverified: `));

    // An agent on Sam's machine hears the same.
    const a = await agent.callTool('list_check_runs', { project_path: samRepo });
    expect(a.isError, a.text).toBeFalsy();
    expect((JSON.parse(a.answer) as { runs: Run[] }).runs.map((r) => r.ranIn)).toEqual(expect.arrayContaining(['GitHub Actions', 'claude-code\'s session']));
  });

  test('sharing off: the job\'s run is forgotten here, Sam\'s own stay', async () => {
    const off = await sam.client.raw('PUT', `/api/shared-task-state?${q()}`, { enabled: false });
    expect(off.status).toBe(200);
    const left = await runs();
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((r) => r.mine)).toBe(true);
  });
});
