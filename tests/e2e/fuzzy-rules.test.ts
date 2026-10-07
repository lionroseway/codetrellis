/**
 * Phase 33 B3 — fuzzy matching (BUILDING-BLOCKS.md §B3).
 *
 * The team uses `requests`. A package one letter-swap away is how a
 * typosquat gets in, so one rule says no look-alike of it may be imported,
 * at the default threshold, set over REST the way the app sets it.
 *
 * A branch imports `reqeusts` in a route. The check fails on that line and
 * says how alike it is and to what, `0.88 like pypi:requests`, the same on
 * every run. The real `requests`, imported beside it, is not a look-alike of
 * itself.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const ROUTE = 'services/api/app/routes/users.py';

interface Gate { ok: boolean; says: string[]; rules: Array<{ path: string; imports: string; rule: string; fix?: string | null; line?: number | null }> }
interface RuleView { rule: { id: string; match?: string; threshold?: number }; words: string }

test.describe.serial('B3: a look-alike of a package the team uses is reported with how alike it is', () => {
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

  test.beforeAll(async () => {
    h = await setupHarness('fuzzy-rules');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    await h.client.scanProject(root);
    const res = await h.client.raw('PUT', `/api/rules/no-requests-lookalikes?${q()}`, {
      kind: 'package', package: { match: 'fuzzy', value: 'pypi:requests' }, strength: 'block', because: 'A package one typo from a real one is how a typosquat gets in.', suite: 'supply',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const suite = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'supply.yaml'), 'utf-8');
    expect(suite).toContain('package: pypi:requests');
    expect(suite).toContain('match: fuzzy');
    expect(suite).toContain('threshold: 0.85');
    expect(suite).toContain('only: []');
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rules: no look-alikes of requests');
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('the rule says what it catches and how alike', async () => {
    const rules = ((await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as { rules: RuleView[] }).rules;
    const r = rules.find((x) => x.rule.id === 'no-requests-lookalikes')!;
    expect(r.rule.match).toBe('fuzzy');
    expect(r.rule.threshold).toBe(0.85);
    expect(r.words).toBe('nothing may import a look-alike of pypi:requests (0.85 or closer): A package one typo from a real one is how a typosquat gets in.');
  });

  test('a branch importing reqeusts fails on that line, 0.88 like pypi:requests, the same on every run; requests itself passes', async () => {
    git('checkout', '-qb', 'typo');
    const text = fs.readFileSync(path.join(root, ROUTE), 'utf-8');
    fs.writeFileSync(path.join(root, ROUTE), `import requests\nimport reqeusts\n\n\n${text}`);
    git('add', '-A');
    git('commit', '-qm', 'Fetch users');

    const runs = [ct('check', '--base', main, '--json'), ct('check', '--base', main, '--json')];
    for (const r of runs) expect(r.code, r.err || r.out).toBe(3);
    const [a, b] = runs.map((r) => (JSON.parse(r.out) as Gate).rules.map((x) => ({ path: x.path, imports: x.imports, rule: x.rule, fix: x.fix, line: x.line })));
    expect(a).toEqual([{ path: ROUTE, imports: 'pypi:reqeusts', rule: 'no-requests-lookalikes', fix: 'pypi:reqeusts is 0.88 like pypi:requests: did you mean it?', line: 2 }]);
    expect(b).toEqual(a);
    expect((JSON.parse(runs[0].out) as Gate).says).toContain(`✗ ${ROUTE} now imports pypi:reqeusts, which the rule “nothing may import a look-alike of pypi:requests (0.85 or closer)” forbids: A package one typo from a real one is how a typosquat gets in.`);
  });
});
