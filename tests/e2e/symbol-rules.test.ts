/**
 * Phase 33 R6 — symbol rules (RULES-AND-CLARITY §3.1).
 *
 * The web app keeps charging in one module. `createCharge` is defined in
 * packages/web/src/payments/charge.ts and passed on by the folder's barrel,
 * index.ts. One rule on main, set over REST the way the app sets it: only
 * packages/web/src/payments/ may import createCharge.
 *
 * An agent's branch imports it into the API client straight from charge.ts,
 * and into the cart through the barrel. The check fails, naming both; the
 * barrel did not hide the second. Importing `refund` from the same module,
 * and the payments folder's own use, pass. Opened, the rules view shows what
 * breaks it today from the scanned graph, through the barrel too.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const PAYMENTS = 'packages/web/src/payments/';
const CHARGE = 'packages/web/src/payments/charge.ts';
const BARREL = 'packages/web/src/payments/index.ts';
const CHECKOUT = 'packages/web/src/payments/checkout.ts';
const API = 'packages/web/src/api.ts';
const CART = 'packages/web/src/cart.ts';
const SYMBOL = `${CHARGE}#createCharge`;
const BECAUSE = 'Charging goes through the payments module, which sets idempotency keys.';

interface Gate { ok: boolean; says: string[]; rules: Array<{ path: string; imports: string; rule: string; words: string; fix: string | null; line?: number | null }> }
interface RuleView { rule: { id: string; kind?: string }; words: string; breaches: Array<{ rule: string; from: string; to: string }> | null }

test.describe.serial('R6: only the payments module may import createCharge', () => {
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

  test.beforeAll(async () => {
    h = await setupHarness('symbol-rules');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    write(CHARGE, 'export function createCharge(cents: number) { return { cents }; }\nexport function refund(id: string) { return { id }; }\n');
    write(BARREL, "export { createCharge, refund } from './charge';\n");
    write(CHECKOUT, "import { createCharge } from './charge';\n\nexport const pay = (cents: number) => createCharge(cents);\n");
    git('add', '-A');
    git('commit', '-qm', 'The payments module');
    await h.client.scanProject(root);
    const res = await h.client.raw('PUT', `/api/rules/charges-via-payments?${q()}`, { kind: 'symbol', symbol: SYMBOL, only: [PAYMENTS], strength: 'block', because: BECAUSE, suite: 'payments' });
    expect(res.status, await res.clone().text()).toBe(200);
    const suite = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'payments.yaml'), 'utf-8');
    expect(suite).toContain('kind: symbol');
    expect(suite).toContain(`symbol: ${SYMBOL}`);
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rule: charges through the payments module');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the rule says what it is, and nothing breaks it on main: the module\'s own use is allowed', async () => {
    const rules = ((await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as { rules: RuleView[] }).rules;
    const charge = rules.find((r) => r.rule.id === 'charges-via-payments')!;
    expect(charge.rule.kind).toBe('symbol');
    expect(charge.words).toBe(`only ${PAYMENTS} may import createCharge from ${CHARGE}: ${BECAUSE}`);
    expect(charge.breaches).toEqual([]);
  });

  test('a branch importing createCharge from outside fails the check, straight from its module and through the barrel', async () => {
    git('checkout', '-qb', 'charge-direct');
    const api = path.join(root, API);
    fs.writeFileSync(api, `import { createCharge } from './payments/charge';\n${fs.readFileSync(api, 'utf-8')}`);
    write(CART, "import { createCharge, refund } from './payments';\n\nexport const checkout = (cents: number) => createCharge(cents);\nexport const undo = refund;\n");
    // Another export of the same module is not the rule's business.
    write('packages/web/src/refunds.ts', "import { refund } from './payments/charge';\n\nexport const undoCharge = refund;\n");
    git('add', '-A');
    git('commit', '-qm', 'Charge from the API client and the cart');

    const r = ct('check', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(3);
    const g = JSON.parse(r.out) as Gate;
    expect(g.ok).toBe(false);
    const found = g.rules.map((x) => `${x.path} ${x.imports} ${x.rule}`).sort();
    expect(found).toEqual([
      `${API} ${SYMBOL} charges-via-payments`,
      `${CART} ${SYMBOL} charges-via-payments`,
    ]);
    const cart = g.rules.find((x) => x.path === CART)!;
    expect(cart.words).toBe(`only ${PAYMENTS} may import createCharge from ${CHARGE}`);
    expect(cart.fix).toBe(`use ${PAYMENTS} instead`);
    expect(cart.line).toBe(1);

    const text = ct('check', '--base', main);
    expect(text.code).toBe(3);
    expect(text.out).toContain(`      ${API}:1 imports ${SYMBOL}`);
    expect(text.out).toContain(`      ${CART}:1 imports ${SYMBOL}`);
    expect(text.out).toContain(`      → use ${PAYMENTS} instead`);
  });

  test('opened on the branch, the rules view shows what breaks it today, from the graph, through the barrel too', async () => {
    await h.client.scanProject(root);
    const rules = ((await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as { rules: RuleView[] }).rules;
    const breaches = rules.find((r) => r.rule.id === 'charges-via-payments')!.breaches!;
    expect(breaches.map((b) => b.from).sort()).toEqual([API, CART]);
    expect(breaches.every((b) => b.to === SYMBOL)).toBe(true);
  });

  test('a symbol rule needs a file and a name, and who may import it', async () => {
    const bad = await h.client.raw('PUT', `/api/rules/bad?${q()}`, { kind: 'symbol', symbol: 'createCharge', only: [PAYMENTS] });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/a file and a name/);
    const noOnly = await h.client.raw('PUT', `/api/rules/bad?${q()}`, { kind: 'symbol', symbol: SYMBOL });
    expect(noOnly.status).toBe(400);
  });
});
