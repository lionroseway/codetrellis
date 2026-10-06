/**
 * Phase 33 V1 — what a change does to the architecture, at the top of the
 * review, with or without a plan.
 *
 * An agent's branch, `payments`, adds a checkout page to the web app. It
 * imports the shared validators directly (across a rule the team keeps on
 * main), posts to /api/charges, and adds the stripe package to the web app
 * and to the API. The review names each before any text diff: the rule it
 * crosses, the new HTTP call, the two new packages, and the new import
 * between folders.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const PAGE = 'packages/web/src/Checkout.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@acme.test' };

interface Architecture { words: string[]; edgesKnown: boolean; packages: Array<{ manifest: string; added: string[] }>; calls: Array<{ what: string; file: string }> }

test.describe.serial('V1: what this change does to the architecture', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;
  let main: string;
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', env: ENV }).trim();

  test.beforeAll(async () => {
    h = await setupHarness('review-architecture');
    root = h.fixture.projectPath;
    // The team's rule, on main: the web app reads validation through the shared index, not its files.
    fs.mkdirSync(path.join(root, '.codetrellis', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codetrellis', 'rules', 'web.yaml'), [
      'suite: web', 'rules:',
      '  - id: web-through-shared-index', '    from: packages/web/', '    mayNotImport: packages/shared/src/validators.ts', '    strength: block',
      '    because: the web app imports validation from @sample/shared',
    ].join('\n'));
    git(root, 'add', '.codetrellis');
    git(root, 'commit', '-qm', 'Rule: web imports validation from the shared index');
    main = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');

    git(root, 'checkout', '-qb', 'payments');
    fs.writeFileSync(path.join(root, PAGE), [
      "import { validateEmail } from '../../shared/src/validators';",
      '',
      'export async function pay(email: string, cents: number) {',
      '  if (!validateEmail(email)) throw new Error(\'bad email\');',
      "  return fetch('/api/charges', {",
      "    method: 'POST',",
      '    body: JSON.stringify({ cents }),',
      '  });',
      '}',
      '',
    ].join('\n'));
    const pkg = path.join(root, 'packages', 'web', 'package.json');
    const j = JSON.parse(fs.readFileSync(pkg, 'utf-8'));
    j.dependencies.stripe = '^14.0.0';
    fs.writeFileSync(pkg, `${JSON.stringify(j, null, 2)}\n`);
    fs.appendFileSync(path.join(root, 'services', 'api', 'requirements.txt'), 'stripe>=8\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'Checkout with stripe');
    git(root, 'checkout', '-q', main);
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('review_change names the rule it crosses, the new call, the new packages and the new import between folders', async () => {
    const r = await agent.callTool('review_change', { base: main, head: 'payments', project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    const a = JSON.parse(r.answer) as Architecture;
    expect(a.edgesKnown).toBe(true);
    expect(a.words).toEqual(expect.arrayContaining([
      expect.stringMatching(/^✗ packages\/web\/src\/Checkout\.ts now imports packages\/shared\/src\/validators\.ts, which it forbids \(web-through-shared-index\)$/),
      expect.stringMatching(/^Adds an HTTP call to POST \/api\/charges \(packages\/web\/src\/Checkout\.ts:5\)$/),
      'Adds 1 npm package: stripe (packages/web/package.json)',
      'Adds 1 pip package: stripe (services/api/requirements.txt)',
      'packages/web → packages/shared: 1 import added',
    ]));
    // The rule's breach first: it is what a reviewer must see before anything else.
    expect(a.words[0]).toMatch(/^✗ /);

    const md = await agent.callTool('review_change', { base: main, head: 'payments', project_path: root, format: 'markdown' });
    expect(md.answer.split('\n')[0]).toBe('### What this change does to the architecture');
    expect(md.answer).toContain('- Adds 1 npm package: stripe (packages/web/package.json)');
  });

  test('the same over REST, and a ref that is not a commit is refused', async () => {
    const q = `project=${encodeURIComponent(root)}`;
    const res = await h.client.raw('GET', `/api/review/architecture?${q}&base=${main}&head=payments`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Architecture).words).toContain('Adds 1 pip package: stripe (services/api/requirements.txt)');
    expect((await h.client.raw('GET', `/api/review/architecture?${q}&base=no-such-branch&head=payments`)).status).toBe(400);
    expect((await h.client.raw('GET', `/api/review/architecture?${q}`)).status).toBe(400);
  });

  test('a plan\'s review opens with it, before its table; so does the pull request draft', async () => {
    const plan = await h.client.createPlan({ title: 'Checkout', projectPath: root, tasks: [] });
    const review = await agent.callTool('review_plan', { plan_uid: plan.uid, project_path: root, before: `commit:${main}`, after: 'commit:payments', format: 'markdown' });
    expect(review.isError, review.text).toBeFalsy();
    const lines = review.answer.split('\n');
    const section = lines.indexOf('### What this change does to the architecture');
    const table = lines.findIndex((l) => l.startsWith('| Landed'));
    expect(section).toBeGreaterThan(0);
    expect(section).toBeLessThan(table);

    const draft = await agent.callTool('get_pr_draft', { plan_uid: plan.uid, project_path: root, before: `commit:${main}`, after: 'commit:payments' });
    expect(draft.isError, draft.text).toBeFalsy();
    expect((JSON.parse(draft.answer) as { body: string }).body).toContain('### What this change does to the architecture');

    // Against live work there is no commit to compare: the section is absent, not empty.
    const live = await agent.callTool('review_plan', { plan_uid: plan.uid, project_path: root, format: 'markdown' });
    expect(live.answer).not.toContain('What this change does to the architecture');
  });
});
