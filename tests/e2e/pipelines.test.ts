/**
 * Phase 33 B6 — pipelines (BUILDING-BLOCKS.md §B6).
 *
 * The team runs its rules in three stages: the deterministic ones, the fuzzy
 * ones beside them, then an agent review of the rules only a reader can
 * judge, once the fuzzy stage passes, given what both found. The review is
 * Claude Code's print mode, played by the stand-in C4's tests use.
 *
 * A branch calls Stripe from the API client (the fast stage fails) and imports
 * `reqeusts` (the fuzzy stage warns and passes). The review runs, and its
 * bundle carries both findings as grounding; each stage is a check run saying
 * its stage. A second branch drops the fuzzy stage: the check refuses it as a
 * loosening until a person approves it in the app, signed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const STUB = path.join(REPO_ROOT, 'tests', 'e2e', 'fixtures', 'stub-agent-cli.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const WEB = 'packages/web/src/';
const CLIENT = `${WEB}payments.ts`;
const API = `${WEB}api.ts`;
const ROUTE = 'services/api/app/routes/users.py';
const PIPELINE = [
  'stages:',
  '  - id: fast',
  '    rules: { engine: deterministic }',
  '  - id: fuzzy',
  '    rules: { engine: fuzzy }',
  '    parallel: true',
  '  - id: review',
  '    needs: [fast, fuzzy]',
  '    rules: { engine: agent }',
  '    when: { fuzzy: passed }',
  '    grounding: [fast, fuzzy]',
  '',
].join('\n');

interface Stage { id: string; ran: boolean; ok: boolean; skipped?: string; gate?: { rulebook: Array<{ rule: string; effect: string; words: string }> } }
interface Piped { ok: boolean; stages: Stage[] }

test.describe.serial('B6: three stages, one beside another, the review grounded by both; dropping a stage is a loosening', () => {
  test.setTimeout(300_000);
  let h: Harness;
  let root: string;
  let main: string;
  let tmp: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  const q = () => `project=${encodeURIComponent(root)}`;
  const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  const stub = () => {
    const record = path.join(tmp, 'none.json');
    const bin = path.join(tmp, 'claude-none');
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${STUB}" none "${record}" "$@"\n`, { mode: 0o755 });
    return { bin, given: () => JSON.parse(fs.readFileSync(record, 'utf8')) as Array<{ message: string }> };
  };
  const ct = (env: Record<string, string>, ...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args, '--data-dir', h.fixture.dataDir], {
      cwd: root, encoding: 'utf8', timeout: 180_000,
      env: { ...(process.env as Record<string, string>), ...ENV, CLAUDECODE: '1', CODETRELLIS_AGENT: '', FORCE_COLOR: '', GITHUB_BASE_REF: '', GITHUB_ACTIONS: '', CI: '', ...env },
    });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };

  test.beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pipeline-'));
    h = await setupHarness('pipelines');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    write(CLIENT, "export const charge = (cents: number) =>\n  fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });\n");
    write('.codetrellis/pipeline.yaml', PIPELINE);
    git('add', '-A');
    git('commit', '-qm', 'The payments client, and the pipeline');
    await h.client.scanProject(root);
    const rules: Array<[string, Record<string, unknown>]> = [
      ['stripe-via-client', { kind: 'calls', calls: 'http:api.stripe.com', only: [CLIENT], strength: 'block', because: 'The client sets idempotency keys.', suite: 'payments' }],
      ['no-requests-lookalikes', { kind: 'package', package: { match: 'fuzzy', value: 'pypi:requests' }, strength: 'warn', because: 'Typosquats look like this.', suite: 'supply' }],
      ['money-through-ledger', { engine: 'agent', rule: 'Code that moves money records it through the ledger.', in: [WEB], strength: 'warn', suite: 'money' }],
    ];
    for (const [id, body] of rules) {
      const res = await h.client.raw('PUT', `/api/rules/${id}?${q()}`, body);
      expect(res.status, await res.clone().text()).toBe(200);
    }
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rules: deterministic, fuzzy and agent');
  });

  test.afterAll(async () => {
    await h?.teardown();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('the app shows the pipeline\'s stages in words, with nothing pending', async () => {
    const view = await (await h.client.raw('GET', `/api/pipeline?${q()}`)).json() as { words: string[]; pending: unknown[]; problems: string[] };
    expect(view.problems).toEqual([]);
    expect(view.words).toEqual([
      'fast: deterministic rules',
      'fuzzy: fuzzy rules, beside the stage before',
      'review: agent rules, after fast and fuzzy, when fuzzy passed, grounded by fast and fuzzy',
    ]);
    expect(view.pending).toEqual([]);
  });

  test('a branch: the fast stage fails, the fuzzy one warns beside it, and the review runs grounded by both; each stage is a run', async () => {
    git('checkout', '-qb', 'pay-direct');
    write(API, `export const quickCharge = (cents: number) => fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });\n${fs.readFileSync(path.join(root, API), 'utf-8')}`);
    write(ROUTE, `import reqeusts\n${fs.readFileSync(path.join(root, ROUTE), 'utf-8')}`);
    git('add', '-A');
    git('commit', '-qm', 'Pay directly');

    const s = stub();
    const r = ct({ CODETRELLIS_REVIEW_CLAUDE: s.bin, REVIEW_KEY: 'sk-ant-test-0123456789abcdef' }, 'check', '--pipeline', '--base', main, '--json', '--agent', 'claude-code', '--auth', 'env:REVIEW_KEY');
    expect(r.code, r.err || r.out).toBe(3);
    const piped = JSON.parse(r.out) as Piped;
    expect(piped.stages.map((x) => `${x.id} ${x.ran ? 'ran' : 'skipped'} ${x.ok ? 'ok' : 'failed'}`)).toEqual(['fast ran failed', 'fuzzy ran ok', 'review ran ok']);

    // The review's bundle: only the agent rule, and what the earlier stages found, as facts.
    const message = s.given()[0].message;
    const bundle = JSON.parse(message.slice(message.indexOf('<bundle>') + 8, message.indexOf('</bundle>'))) as { rules: Array<{ rule: string }>; grounding: Array<{ stage: string; path: string; says: string }>; contract: string };
    expect(bundle.rules.map((x) => x.rule)).toEqual(['money-through-ledger']);
    expect(bundle.grounding.map((g) => `${g.stage} ${g.path}`)).toEqual([`fast ${API}`, `fuzzy ${ROUTE}`]);
    expect(bundle.grounding[0].says).toContain('calls api.stripe.com/v1/charges');
    expect(bundle.grounding[1].says).toContain('imports pypi:reqeusts');
    expect(bundle.contract).toContain('Under `grounding`, if given, is what earlier stages of the pipeline already found');

    const runs = ((await (await h.client.raw('GET', `/api/check-runs?${q()}`)).json()) as { runs: Array<{ ranIn: string }> }).runs;
    expect(runs.map((x) => x.ranIn).sort()).toEqual(['a terminal, stage fast', 'a terminal, stage fuzzy', 'a terminal, stage review']);

    // --stage runs one, and says it in words.
    const one = ct({}, 'check', '--pipeline', '--stage', 'fuzzy', '--base', main);
    expect(one.code, one.err || one.out).toBe(0);
    expect(one.out).toContain('✓ stage fuzzy: fuzzy rules, beside the stage before');
    expect(one.out).toContain('✓ The pipeline passes (1 of 1 stages ran).');
  });

  test('a branch dropping the fuzzy stage is refused as a loosening, until a person approves it in the app, signed', async () => {
    git('checkout', '-q', main);
    git('checkout', '-qb', 'no-fuzzy');
    write('.codetrellis/pipeline.yaml', 'stages:\n  - id: fast\n    rules: { engine: deterministic }\n  - id: review\n    needs: [fast]\n    rules: { engine: agent }\n    grounding: [fast]\n');
    // Before it is committed, the app says what it loosens.
    const view = await (await h.client.raw('GET', `/api/pipeline?${q()}`)).json() as { pending: Array<{ stage: string; words: string }> };
    expect(view.pending.map((p) => p.stage)).toEqual(['fuzzy', 'review']);
    expect(view.pending[0].words).toBe('✗ This change removes the stage fuzzy from the pipeline (“fuzzy: fuzzy rules, beside the stage before”). Loosening a rule needs a person\'s approval in the app.');
    git('add', '-A');
    git('commit', '-qm', 'Drop the fuzzy stage');

    const r = ct({}, 'check', '--pipeline', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(3);
    const fast = (JSON.parse(r.out) as Piped).stages.find((x) => x.id === 'fast')!;
    expect(fast.gate!.rulebook.map((c) => `${c.rule} ${c.effect}`)).toEqual(['pipeline.fuzzy loosens', 'pipeline.review loosens']);
    // The plain check says it too: the pipeline is a rule file.
    const plain = ct({}, 'check', '--base', main);
    expect(plain.code).toBe(3);
    expect(plain.out).toContain('This change removes the stage fuzzy from the pipeline');

    // A person approves it in the app: signed, beside the rules.
    git('checkout', '-q', main);
    write('.codetrellis/pipeline.yaml', 'stages:\n  - id: fast\n    rules: { engine: deterministic }\n  - id: review\n    needs: [fast]\n    rules: { engine: agent }\n    grounding: [fast]\n');
    const approved = await (await h.client.raw('POST', `/api/pipeline/approve?${q()}`)).json() as { signed: Array<{ stage: string; file: string }>; view: { pending: unknown[] } };
    expect(approved.signed.map((x) => x.stage)).toEqual(['fuzzy', 'review']);
    expect(approved.view.pending).toEqual([]);
    for (const x of approved.signed) expect(fs.existsSync(path.join(root, x.file))).toBe(true);
    git('checkout', '-q', '--', '.codetrellis/pipeline.yaml');
  });
});
