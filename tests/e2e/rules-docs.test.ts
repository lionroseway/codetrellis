/**
 * Phase 33 B7 — every worked example in docs/claude/rules.md is a test.
 *
 * Each example is run as the page writes it (tools/doc-examples reads it): a
 * fresh repository with its files on `main` and its change on a branch, on a
 * machine with no desktop app, `codetrellis` on the PATH, and its commands run
 * there. Each must print what the page shows, to the character, and exit as
 * the page says. Where an example has an agent, a stand-in plays its part and
 * reports what the page says the agent reports; everything else is the code.
 *
 * Then the pipeline recipe, docs/recipes/pipeline.sh, runs on the pipeline
 * example: all three stages with a key, and the agent stage skipped, said,
 * without one, as a fork's pull request would be.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { findFreePorts } from '../harness';
import { REPO_ROOT } from '../harness/paths';
import { docExamples, type DocExample } from '../../tools/doc-examples/examples';
import { exampleRepo, runSteps } from '../../tools/doc-examples/run';

const PAGE = 'docs/claude/rules.md';
const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const STUB = path.join(REPO_ROOT, 'tests', 'e2e', 'fixtures', 'stub-agent-cli.mjs');
const KEY = 'sk-ant-docs-0123456789abcdef';
const examples = docExamples(fs.readFileSync(path.join(REPO_ROOT, PAGE), 'utf8'), PAGE);

/** A machine with no desktop app: its own home, cache and ports, `codetrellis` on the PATH, and the agent stood in for. */
async function machine(ex: DocExample, tmp: string) {
  const home = path.join(tmp, 'home');
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'codetrellis'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
  const [port, mcpPort] = await findFreePorts(2);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>), PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), CODETRELLIS_DATA_DIR: '',
    CODETRELLIS_BACKEND_PORT: String(port), CODETRELLIS_MCP_PORT: String(mcpPort),
    GITHUB_BASE_REF: '', GITHUB_ACTIONS: '', CI: '', CLAUDECODE: '', CODETRELLIS_AGENT: '', FORCE_COLOR: '', NO_COLOR: '',
    ANTHROPIC_API_KEY: KEY,
  };
  const record = path.join(tmp, 'agent.json');
  if (ex.report) {
    const report = path.join(tmp, 'report.json');
    fs.writeFileSync(report, JSON.stringify(ex.report));
    const claude = path.join(bin, 'claude-stand-in');
    fs.writeFileSync(claude, `#!/bin/sh\nexec "${process.execPath}" "${STUB}" "report:${report}" "${record}" "$@"\n`, { mode: 0o755 });
    env.CODETRELLIS_REVIEW_CLAUDE = claude;
  }
  return { env, given: () => (fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) as Array<{ message: string }> : []) };
}

test.describe('Every example in docs/claude/rules.md does what the page says', () => {
  test.setTimeout(300_000);

  test('the page has an example for each building block', () => {
    expect(examples.map((e) => e.id)).toEqual(['api-calls', 'exec-env', 'text', 'look-alikes', 'agent-rule', 'pipeline']);
  });

  for (const ex of examples) {
    test(`${ex.id} (${PAGE}:${ex.line})`, async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ct-docs-${ex.id}-`));
      try {
        const m = await machine(ex, tmp);
        const repo = exampleRepo(ex, tmp);
        const runs = runSteps(ex, repo, m.env);
        runs.forEach((r, i) => {
          const want = ex.steps[i];
          const at = `${PAGE}:${want.line}, \`${want.commands.trim().split('\n').pop()}\``;
          expect(r.out, `${at} printed something else (stderr: ${r.err})`).toBe(want.output);
          expect(r.code, `${at} exited ${r.code}, the page says ${want.exit}`).toBe(want.exit);
        });
        if (ex.id === 'pipeline') {
          // The review stage's bundle carried what the stages before it found.
          const bundle = JSON.parse(m.given()[0].message.split('<bundle>')[1].split('</bundle>')[0]) as { grounding: Array<{ stage: string; path: string; says: string }>; rules: Array<{ rule: string }> };
          expect(bundle.rules.map((r) => r.rule)).toEqual(['money-through-ledger']);
          expect(bundle.grounding.map((g) => `${g.stage} ${g.path}`)).toEqual(['fast src/api/refunds.ts']);
          expect(bundle.grounding[0].says).toContain('calls api.stripe.com/v1/refunds');
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  test('docs/recipes/pipeline.sh runs the pipeline example: every stage with a key, the agent stage skipped without one', async () => {
    const ex = examples.find((e) => e.id === 'pipeline')!;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-docs-recipe-'));
    let m: Awaited<ReturnType<typeof machine>> | undefined;
    try {
      m = await machine(ex, tmp);
      const env0 = m.env;
      const repo = exampleRepo(ex, tmp);
      const recipe = path.join(REPO_ROOT, 'docs', 'recipes', 'pipeline.sh');
      const run = (env: Record<string, string>) => spawnSync('sh', [recipe], { cwd: repo, env: { ...env0, CODETRELLIS_BASE: 'main', ...env }, encoding: 'utf8', timeout: 240_000 });

      const keyed = run({ CODETRELLIS_AUTH: 'env:ANTHROPIC_API_KEY' });
      expect(keyed.status, keyed.stderr || keyed.stdout).toBe(0);
      expect(keyed.stdout).toContain('✓ stage review: agent rules, after fast and fuzzy, when fast passed, grounded by fast and fuzzy');
      expect(keyed.stdout).toContain('✓ The pipeline passes (3 of 3 stages ran).');

      // A fork's pull request: the secret is empty.
      const fork = run({ CODETRELLIS_AUTH: 'env:ANTHROPIC_API_KEY', ANTHROPIC_API_KEY: '' });
      expect(fork.status, fork.stderr || fork.stdout).toBe(0);
      expect(fork.stdout).toContain('codetrellis pipeline: ANTHROPIC_API_KEY is not set (no such secret here, or a fork\'s pull request); agent stages are skipped');
      expect(fork.stdout).toContain('· stage review: agent rules, after fast and fuzzy, when fast passed, grounded by fast and fuzzy — skipped: no reviewer was given (--agent), so its agent rules are guides');
      expect(fork.stdout).toContain('✓ The pipeline passes (2 of 3 stages ran).');

      // A job per stage.
      const one = run({ CODETRELLIS_STAGE: 'fuzzy' });
      expect(one.status, one.stderr || one.stdout).toBe(0);
      expect(one.stdout).toContain('✓ The pipeline passes (1 of 1 stages ran).');
    } finally {
      // The recipe stops CodeTrellis itself; this is for a run that died before it could.
      spawnSync('sh', ['-c', 'codetrellis stop'], { cwd: path.join(tmp, ex.id), env: m?.env, stdio: 'ignore', timeout: 60_000 });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
