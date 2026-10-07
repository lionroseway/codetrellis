/**
 * Phase 33 B1 — matchers (BUILDING-BLOCKS.md §B1).
 *
 * The team calls Stripe from one client, but Stripe is more than one host:
 * the API and its files service. One glob says both. A second rule, by a
 * regex, keeps every payment provider's API to the same client. Both are set
 * over REST the way the app sets them, written to the suite with their
 * matcher, and committed.
 *
 * A branch uploads a receipt to files.stripe.com from the web app and calls
 * PayPal's API from a Python route. The check fails on both lines, each under
 * the rule that names it; the client's own calls pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const CLIENT = 'packages/web/src/payments.ts';
const API = 'packages/web/src/api.ts';
const ROUTE = 'services/api/app/routes/users.py';
const PROVIDERS = 'http:api\\.(stripe|paypal)\\.com(/.*)?';

interface Gate { ok: boolean; rules: Array<{ path: string; imports: string; rule: string; words: string; line?: number | null }> }
interface RuleView { rule: { id: string; match?: string }; words: string; breaches: Array<{ from: string; to: string }> | null }

test.describe.serial('B1: a glob covers every Stripe host, a regex every provider\'s API', () => {
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
  const prepend = (rel: string, text: string) => fs.writeFileSync(path.join(root, rel), `${text}${fs.readFileSync(path.join(root, rel), 'utf-8')}`);
  const rulesNow = async () => ((await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as { rules: RuleView[] }).rules;

  test.beforeAll(async () => {
    h = await setupHarness('rule-matchers');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    write(CLIENT, "export const charge = (cents: number) =>\n  fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });\n"
      + "export const receipt = (id: string) =>\n  fetch(`https://files.stripe.com/v1/files/${id}`);\n");
    git('add', '-A');
    git('commit', '-qm', 'The payments client');
    await h.client.scanProject(root);
    const rules: Array<[string, Record<string, unknown>]> = [
      ['stripe-via-client', { kind: 'calls', calls: 'http:*.stripe.com', only: [CLIENT], strength: 'block', because: 'The client sets idempotency keys.', suite: 'payments' }],
      ['providers-via-client', { kind: 'calls', calls: PROVIDERS, match: 'regex', only: [CLIENT], strength: 'block', because: 'One place talks to payment providers.', suite: 'payments' }],
    ];
    for (const [id, body] of rules) {
      const res = await h.client.raw('PUT', `/api/rules/${id}?${q()}`, body);
      expect(res.status, await res.clone().text()).toBe(200);
    }
    const suite = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'payments.yaml'), 'utf-8');
    expect(suite).toContain('calls: http:*.stripe.com');
    expect(suite).toContain('match: glob');
    expect(suite).toContain('match: regex');
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rules: payment providers through the client');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the rules keep their matchers, say what they are, and the client\'s own calls break neither', async () => {
    const rules = await rulesNow();
    const stripe = rules.find((r) => r.rule.id === 'stripe-via-client')!;
    expect(stripe.rule.match).toBe('glob');
    expect(stripe.words).toBe(`only ${CLIENT} may call *.stripe.com: The client sets idempotency keys.`);
    expect(stripe.breaches).toEqual([]);
    const providers = rules.find((r) => r.rule.id === 'providers-via-client')!;
    expect(providers.rule.match).toBe('regex');
    expect(providers.words).toBe(`only ${CLIENT} may make a call matching /${PROVIDERS}/: One place talks to payment providers.`);
    expect(providers.breaches).toEqual([]);
  });

  test('a branch reaching files.stripe.com and api.paypal.com from elsewhere fails, each under the rule that names it', async () => {
    git('checkout', '-qb', 'providers-direct');
    prepend(API, "export const upload = (body: Blob) => fetch('https://files.stripe.com/v1/files', { method: 'POST', body });\n");
    prepend(ROUTE, "import requests\n\n\ndef pay(order):\n    return requests.post('https://api.paypal.com/v2/checkout/orders', json=order)\n\n\n");
    git('add', '-A');
    git('commit', '-qm', 'Upload and pay');

    const r = ct('check', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(3);
    const g = JSON.parse(r.out) as Gate;
    expect(g.rules.map((x) => `${x.path} ${x.imports} ${x.rule}`).sort()).toEqual([
      `${API} http:files.stripe.com/v1/files stripe-via-client`,
      `${ROUTE} http:api.paypal.com/v2/checkout/orders providers-via-client`,
    ]);
    expect(g.rules.find((x) => x.path === API)!.line).toBe(1);
    expect(g.rules.find((x) => x.path === ROUTE)!.line).toBe(5);
  });

  test('a matcher written wrongly is refused with why', async () => {
    const bad = await h.client.raw('PUT', `/api/rules/bad?${q()}`, { kind: 'calls', calls: 'http:(a+)+', match: 'regex', only: [CLIENT] });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/repeat a group that itself repeats/);
  });
});
