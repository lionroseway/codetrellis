/**
 * Phase 33 V3 — re-review only what changed since each reviewer's last look.
 *
 * An agent's branch, `payments`, imports the shared validators directly,
 * across a rule the team keeps on main. A reviewer (an agent over MCP, then a
 * person over REST) reviews it and marks it reviewed. The agent pushes a fix
 * that goes through the shared index instead, and a new HTTP call. The next
 * review opens with what moved since: one file changed, the breach
 * addressed, the new call new. Each reviewer's look is their own.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const PAGE = 'packages/web/src/Checkout.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@acme.test' };

interface Since { changed: string[]; addressed: string[]; added: string[]; gone: boolean; words: string; mark: { commit: string; reviewer: string } }
interface Review { head: string; words: string[]; since?: Since }

const page = (importLine: string, extra: string[] = []) => [
  importLine,
  '',
  'export async function pay(email: string, cents: number) {',
  "  if (!validateEmail(email)) throw new Error('bad email');",
  "  return fetch('/api/charges', { method: 'POST', body: JSON.stringify({ cents }) });",
  '}',
  ...extra,
  '',
].join('\n');

test.describe.serial('V3: review since your last look', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;
  let main: string;
  let firstLook: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8', env: ENV }).trim();

  test.beforeAll(async () => {
    h = await setupHarness('review-since');
    root = h.fixture.projectPath;
    fs.mkdirSync(path.join(root, '.codetrellis', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codetrellis', 'rules', 'web.yaml'), [
      'suite: web', 'rules:',
      '  - id: web-through-shared-index', '    from: packages/web/', '    mayNotImport: packages/shared/src/validators.ts', '    strength: block',
      '    because: the web app imports validation from @sample/shared',
    ].join('\n'));
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rule: web imports validation from the shared index');
    main = git('rev-parse', '--abbrev-ref', 'HEAD');

    git('checkout', '-qb', 'payments');
    fs.writeFileSync(path.join(root, PAGE), page("import { validateEmail } from '../../shared/src/validators';"));
    git('add', '-A');
    git('commit', '-qm', 'Checkout');
    firstLook = git('rev-parse', 'HEAD');
    git('checkout', '-q', main);
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('a first review has nothing to compare with; marking it keeps the look', async () => {
    const r = await agent.callTool('review_change', { base: main, head: 'payments', project_path: root, mark_reviewed: true });
    expect(r.isError, r.text).toBeFalsy();
    const a = JSON.parse(r.answer) as Review;
    expect(a.since).toBeUndefined();
    expect(a.head).toBe(firstLook);
    expect(a.words[0]).toMatch(/^✗ packages\/web\/src\/Checkout\.ts now imports packages\/shared\/src\/validators\.ts/);

    // Asked again with nothing pushed: nothing changed.
    const again = JSON.parse((await agent.callTool('review_change', { base: main, head: 'payments', project_path: root })).answer) as Review;
    expect(again.since?.words).toBe(`Nothing changed since you looked at ${firstLook.slice(0, 7)}.`);
    expect(again.since?.addressed).toEqual([]);
  });

  test('after a push: the files that moved, the breach addressed, and what is new', async () => {
    git('checkout', '-q', 'payments');
    fs.writeFileSync(path.join(root, PAGE), page("import { validateEmail } from '@sample/shared';", [
      '',
      'export async function refund(id: string) {',
      "  return fetch(`/api/refunds/${id}`, { method: 'POST' });",
      '}',
    ]));
    git('commit', '-qam', 'Validate through the shared index; refunds');
    git('checkout', '-q', main);

    const r = await agent.callTool('review_change', { base: main, head: 'payments', project_path: root });
    const a = JSON.parse(r.answer) as Review;
    expect(a.since?.mark.commit).toBe(firstLook);
    expect(a.since?.changed).toEqual([PAGE]);
    expect(a.since?.addressed).toEqual([expect.stringMatching(/^✗ packages\/web\/src\/Checkout\.ts now imports packages\/shared\/src\/validators\.ts/)]);
    expect(a.since?.added).toEqual(expect.arrayContaining([expect.stringMatching(/HTTP call to POST \/api\/refunds/)]));
    expect(a.since?.words).toMatch(new RegExp(`^Since you looked at ${firstLook.slice(0, 7)}: 1 file changed, 1 finding addressed, \\d+ new\\.$`));

    // In markdown, the line opens the review.
    const md = await agent.callTool('review_change', { base: main, head: 'payments', project_path: root, format: 'markdown' });
    expect(md.answer.split('\n')[0]).toMatch(/^Since you looked at /);
  });

  test('each reviewer has their own look: a person over REST has none until they mark one', async () => {
    const q = `project=${encodeURIComponent(root)}`;
    const before = (await (await h.client.raw('GET', `/api/review/architecture?${q}&base=${main}&head=payments`)).json()) as Review;
    expect(before.since).toBeUndefined();

    const seen = await h.client.raw('POST', `/api/review/seen?${q}`, { base: main, head: 'payments' });
    expect(seen.status).toBe(200);
    const mark = (await seen.json()) as { commit: string; target: string; reviewerType: string };
    expect(mark.target).toBe('payments');
    expect(mark.commit).toBe(git('rev-parse', 'payments'));
    // Plain HTTP is not the app window: the look is kept, and says so.
    expect(mark.reviewerType).toBe('unverified');

    const after = (await (await h.client.raw('GET', `/api/review/architecture?${q}&base=${main}&head=payments`)).json()) as Review;
    expect(after.since?.words).toMatch(/^Nothing changed since you looked at /);

    expect((await h.client.raw('POST', `/api/review/seen?${q}`, { head: 'payments' })).status).toBe(400);
    expect((await h.client.raw('POST', `/api/review/seen?${q}`, { base: 'no-such-branch', head: 'payments' })).status).toBe(400);
  });

  test('history rewritten since the look: review the whole change again', async () => {
    git('checkout', '-q', 'payments');
    git('reset', '-q', '--hard', main);
    fs.writeFileSync(path.join(root, PAGE), page("import { validateEmail } from '@sample/shared';"));
    git('add', '-A');
    git('commit', '-qm', 'Checkout, again');
    git('reflog', 'expire', '--expire=now', '--all');
    git('gc', '-q', '--prune=now');
    git('checkout', '-q', main);

    const a = JSON.parse((await agent.callTool('review_change', { base: main, head: 'payments', project_path: root })).answer) as Review;
    expect(a.since?.gone).toBe(true);
    expect(a.since?.words).toMatch(new RegExp(`^The commit you looked at, ${firstLook.slice(0, 7)}, is no longer in the history`));
  });
});
