/**
 * Phase 33 C9 — a review on your own device counts on the pull request.
 *
 * Sam reviews his branch in Cursor, which reaches CodeTrellis through the
 * stdio connector: it asks for the bundle and reports one grounded finding.
 * CodeTrellis checks it and signs it with Sam's device key, as a git note on
 * the commit. His key is already on main. He pushes the branch and the notes.
 *
 * CI is a fresh clone with no app, no secret and no AI: `codetrellis review
 * verify` shows Cursor's review and its finding at its line. A note someone
 * edits after it was signed is refused, and a push after the review makes it
 * stale, both failing with --require.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const NOTES = 'refs/notes/codetrellis-reviews';
const CLIENT = 'packages/web/src/payments.ts';
const API = 'packages/web/src/api.ts';
const CALL = "export const quickCharge = (cents: number) => fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });";

interface Verified { state: string; review: { agent: string; findings: Array<{ path: string; start: number; says: string; rule: string }> } | null; words: string }

test.describe.serial('C9: Sam\'s review in Cursor, signed on his device, verified in CI with no secret', () => {
  test.setTimeout(300_000);
  let h: Harness;
  let root: string;
  let ci: string;
  let tmp: string;
  let cursor: Client;
  let head: string;
  const gitAt = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  const git = (...args: string[]) => gitAt(root, ...args);
  const ct = (cwd: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 120_000, env: { ...(process.env as Record<string, string>), ...ENV, GITHUB_BASE_REF: '', GITHUB_ACTIONS: '', CI: '' } });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await cursor.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: ((r.content ?? []) as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
  };
  const verify = (...args: string[]) => {
    const r = ct(ci, 'review', 'verify', '--base', 'origin/main', ...args);
    return { ...r, v: args.includes('json') ? JSON.parse(r.out) as Verified : null };
  };

  test.beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-signed-review-'));
    h = await setupHarness('signed-review');
    root = h.fixture.projectPath;
    fs.writeFileSync(path.join(root, CLIENT), "export const charge = (cents: number) =>\n  fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });\n");
    git('add', '-A');
    git('commit', '-qm', 'The payments client');
    await h.client.scanProject(root);
    const res = await h.client.raw('PUT', `/api/rules/stripe-via-client?project=${encodeURIComponent(root)}`, { kind: 'calls', calls: 'http:api.stripe.com', only: [CLIENT], strength: 'block', because: 'The client sets idempotency keys.', suite: 'payments' });
    expect(res.status, await res.clone().text()).toBe(200);
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rule: Stripe through the client');
    git('checkout', '-qb', 'quick-charge');
    fs.writeFileSync(path.join(root, API), `${CALL}\n${fs.readFileSync(path.join(root, API), 'utf-8')}`);
    git('commit', '-qam', 'Quick charge from the API client');
    head = git('rev-parse', 'HEAD');

    cursor = new Client({ name: 'cursor', version: '0.0.0-test' }, { capabilities: {} });
    await cursor.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', path.join(REPO_ROOT, 'src/backend/mcp/connector/main.ts'), '--data-dir', h.fixture.dataDir],
      cwd: root, stderr: 'pipe',
    }));
  });

  test.afterAll(async () => {
    await cursor?.close().catch(() => {});
    await h?.teardown();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('Cursor reviews the branch on Sam\'s machine; CodeTrellis checks the finding and signs the review as a note on the commit', async () => {
    const bundle = JSON.parse((await call('get_review_bundle', { base: 'main', project_path: root })).text) as { id: string; head: string };
    expect(bundle.head).toBe(head);
    const r = await call('report_review', {
      bundle: bundle.id,
      findings: [{ kind: 'rule', file: API, start_line: 1, end_line: 1, quote: "fetch('https://api.stripe.com/v1/charges'", says: 'The API client calls Stripe directly, without the client\'s idempotency keys.', rule: 'stripe-via-client' }],
    });
    expect(r.isError, r.text).toBe(false);
    const res = JSON.parse(r.text) as { signed?: { commit: string; note: string; says: string }; unsigned?: string };
    expect(res.unsigned).toBeUndefined();
    expect(res.signed).toMatchObject({ commit: head, note: NOTES });
    expect(git('notes', `--ref=${NOTES}`, 'show', head)).toContain('kind: codetrellis-review');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('diff', '--stat', 'main', 'HEAD', '--', API)).toContain('1 file changed');

    // The device's key was introduced beside the rules; it goes on main, as any key must before CI trusts it.
    const keys = fs.readdirSync(path.join(root, '.codetrellis', 'keys'));
    expect(keys).toHaveLength(1);
    git('checkout', '-q', 'main');
    git('add', '.codetrellis/keys');
    git('commit', '-qm', 'Sam\'s device key');
    git('checkout', '-q', 'quick-charge');

    // Pushed: the branch, main, and the notes.
    const remote = path.join(tmp, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    git('remote', 'add', 'origin', remote);
    git('push', '-q', 'origin', 'main', 'quick-charge');
    const published = ct(root, 'review', 'publish');
    expect(published.code, published.err || published.out).toBe(0);
    expect(published.out).toContain(`Pushed the signed reviews to origin (${NOTES})`);

    ci = path.join(tmp, 'ci');
    execFileSync('git', ['clone', '-q', '--branch', 'quick-charge', remote, ci]);
  });

  test('in CI: a fresh clone, no app, no secret, verifies it and shows the finding at its line', () => {
    const r = verify('--format', 'json', '--require');
    expect(r.code, r.err || r.out).toBe(0);
    expect(r.v!.state).toBe('verified');
    expect(r.v!.review!.agent).toBe('cursor');
    expect(r.v!.review!.findings).toEqual([expect.objectContaining({ path: API, start: 1, rule: 'stripe-via-client' })]);
    const text = verify();
    expect(text.out).toMatch(/^✓ cursor's review of [0-9a-f]{7}, signed on a device the base trusts/);
    expect(text.out).toContain(`✗ ${API}:1 The API client calls Stripe directly`);
    const sarif = JSON.parse(verify('--format', 'sarif').out) as { runs: Array<{ results: Array<{ ruleId: string; locations: Array<{ physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }> }> }> };
    expect(sarif.runs[0].results.map((x) => `${x.ruleId} ${x.locations[0].physicalLocation.artifactLocation.uri}:${x.locations[0].physicalLocation.region.startLine}`)).toEqual([`stripe-via-client ${API}:1`]);
  });

  test('the recipe\'s Verify step, as CI runs it, puts the review in the job summary and the finding in SARIF', () => {
    const recipe = parseYaml(fs.readFileSync(path.join(REPO_ROOT, 'docs/recipes/github-actions-signed-review.yml'), 'utf8')) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> };
    const step = recipe.jobs.verify.steps.find((x) => x.name === 'Verify')!;
    // `codetrellis` on the PATH, as `npm link` leaves it.
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'codetrellis'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
    const summary = path.join(tmp, 'summary.md');
    execFileSync('sh', ['-c', step.run!], {
      cwd: ci, encoding: 'utf8',
      env: { ...process.env, ...ENV, PATH: `${bin}:${process.env.PATH}`, BASE: 'origin/main', HEAD_SHA: head, GITHUB_STEP_SUMMARY: summary, GITHUB_ACTIONS: '', CI: '' },
    });
    const said = fs.readFileSync(summary, 'utf8');
    expect(said).toContain('### CodeTrellis review');
    expect(said).toContain('The API client calls Stripe directly');
    expect(said).toMatch(/✓ cursor's review of [0-9a-f]{7}, signed on a device the base trusts/);
    const sarif = JSON.parse(fs.readFileSync(path.join(ci, 'signed-review.sarif'), 'utf8')) as { runs: Array<{ results: unknown[] }> };
    expect(sarif.runs[0].results).toHaveLength(1);
    fs.rmSync(path.join(ci, 'signed-review.sarif'));
  });

  test('a note edited after it was signed is refused', () => {
    const good = git('notes', `--ref=${NOTES}`, 'show', head);
    const forged = good.replace('calls Stripe directly', 'is fine');
    execFileSync('git', ['-C', root, 'notes', `--ref=${NOTES}`, 'add', '-f', '-F', '-', head], { input: forged, env: { ...process.env, ...ENV } });
    git('push', '-q', '-f', 'origin', `${NOTES}:${NOTES}`);
    const r = verify('--format', 'json', '--require');
    expect(r.code).toBe(3);
    expect(r.v!.state).toBe('refused');
    expect(r.v!.words).toContain('because its signature does not verify: it was changed after it was signed, or forged');
    // The real one back.
    execFileSync('git', ['-C', root, 'notes', `--ref=${NOTES}`, 'add', '-f', '-F', '-', head], { input: good, env: { ...process.env, ...ENV } });
    git('push', '-q', '-f', 'origin', `${NOTES}:${NOTES}`);
    expect(verify('--format', 'json').v!.state).toBe('verified');
  });

  test('a push after the review makes it stale', () => {
    fs.appendFileSync(path.join(root, API), '// one more line\n');
    git('commit', '-qam', 'After the review');
    git('push', '-q', 'origin', 'quick-charge');
    gitAt(ci, 'pull', '-q', 'origin', 'quick-charge');
    const r = verify('--format', 'json', '--require');
    expect(r.code).toBe(3);
    expect(r.v!.state).toBe('stale');
    expect(r.v!.words).toBe(`⚠ The latest review is cursor's of ${head.slice(0, 7)}, before the last push: it does not count for ${gitAt(ci, 'rev-parse', '--short=7', 'HEAD')}. Review the head again.`);
  });
});
