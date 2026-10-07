/**
 * Phase 33 B4 — your own patterns (BUILDING-BLOCKS.md §B4).
 *
 * The web app reaches Stripe through `paymentsClient`, and publishes to an
 * orders queue. Neither is an HTTP call an extractor can see by itself, and a
 * queue is no kind CodeTrellis knows. Two patterns in
 * `.codetrellis/patterns/` say what they are. Two rules hold them: only the
 * client calls Stripe, and only billing publishes to `queue:orders.*`.
 *
 * The scan reads the patterns: the checkout that already charges through the
 * client breaks the Stripe rule today. A branch refunds through the client
 * from another file and publishes an order cancellation from the API. The
 * check fails on both lines, the review names the new queue entry, and a
 * pattern added later is read by the next scan though no file changed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const WEB = 'packages/web/src/';
const CLIENT = `${WEB}payments.ts`;
const CHECKOUT = `${WEB}checkout.ts`;
const BILLING = `${WEB}billing/publish.ts`;
const PATTERNS = [
  'patterns:',
  '  - id: payments-sdk',
  '    find: { match: regex, value: "paymentsClient\\\\.(charge|refund)\\\\(" }',
  '    is: http:api.stripe.com/v1/charges',
  '    method: POST',
  '  - id: orders-queue',
  `    in: [${WEB}]`,
  '    find: { match: regex, value: "publish\\\\([\'\\"]orders\\\\.(\\\\w+)" }',
  '    is: queue:orders.$1',
].join('\n');

interface Gate { ok: boolean; says: string[]; rules: Array<{ path: string; imports: string; rule: string; line?: number | null }> }
interface RuleView { rule: { id: string }; words: string; breaches: Array<{ from: string; to: string }> | null }

test.describe.serial('B4: paymentsClient.charge() is a call to Stripe, and a rule holds queue:orders.*', () => {
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
    h = await setupHarness('own-patterns');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    write('.codetrellis/patterns/payments.yaml', `${PATTERNS}\n`);
    write(CLIENT, "export const paymentsClient = {\n  charge: (cents: number) => fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) }),\n  refund: (id: string) => fetch(`https://api.stripe.com/v1/refunds/${id}`, { method: 'POST' }),\n};\n");
    write(CHECKOUT, "import { paymentsClient } from './payments';\n\nexport const pay = (cents: number) => paymentsClient.charge(cents);\n");
    write(BILLING, "declare function publish(topic: string, body: unknown): void;\n\nexport const created = (order: unknown) => publish('orders.created', order);\n");
    git('add', '-A');
    git('commit', '-qm', 'Payments client, checkout, billing, and the patterns that read them');
    await h.client.scanProject(root);
    const rules: Array<[string, Record<string, unknown>]> = [
      ['stripe-via-client', { kind: 'calls', calls: 'http:api.stripe.com', only: [CLIENT], strength: 'block', because: 'The client sets idempotency keys.', suite: 'payments' }],
      ['orders-from-billing', { kind: 'calls', calls: 'queue:orders.*', only: [`${WEB}billing/`], strength: 'block', because: 'Billing owns the order lifecycle.', suite: 'payments' }],
    ];
    for (const [id, body] of rules) {
      const res = await h.client.raw('PUT', `/api/rules/${id}?${q()}`, body);
      expect(res.status, await res.clone().text()).toBe(200);
    }
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rules: Stripe through the client, orders from billing');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the scan read the patterns: the checkout that charges through the client breaks the Stripe rule today; billing publishing breaks nothing', async () => {
    const rules = await rulesNow();
    const stripe = rules.find((r) => r.rule.id === 'stripe-via-client')!;
    expect(stripe.breaches).toEqual([{ rule: 'stripe-via-client', from: CHECKOUT, to: 'http:api.stripe.com/v1/charges' }]);
    const orders = rules.find((r) => r.rule.id === 'orders-from-billing')!;
    expect(orders.words).toBe(`only ${WEB}billing/ may reach queue:orders.*: Billing owns the order lifecycle.`);
    expect(orders.breaches).toEqual([]);
  });

  test('a branch refunding through the client and publishing from the API fails on both lines; the review names the queue entry', async () => {
    git('checkout', '-qb', 'cancel-orders');
    write(`${WEB}refunds.ts`, "import { paymentsClient } from './payments';\n\nexport const refund = (id: string) => paymentsClient.refund(id);\n");
    const api = fs.readFileSync(path.join(root, `${WEB}api.ts`), 'utf-8');
    write(`${WEB}api.ts`, `declare function publish(topic: string, body: unknown): void;\nexport const cancel = (id: string) => publish("orders.cancelled", id);\n${api}`);
    git('add', '-A');
    git('commit', '-qm', 'Refunds and cancellation');

    const r = ct('check', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(3);
    const g = JSON.parse(r.out) as Gate;
    expect(g.rules.map((x) => `${x.path}:${x.line} ${x.imports} ${x.rule}`).sort()).toEqual([
      `${WEB}api.ts:2 queue:orders.cancelled orders-from-billing`,
      `${WEB}refunds.ts:3 http:api.stripe.com/v1/charges stripe-via-client`,
    ]);
    expect(g.says).toContain(`✗ ${WEB}api.ts now reaches queue:orders.cancelled, which the rule “only ${WEB}billing/ may reach queue:orders.*” forbids: Billing owns the order lifecycle.`);

    const review = await (await h.client.raw('GET', `/api/review/architecture?${q()}&base=${main}&head=cancel-orders`)).json() as { words: string[] };
    expect(review.words).toContain(`Adds queue:orders.cancelled (${WEB}api.ts:2)`);
    expect(review.words).toContain(`Adds an HTTP call to POST /v1/charges (${WEB}refunds.ts:3)`);
  });

  test('a pattern added later is read by the next scan, though no file changed', async () => {
    git('checkout', '-q', main);
    write(`${WEB}flags.ts`, "declare function isEnabled(flag: string): boolean;\nexport const fast = () => isEnabled('fast-checkout');\n");
    git('add', '-A');
    git('commit', '-qm', 'A flag');
    await h.client.scanProject(root);
    const flagRule = { kind: 'calls', calls: 'flag:fast-checkout', only: [CHECKOUT], strength: 'warn', because: 'Checkout owns its flags.', suite: 'payments' };
    expect((await h.client.raw('PUT', `/api/rules/flags-in-checkout?${q()}`, flagRule)).status).toBe(200);
    expect((await rulesNow()).find((r) => r.rule.id === 'flags-in-checkout')!.breaches).toEqual([]);

    write('.codetrellis/patterns/flags.yaml', 'patterns:\n  - id: flags\n    find: { match: regex, value: "isEnabled\\\\([\'\\"]([\\\\w-]+)" }\n    is: flag:$1\n');
    await new Promise((r) => setTimeout(r, 2500)); // the patterns are re-read within two seconds of a change
    await h.client.scanProject(root);
    expect((await rulesNow()).find((r) => r.rule.id === 'flags-in-checkout')!.breaches).toEqual([{ rule: 'flags-in-checkout', from: `${WEB}flags.ts`, to: 'flag:fast-checkout' }]);
  });
});
