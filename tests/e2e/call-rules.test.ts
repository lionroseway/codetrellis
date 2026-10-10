/**
 * Phase 33 R7 — call rules (RULES-AND-CLARITY §3.1).
 *
 * The team calls Stripe's API from one client per language, and only the
 * billing service touches the invoices table. Two rules on main, set over
 * REST the way the app sets them:
 *  - only the two payments clients may call api.stripe.com;
 *  - only services/billing/ (and the migrations) may use the table invoices.
 *
 * An agent's branch calls Stripe straight from the web app's API client
 * (fetch) and from a Python route (requests), and reads invoices from the
 * reporting service. The check fails, naming each call on its line; the
 * clients' own calls pass. Opened, the rules view shows what breaks each
 * today, from the scanned callsites.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const WEB_CLIENT = 'packages/web/src/payments.ts';
const PY_CLIENT = 'services/api/app/billing.py';
const API = 'packages/web/src/api.ts';
const ROUTE = 'services/api/app/routes/users.py';
const REPORT = 'services/reporting/src/overdue.ts';
const BILLING_SQL = 'services/billing/src/invoices.ts';
const STRIPE = 'http:api.stripe.com';

interface Gate { ok: boolean; rules: Array<{ path: string; imports: string; rule: string; words: string; fix: string | null; line?: number | null }> }
interface RuleView { rule: { id: string; kind?: string }; words: string; breaches: Array<{ from: string; to: string }> | null }

test.describe.serial('R7: only the clients may call Stripe, only billing may use invoices', () => {
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
    h = await setupHarness('call-rules');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    write(WEB_CLIENT, "export const charge = (cents: number) =>\n  fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });\n");
    write(PY_CLIENT, "import requests\n\n\ndef charge(cents):\n    return requests.post('https://api.stripe.com/v1/charges', data={'amount': cents})\n");
    write(BILLING_SQL, "export const unpaid = 'SELECT * FROM invoices WHERE paid = false';\n");
    git('add', '-A');
    git('commit', '-qm', 'Payments clients and billing');
    await h.client.scanProject(root);
    const rules: Array<[string, Record<string, unknown>]> = [
      ['stripe-api-via-clients', { kind: 'calls', calls: STRIPE, only: [WEB_CLIENT, PY_CLIENT], strength: 'block', because: 'The clients set idempotency keys.', suite: 'payments' }],
      ['invoices-via-billing', { kind: 'calls', calls: 'sql:invoices', only: ['services/billing/', 'db/'], strength: 'block', because: 'Billing owns invoices; migrations shape them.', suite: 'billing' }],
    ];
    for (const [id, body] of rules) {
      const res = await h.client.raw('PUT', `/api/rules/${id}?${q()}`, body);
      expect(res.status, await res.clone().text()).toBe(200);
    }
    expect(fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'payments.yaml'), 'utf-8')).toContain(`calls: ${STRIPE}`);
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rules: Stripe through the clients, invoices through billing');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the rules say what they are, and nothing breaks them on main: the clients\' own calls are allowed', async () => {
    const rules = await rulesNow();
    const stripe = rules.find((r) => r.rule.id === 'stripe-api-via-clients')!;
    expect(stripe.rule.kind).toBe('calls');
    expect(stripe.words).toBe(`only ${WEB_CLIENT}, ${PY_CLIENT} may call api.stripe.com: The clients set idempotency keys.`);
    expect(stripe.breaches).toEqual([]);
    const invoices = rules.find((r) => r.rule.id === 'invoices-via-billing')!;
    expect(invoices.words).toBe('only services/billing/, db/ may use the table invoices: Billing owns invoices; migrations shape them.');
    expect(invoices.breaches).toEqual([]);
  });

  test('a branch calling Stripe from the API client and a Python route, and reading invoices from reporting, fails the check', async () => {
    git('checkout', '-qb', 'stripe-direct');
    prepend(API, "export const quickCharge = (cents: number) => fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });\n");
    prepend(ROUTE, "import requests\n\n\ndef refund(charge_id):\n    return requests.post('https://api.stripe.com/v1/refunds', data={'charge': charge_id})\n\n\n");
    write(REPORT, "export const overdue = 'SELECT id, due FROM invoices WHERE paid = false';\n");
    git('add', '-A');
    git('commit', '-qm', 'Charge, refund and report');

    const r = ct('check', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(3);
    const g = JSON.parse(r.out) as Gate;
    expect(g.rules.map((x) => `${x.path} ${x.imports} ${x.rule}`).sort()).toEqual([
      `${API} ${STRIPE}/v1/charges stripe-api-via-clients`,
      `${ROUTE} ${STRIPE}/v1/refunds stripe-api-via-clients`,
      `${REPORT} sql:invoices invoices-via-billing`,
    ]);
    const api = g.rules.find((x) => x.path === API)!;
    expect(api.words).toBe(`only ${WEB_CLIENT}, ${PY_CLIENT} may call api.stripe.com`);
    expect(api.fix).toBe(`use ${WEB_CLIENT} or ${PY_CLIENT} instead`);
    expect(api.line).toBe(1);
    expect(g.rules.find((x) => x.path === ROUTE)!.line).toBe(5);

    const text = ct('check', '--base', main);
    expect(text.code).toBe(3);
    expect(text.out).toContain(`      ${API}:1 calls api.stripe.com/v1/charges`);
    expect(text.out).toContain(`      ${REPORT}:1 uses the table invoices`);
  });

  test('opened on the branch, the rules view shows what breaks each today, from the scanned callsites', async () => {
    await h.client.scanProject(root);
    const rules = await rulesNow();
    expect(rules.find((r) => r.rule.id === 'stripe-api-via-clients')!.breaches!.map((b) => `${b.from} ${b.to}`).sort())
      .toEqual([`${API} ${STRIPE}/v1/charges`, `${ROUTE} ${STRIPE}/v1/refunds`]);
    expect(rules.find((r) => r.rule.id === 'invoices-via-billing')!.breaches!.map((b) => b.from)).toEqual([REPORT]);
  });

  test('a call rule needs a call it can read, and who may make it', async () => {
    const bad = await h.client.raw('PUT', `/api/rules/bad?${q()}`, { kind: 'calls', calls: 'stripe', only: [WEB_CLIENT] });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/http: and a host/);
    expect((await h.client.raw('PUT', `/api/rules/bad?${q()}`, { kind: 'calls', calls: STRIPE })).status).toBe(400);
  });
});
