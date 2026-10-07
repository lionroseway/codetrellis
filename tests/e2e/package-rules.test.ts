/**
 * Phase 33 R5 — package rules (RULES-AND-CLARITY §3.1, the Stripe example).
 *
 * The team keeps money in one place. Two rules on main, set over REST the way
 * the app sets them:
 *  - only packages/web/src/payments.ts may import npm:stripe;
 *  - only services/api/app/billing.py may import pypi:stripe.
 * An agent's branch imports Stripe straight into the web app's API client and
 * into a Python route. The pipeline's check fails, naming each, in both
 * languages; the wrappers' own imports pass. Opened, the rules view shows
 * what breaks each today, from the scanned graph.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const WRAPPER = 'packages/web/src/payments.ts';
const API = 'packages/web/src/api.ts';
const BILLING = 'services/api/app/billing.py';
const ROUTE = 'services/api/app/routes/users.py';
const BECAUSE = 'The wrapper sets idempotency keys and retries.';

interface Gate { ok: boolean; says: string[]; rules: Array<{ path: string; imports: string; rule: string; words: string; because: string; strength: string }> }
interface RuleView { rule: { id: string; kind?: string; only?: string[] }; words: string; breaches: Array<{ from: string; to: string }> | null }

test.describe.serial('R5: only the wrapper may import Stripe', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let root: string;
  let main: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  const ct = (...args: string[]) => ctWith({}, ...args);
  const ctWith = (env: Record<string, string>, ...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args, '--data-dir', h.fixture.dataDir], {
      cwd: root, env: { ...(process.env as Record<string, string>), ...ENV, CLAUDECODE: '1', CODETRELLIS_AGENT: '', FORCE_COLOR: '', GITHUB_BASE_REF: '', ...env }, encoding: 'utf8', timeout: 120_000,
    });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const q = () => `project=${encodeURIComponent(root)}`;
  const rulesNow = async () => ((await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as { rules: RuleView[] }).rules;

  test.beforeAll(async () => {
    h = await setupHarness('package-rules');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    fs.writeFileSync(path.join(root, WRAPPER), "import Stripe from 'stripe';\n\nexport const stripe = new Stripe(process.env.STRIPE_KEY ?? '');\n");
    fs.writeFileSync(path.join(root, BILLING), 'import stripe\n\n\ndef charge(cents):\n    return stripe.Charge.create(amount=cents)\n');
    git('add', '-A');
    git('commit', '-qm', 'Payments wrappers');
    await h.client.scanProject(root);
    for (const [id, pkg, only] of [['stripe-via-wrapper', 'npm:stripe', WRAPPER], ['api-stripe-via-billing', 'pypi:stripe', BILLING]]) {
      const res = await h.client.raw('PUT', `/api/rules/${id}?${q()}`, { kind: 'package', package: pkg, only: [only], strength: 'block', because: BECAUSE, suite: 'payments' });
      expect(res.status, await res.clone().text()).toBe(200);
    }
    const suite = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'payments.yaml'), 'utf-8');
    expect(suite).toContain('kind: package');
    expect(suite).toContain('package: npm:stripe');
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rules: Stripe through the wrappers');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the rules say what they are, and nothing breaks them on main', async () => {
    const rules = await rulesNow();
    const stripe = rules.find((r) => r.rule.id === 'stripe-via-wrapper')!;
    expect(stripe.rule.kind).toBe('package');
    expect(stripe.words).toBe(`only ${WRAPPER} may import npm:stripe: ${BECAUSE}`);
    expect(stripe.breaches).toEqual([]);
    expect(rules.find((r) => r.rule.id === 'api-stripe-via-billing')!.breaches).toEqual([]);
  });

  test('the Rules view\'s summaries: each suite, whether it holds and its debt; the history of changes (G7)', async () => {
    const body = (await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as {
      suites: Array<{ suite: string; rules: number; breaches: number | null; debt: number; status: string; words: string }>;
      rules: Array<{ rule: { id: string }; debt: number }>;
    };
    expect(body.suites).toEqual([{ suite: 'payments', where: '.codetrellis/rules/payments.yaml', rules: 2, breaches: 0, debt: 0, status: 'holds', words: '2 rules · nothing breaks them today' }]);
    expect(body.rules.map((r) => r.debt)).toEqual([0, 0]);
    const history = ((await (await h.client.raw('GET', `/api/rules/history?${q()}`)).json()) as { history: Array<{ ruleId: string; change: string; words: string }> }).history;
    expect(history.map((e) => `${e.ruleId} ${e.change}`)).toEqual(['api-stripe-via-billing set', 'stripe-via-wrapper set']);
    expect(history[0].words).toMatch(/api-stripe-via-billing|pypi:stripe/);
  });

  test('a branch importing Stripe outside the wrappers fails the check, in TypeScript and in Python', async () => {
    git('checkout', '-qb', 'stripe-direct');
    const api = path.join(root, API);
    fs.writeFileSync(api, `import Stripe from 'stripe';\n${fs.readFileSync(api, 'utf-8')}`);
    const route = path.join(root, ROUTE);
    fs.writeFileSync(route, `import stripe\n${fs.readFileSync(route, 'utf-8')}`);
    // The wrapper importing more of Stripe is its own business.
    fs.appendFileSync(path.join(root, WRAPPER), "import type { Charge } from 'stripe/types';\nexport type { Charge };\n");
    git('commit', '-qam', 'Charge from the API client and the users route');

    const r = ct('check', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(3);
    const g = JSON.parse(r.out) as Gate;
    expect(g.ok).toBe(false);
    expect(g.rules).toEqual(expect.arrayContaining([
      { path: API, imports: 'npm:stripe', rule: 'stripe-via-wrapper', words: `only ${WRAPPER} may import npm:stripe`, because: BECAUSE, strength: 'block', suite: 'payments', fix: `use ${WRAPPER} instead`, line: 1, text: "import Stripe from 'stripe';" },
      { path: ROUTE, imports: 'pypi:stripe', rule: 'api-stripe-via-billing', words: `only ${BILLING} may import pypi:stripe`, because: BECAUSE, strength: 'block', suite: 'payments', fix: `use ${BILLING} instead`, line: 1, text: 'import stripe' },
    ]));
    expect(g.rules).toHaveLength(2);

    const text = ct('check', '--base', main);
    expect(text.code).toBe(3);
    // C8: by suite, then rule, then where, with what to do instead.
    expect(text.out).toContain([
      'payments  ✗ 2 block', '',
      `  ✗ api-stripe-via-billing   only ${BILLING} may import pypi:stripe: ${BECAUSE}`,
      `      ${ROUTE}:1 imports pypi:stripe   import stripe`,
      `      → use ${BILLING} instead`, '',
      `  ✗ stripe-via-wrapper   only ${WRAPPER} may import npm:stripe: ${BECAUSE}`,
      `      ${API}:1 imports npm:stripe   import Stripe from 'stripe';`,
      `      → use ${WRAPPER} instead`,
    ].join('\n'));
    expect(text.out).toMatch(/\n\n2 findings block this change \(exit 3\)\.$/);

    // C8: a pipe gets plain text (above); colour only when asked, and NO_COLOR wins. The words are the same.
    const coloured = ctWith({ FORCE_COLOR: '1' }, 'check', '--base', main);
    expect(coloured.out).toContain('\x1b[31m✗\x1b[0m');
    // eslint-disable-next-line no-control-regex
    expect(coloured.out.replace(/\x1b\[[0-9;]*m/g, '')).toBe(text.out);
    expect(ctWith({ FORCE_COLOR: '1', NO_COLOR: '1' }, 'check', '--base', main).out).toBe(text.out);
    expect(ctWith({ FORCE_COLOR: '1' }, 'check', '--base', main, '--no-color').out).toBe(text.out);

    // The same finding, as markdown for a pull request comment.
    const md = ct('check', '--base', main, '--format', 'markdown');
    expect(md.code).toBe(3);
    expect(md.out).toContain(`- ✗ **\`${API}:1 imports npm:stripe\`** · \`stripe-via-wrapper\` (block)  \n  only ${WRAPPER} may import npm:stripe: ${BECAUSE}  \n  → use ${WRAPPER} instead`);
  });

  test('opened on the branch, the rules view shows what breaks each today, from the graph', async () => {
    await h.client.scanProject(root);
    const rules = await rulesNow();
    expect(rules.find((r) => r.rule.id === 'stripe-via-wrapper')!.breaches).toEqual([{ rule: 'stripe-via-wrapper', from: API, to: 'npm:stripe' }]);
    expect(rules.find((r) => r.rule.id === 'api-stripe-via-billing')!.breaches).toEqual([{ rule: 'api-stripe-via-billing', from: ROUTE, to: 'pypi:stripe' }]);
  });

  test('a package rule needs its package and who may import it', async () => {
    const bad = await h.client.raw('PUT', `/api/rules/no-package?${q()}`, { kind: 'package', only: [WRAPPER] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/package must be an ecosystem and a name/);
  });
});
