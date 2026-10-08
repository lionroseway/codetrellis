/**
 * Phase 33 follow-up to B6 — rule tags, and what selects by them.
 *
 * Two rules on main: Stripe only through the payments wrapper, tagged `pci`,
 * and axios only through the HTTP client, untagged. A pipeline runs the `pci`
 * rules in a stage of their own. A branch imports both packages into the API
 * client. `check --tag pci` and the pipeline's `pci` stage find the Stripe
 * import and not the axios one; the Rules view lists the tagged rule under
 * `?tag=pci`. A branch dropping the tag is refused as a loosening: the rule
 * would leave the stage that selected it.
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
const CLIENT = 'packages/web/src/http.ts';
const API = 'packages/web/src/api.ts';
const PIPELINE = 'stages:\n  - id: pci\n    rules: { tag: pci }\n  - id: rest\n    rules: { id: axios-via-client }\n    parallel: true\n';

interface Gate { ok: boolean; rules: Array<{ path: string; imports: string; rule: string }>; rulebook: Array<{ rule: string; effect: string; words: string }> }
interface Piped { ok: boolean; stages: Array<{ id: string; ran: boolean; ok: boolean; gate?: Gate }> }
interface RuleView { rule: { id: string; tags?: string[] } }

test.describe.serial('Rule tags: a check, a stage and the Rules view select by them; dropping one is a loosening', () => {
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
    h = await setupHarness('rule-tags');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    write(WRAPPER, "import Stripe from 'stripe';\n\nexport const stripe = new Stripe(process.env.STRIPE_KEY ?? '');\n");
    write(CLIENT, "import axios from 'axios';\n\nexport const http = axios.create();\n");
    write('.codetrellis/pipeline.yaml', PIPELINE);
    git('add', '-A');
    git('commit', '-qm', 'Wrappers, and a pipeline with a pci stage');
    await h.client.scanProject(root);
    const rules: Array<[string, Record<string, unknown>]> = [
      ['stripe-via-wrapper', { kind: 'package', package: 'npm:stripe', only: [WRAPPER], strength: 'block', tags: ['pci', 'payments'], suite: 'payments' }],
      ['axios-via-client', { kind: 'package', package: 'npm:axios', only: [CLIENT], strength: 'block', suite: 'payments' }],
    ];
    for (const [id, body] of rules) {
      const res = await h.client.raw('PUT', `/api/rules/${id}?${q()}`, body);
      expect(res.status, await res.clone().text()).toBe(200);
    }
    expect(fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'payments.yaml'), 'utf-8')).toMatch(/tags:\n\s+- payments\n\s+- pci/);
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rules: Stripe and axios through their wrappers');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the Rules view lists a rule\'s tags, and only the tagged rules under ?tag=', async () => {
    const all = ((await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as { rules: RuleView[] }).rules;
    expect(all.find((r) => r.rule.id === 'stripe-via-wrapper')!.rule.tags).toEqual(['payments', 'pci']);
    const res = await (await h.client.raw('GET', `/api/rules?${q()}&tag=pci`)).json() as { rules: RuleView[]; scope: string };
    expect(res.rules.map((r) => r.rule.id)).toEqual(['stripe-via-wrapper']);
    expect(res.scope).toBe('tag pci');
  });

  test('a branch importing both: --tag pci and the pipeline\'s pci stage hold the Stripe import, and not the axios one', async () => {
    git('checkout', '-qb', 'both-direct');
    const api = path.join(root, API);
    fs.writeFileSync(api, `import Stripe from 'stripe';\nimport axios from 'axios';\n${fs.readFileSync(api, 'utf-8')}`);
    git('commit', '-qam', 'Stripe and axios straight from the API client');

    const all = JSON.parse(ct('check', '--base', main, '--json').out) as Gate;
    expect(all.rules.map((r) => r.rule).sort()).toEqual(['axios-via-client', 'stripe-via-wrapper']);

    const tagged = ct('check', '--base', main, '--tag', 'pci', '--json');
    expect(tagged.code, tagged.err || tagged.out).toBe(3);
    expect((JSON.parse(tagged.out) as Gate).rules.map((r) => `${r.path} ${r.imports} ${r.rule}`)).toEqual([`${API} npm:stripe stripe-via-wrapper`]);

    const piped = ct('check', '--pipeline', '--stage', 'pci', '--base', main, '--json');
    expect(piped.code, piped.err || piped.out).toBe(3);
    const pci = (JSON.parse(piped.out) as Piped).stages.find((s) => s.id === 'pci')!;
    expect(pci.ran).toBe(true);
    expect(pci.gate!.rules.map((r) => r.rule)).toEqual(['stripe-via-wrapper']);
  });

  test('a branch dropping the pci tag is refused as a loosening: the rule would leave the pci stage', async () => {
    git('checkout', '-q', main);
    git('checkout', '-qb', 'untag');
    const suite = path.join(root, '.codetrellis', 'rules', 'payments.yaml');
    fs.writeFileSync(suite, fs.readFileSync(suite, 'utf-8').replace(/\n(\s+)- pci\n/, '\n'));
    git('commit', '-qam', 'Untag the Stripe rule');

    const r = ct('check', '--base', main, '--json');
    expect(r.code, r.err || r.out).toBe(3);
    const g = JSON.parse(r.out) as Gate;
    expect(g.rulebook.map((c) => `${c.rule} ${c.effect}`)).toEqual(['stripe-via-wrapper loosens']);
    expect(g.rulebook[0].words).toContain('Loosening a rule needs a person\'s approval in the app.');
    git('checkout', '-q', main);
  });
});
