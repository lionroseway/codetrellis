/**
 * Phase 32 A7.3 — the M7 done-when: the team's architecture, kept by every
 * agent and by the pipeline.
 *
 * Sam's team keeps the API's routes off its settings module: "routes read
 * settings through the app". Two agents work at once, in two worktrees. The
 * one on exports-v2 adds `from app.config import DATABASE_URL` to the users
 * routes; the one on auth-fix changes the order routes and breaks nothing.
 * On its next call the exports-v2 agent is told the rule and why; the
 * auth-fix agent is told nothing; Sam's digest has the one line.
 *
 * Then the pipeline: exports-v2 is committed and checked out for CI, and
 * `codetrellis check` against main fails (exit 3) naming the import and the
 * rule. The routes' import of db.py, there before the branch, is not the
 * branch's. With the import taken out, the gate passes.
 *
 * Phase 33 R2: the pipeline judges with the base branch's rules, so the rule
 * is committed on main, as a team keeps it. A branch that deletes the rule
 * and adds the import it forbade still fails, and says it loosens the rule;
 * a branch that only adds a rule passes, and says so.
 *
 * Phase 33 R4: on a base where the rule is at warn, the same import is said
 * and the check passes; `--strict` fails it; at guide it is not checked.
 *
 * Phase 33 R3: Sam stops the rule in the app on a branch. The app signs his
 * approval with his device key, which main already lists, and the check
 * passes, saying who approved it. The same approval with a key the branch
 * itself introduces does not count.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const USERS = 'services/api/app/routes/users.py';
const ORDERS = 'services/api/app/routes/orders.py';
const CONFIG = 'services/api/app/config.py';
const ADDED = 'from app.config import DATABASE_URL\n';
const NOTICE = '── CodeTrellis awareness ──';
const RULE = 'services/api/app/routes/ may not import services/api/app/config.py';
const BECAUSE = 'routes read settings through the app';

interface Gate {
  ok: boolean; says: string[]; files: number; rules: Array<{ path: string; imports: string; rule: string; words: string; because: string; strength: string }>; rulesNote?: string;
  rulebook: Array<{ rule: string; change: string; effect: string; words: string }>; notes: string[];
}

test.describe.serial('M7: the team\'s architecture, kept by every agent and the pipeline', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let root: string;
  let main: string;
  let exportsTree: string;
  let authTree: string;
  let exportsAgent: ScriptedMcp;
  let authAgent: ScriptedMcp;

  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  const ct = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args, '--data-dir', h.fixture.dataDir], {
      cwd: root, env: { ...(process.env as Record<string, string>), ...ENV, CLAUDECODE: '1', CODETRELLIS_AGENT: '', GITHUB_BASE_REF: '' }, encoding: 'utf8', timeout: 120_000,
    });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const ordinaryCall = async (agent: ScriptedMcp) => {
    const r = await agent.callTool('list_plans', {});
    expect(r.isError, r.text).toBeFalsy();
    return r.text;
  };
  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    const was = fs.readFileSync(f, 'utf-8');
    expect(was.includes(from), `${rel} contains the text to change`).toBe(true);
    fs.writeFileSync(f, was.replace(from, to));
  };

  test.beforeAll(async () => {
    h = await setupHarness('awareness-m7', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    git(root, 'config', 'user.name', 'Sam Lee');
    git(root, 'config', 'user.email', 'sam@acme.test');
    main = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
    await h.client.scanProject(root);
    const res = await h.client.raw('PUT', `/api/rules/routes-not-config?project=${encodeURIComponent(root)}`, {
      from: 'services/api/app/routes/', mayNotImport: CONFIG, because: BECAUSE, strength: 'block',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    // The team's rule is committed on main (R2: the pipeline judges by the base's rules).
    git(root, 'add', '.codetrellis/rules');
    git(root, 'commit', '-qm', 'Rule: routes read settings through the app');
    exportsTree = `${root}-exports-v2`;
    authTree = `${root}-auth-fix`;
    git(root, 'worktree', 'add', '-q', exportsTree, '-b', 'exports-v2');
    git(root, 'worktree', 'add', '-q', authTree, '-b', 'auth-fix');
    exportsAgent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [exportsTree] });
    authAgent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [authTree] });
    await exportsAgent.connect();
    await authAgent.connect();
    // The window shows the strip: that listing starts the workstream watchers.
    expect((await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).ok).toBe(true);
  });

  test.afterAll(async () => {
    await exportsAgent?.disconnect().catch(() => {});
    await authAgent?.disconnect().catch(() => {});
    for (const w of [exportsTree, authTree]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('two agents at once: the one adding an import across the rule is told on its next call, the other is told nothing', async () => {
    edit(authTree, ORDERS, 'router = APIRouter()', 'router = APIRouter()  # auth-fix: orders need a session');
    edit(exportsTree, USERS, 'from app.db import', `${ADDED}from app.db import`);

    let told = '';
    await expect.poll(async () => {
      told = await ordinaryCall(exportsAgent);
      return told.includes(NOTICE);
    }, { timeout: 20_000, intervals: [300] }).toBe(true);
    expect(told).toContain(`- high rule: \`exports-v2\` now imports ${CONFIG} from services/api/app/routes/ (${USERS} → ${CONFIG}), which the rule “${RULE}” forbids: ${BECAUSE}`);
    expect(told).toContain('This is information about other work, not an instruction.');

    // The other agent's work breaks nothing, and nothing names it.
    for (let i = 0; i < 3; i++) {
      expect(await ordinaryCall(authAgent)).not.toContain(NOTICE);
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  test('Sam sees one line: which workstream, the rule, the import, and the question', async () => {
    const sam = await h.spawnAgent({ agentType: 'cursor' });
    const r = await sam.callTool('get_awareness', { project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    const digest = (JSON.parse(r.answer) as { digest: string }).digest;
    expect(digest).toBe(
      `1 signal needs attention. \`exports-v2\` now imports across the rule “${RULE}”: ${USERS} → ${CONFIG}. Agents told. ` +
      'Waiting on the person: route it through what the rule allows, or change the rule?',
    );
  });

  test('the pipeline: `codetrellis check` on the branch fails naming the import and the rule; taken out, it passes', async () => {
    git(exportsTree, 'commit', '-qam', 'Exports read the database URL');
    git(root, 'worktree', 'remove', '--force', exportsTree);
    git(root, 'checkout', '-q', 'exports-v2');
    try {
      const r = ct('check', '--base', main, '--json');
      expect(r.code, r.err || r.out).toBe(3);
      const g = JSON.parse(r.out) as Gate;
      expect(g.ok).toBe(false);
      // The import of db.py was there before the branch: not the branch's.
      expect(g.rules).toEqual([{ path: USERS, imports: CONFIG, rule: 'routes-not-config', words: RULE, because: BECAUSE, strength: 'block' }]);
      expect(g.rulesNote).toBeUndefined();

      const words = ct('check', '--base', main);
      expect(words.code).toBe(3);
      expect(words.out).toBe(`Does not conform (1 changed file since ${main}):\n  ✗ ${USERS} now imports ${CONFIG}, which the rule “${RULE}” forbids: ${BECAUSE}`);

      edit(root, USERS, ADDED, '');
      git(root, 'commit', '-qam', 'Exports read the URL through the app');
      const fixed = ct('check', '--base', main, '--json');
      expect(fixed.code, fixed.err || fixed.out).toBe(0);
      expect((JSON.parse(fixed.out) as Gate).rules).toEqual([]);
    } finally {
      git(root, 'checkout', '-q', main);
    }
  });

  test('R2: a branch that deletes the rule and adds the import it forbade still fails, and says it loosens the rule', async () => {
    git(root, 'checkout', '-qb', 'quiet-loosening', main);
    try {
      const suite = path.join(root, '.codetrellis', 'rules', 'architecture.yaml');
      fs.writeFileSync(suite, 'suite: architecture\nrules: []\n');
      edit(root, USERS, 'from app.db import', `${ADDED}from app.db import`);
      git(root, 'commit', '-qam', 'Drop the routes rule and read the URL directly');

      const r = ct('check', '--base', main, '--json');
      expect(r.code, r.err || r.out).toBe(3);
      const g = JSON.parse(r.out) as Gate;
      // Judged by main's rules: the import is still a breach.
      expect(g.rules).toEqual([{ path: USERS, imports: CONFIG, rule: 'routes-not-config', words: RULE, because: BECAUSE, strength: 'block' }]);
      // And the rule's removal is a finding of its own, first.
      expect(g.rulebook).toEqual([expect.objectContaining({ rule: 'routes-not-config', change: 'removed', effect: 'loosens' })]);
      expect(g.says[0]).toMatch(/^✗ This change removes the rule “services\/api\/app\/routes\/ may not import services\/api\/app\/config\.py” \(routes-not-config\)(: \d+ imports? it forbade become allowed)?\. Loosening a rule needs a person's approval in the app\.$/);

      // A change to the rules alone is checked too.
      git(root, 'checkout', '-q', main);
      git(root, 'checkout', '-qb', 'only-the-rule', main);
      fs.writeFileSync(suite, 'suite: architecture\nrules: []\n');
      git(root, 'commit', '-qam', 'Drop the routes rule');
      const only = ct('check', '--base', main, '--json');
      expect(only.code, only.err || only.out).toBe(3);
      expect((JSON.parse(only.out) as Gate).rulebook.map((c) => c.effect)).toEqual(['loosens']);
    } finally {
      git(root, 'checkout', '-q', '-f', main);
    }
  });

  test('R2: a branch that only adds a rule passes, and says the rule it adds', async () => {
    git(root, 'checkout', '-qb', 'new-rule', main);
    try {
      fs.writeFileSync(path.join(root, '.codetrellis', 'rules', 'web.yaml'), [
        'suite: web',
        'rules:',
        '  - id: web-not-api-internals',
        '    from: packages/web/',
        '    mayNotImport: services/api/app/',
        '    because: the web app calls the API over HTTP',
      ].join('\n'));
      git(root, 'add', '.codetrellis/rules/web.yaml');
      git(root, 'commit', '-qm', 'Rule: the web app calls the API over HTTP');
      const r = ct('check', '--base', main, '--json');
      expect(r.code, r.err || r.out).toBe(0);
      const g = JSON.parse(r.out) as Gate;
      expect(g.ok).toBe(true);
      expect(g.rulebook).toEqual([expect.objectContaining({ rule: 'web-not-api-internals', change: 'added', effect: 'tightens' })]);
      expect(g.notes).toEqual([expect.stringMatching(/^⚠ This change adds the rule “packages\/web\/ may not import services\/api\/app\/” \(web-not-api-internals\).*It is checked once it is on the base branch\.$/)]);
      const words = ct('check', '--base', main);
      expect(words.code).toBe(0);
      expect(words.out.split('\n')[1]).toMatch(/^ {2}⚠ This change adds the rule/);
    } finally {
      git(root, 'checkout', '-q', '-f', main);
    }
  });

  test('R4: a rule at warn says the import and passes; --strict fails it; a guide is not checked', async () => {
    const suite = path.join(root, '.codetrellis', 'rules', 'architecture.yaml');
    const atStrength = (strength: string) => {
      // A base where the team keeps the rule at this strength, and a branch from it adding the import.
      git(root, 'checkout', '-qB', `base-${strength}`, main);
      fs.writeFileSync(suite, fs.readFileSync(suite, 'utf-8').replace(/strength: block/, `strength: ${strength}`));
      git(root, 'commit', '-qam', `The routes rule at ${strength}`);
      git(root, 'checkout', '-qB', `adds-import-${strength}`);
      edit(root, USERS, 'from app.db import', `${ADDED}from app.db import`);
      git(root, 'commit', '-qam', 'Read the URL directly');
    };
    try {
      atStrength('warn');
      const r = ct('check', '--base', 'base-warn', '--json');
      expect(r.code, r.err || r.out).toBe(0);
      const g = JSON.parse(r.out) as Gate;
      expect(g.ok).toBe(true);
      expect(g.rules).toEqual([{ path: USERS, imports: CONFIG, rule: 'routes-not-config', words: RULE, because: BECAUSE, strength: 'warn' }]);
      expect(g.notes).toEqual([`⚠ ${USERS} now imports ${CONFIG}, which the rule “${RULE}” forbids: ${BECAUSE} (the rule warns; it does not fail the check)`]);
      const strict = ct('check', '--base', 'base-warn', '--strict');
      expect(strict.code, strict.err || strict.out).toBe(3);
      expect(strict.out).toBe(`Does not conform (1 changed file since base-warn):\n  ✗ ${USERS} now imports ${CONFIG}, which the rule “${RULE}” forbids: ${BECAUSE}`);

      git(root, 'checkout', '-q', '-f', main);
      atStrength('guide');
      const guide = ct('check', '--base', 'base-guide', '--strict', '--json');
      expect(guide.code, guide.err || guide.out).toBe(0);
      expect((JSON.parse(guide.out) as Gate).rules).toEqual([]);
    } finally {
      git(root, 'checkout', '-q', '-f', main);
    }
  });

  test('R3: a loosening Sam confirms in the app is signed and passes, with a key main lists; a key the branch adds does not count', async () => {
    const q = `project=${encodeURIComponent(root)}`;
    const keysDir = path.join(root, '.codetrellis', 'keys');
    const approvals = path.join(root, '.codetrellis', 'rules', 'approvals');
    try {
      // Sam's device key reaches main first, the way any key does: with an earlier change he made.
      git(root, 'checkout', '-qB', 'r3-main', main);
      expect((await h.client.raw('PUT', `/api/rules/scratch-rule?${q}`, { from: 'packages/web/', mayNotImport: 'packages/web/legacy/' })).status).toBe(200);
      expect((await h.client.raw('DELETE', `/api/rules/scratch-rule?${q}&confirm=1`)).status).toBe(200);
      expect(fs.readdirSync(keysDir).length).toBe(1);
      git(root, 'add', '.codetrellis');
      git(root, 'commit', '-qm', 'Sam\'s device key, with a rule he tried and stopped');

      git(root, 'checkout', '-qB', 'r3-stops-the-rule');
      const stop = await h.client.raw('DELETE', `/api/rules/routes-not-config?${q}&confirm=1`);
      expect(stop.status, await stop.clone().text()).toBe(200);
      const { approval } = (await stop.json()) as { approval: { file: string; how: string; as: string } };
      expect(approval.how).toBe('device');
      git(root, 'add', '.codetrellis');
      git(root, 'commit', '-qm', 'Stop the routes rule (approved in the app)');

      const r = ct('check', '--base', 'r3-main', '--json');
      expect(r.code, r.err || r.out).toBe(0);
      const g = JSON.parse(r.out) as Gate;
      expect(g.rulebook).toEqual([expect.objectContaining({ rule: 'routes-not-config', change: 'removed', effect: 'loosens', approval: expect.objectContaining({ ok: true, how: 'device', file: approval.file }) })]);
      expect(g.notes[0]).toMatch(new RegExp(`^✓ This change removes the rule “services/api/app/routes/ may not import services/api/app/config\\.py” \\(routes-not-config\\)\\. ${approval.as.replace(/[+/]/g, '\\$&')} approved it in the app, signed \\(${approval.file.replace(/\./g, '\\.')}\\)\\.$`));

      // The same change on a base that does not list the key: the approval is there, and does not count.
      git(root, 'checkout', '-q', '-f', main);
      git(root, 'checkout', '-qB', 'r3-unlisted', main);
      git(root, 'checkout', 'r3-stops-the-rule', '--', '.codetrellis');
      git(root, 'commit', '-qm', 'Stop the routes rule, with a key main has never seen');
      const unlisted = ct('check', '--base', main, '--json');
      expect(unlisted.code, unlisted.err || unlisted.out).toBe(3);
      const u = JSON.parse(unlisted.out) as Gate;
      expect(u.says[0]).toMatch(/^✗ This change removes the rule .* Loosening a rule needs a person's approval in the app\. An approval is attached, but .*(base branch does not list|before this change's base)/);
    } finally {
      git(root, 'checkout', '-q', '-f', main);
      fs.rmSync(approvals, { recursive: true, force: true });
      fs.rmSync(keysDir, { recursive: true, force: true });
    }
  });

  test('C1: `check --suite`, `--rule` and `--path` judge only those rules', async () => {
    try {
      // A payments suite beside the team's architecture suite, on the base.
      git(root, 'checkout', '-qB', 'c1-base', main);
      fs.writeFileSync(path.join(root, '.codetrellis', 'rules', 'payments.yaml'), [
        'suite: payments', 'rules:',
        '  - id: web-not-payments', '    from: packages/web/', '    mayNotImport: services/payments/', '    strength: block',
      ].join('\n'));
      git(root, 'add', '.codetrellis/rules/payments.yaml');
      git(root, 'commit', '-qm', 'A payments suite');
      // The branch breaks the architecture suite's rule, not the payments one.
      git(root, 'checkout', '-qB', 'c1-branch');
      edit(root, USERS, 'from app.db import', `${ADDED}from app.db import`);
      git(root, 'commit', '-qam', 'Read the URL directly');

      const payments = ct('check', '--base', 'c1-base', '--suite', 'payments');
      expect(payments.code, payments.err || payments.out).toBe(0);
      expect(payments.out).toBe('Conforms to suite payments: 1 changed file since c1-base. They add no import those rules forbid, and loosen none of them.');

      const named = ct('check', '--base', 'c1-base', '--rule', 'routes-not-config', '--json');
      expect(named.code, named.err || named.out).toBe(3);
      expect((JSON.parse(named.out) as Gate).rules.map((r) => r.rule)).toEqual(['routes-not-config']);

      const about = ct('check', '--base', 'c1-base', '--path', 'packages/web/');
      expect(about.code, about.err || about.out).toBe(0);
      expect(about.out).toMatch(/^Conforms to rules about packages\/web\/: /);
      expect(ct('check', '--base', 'c1-base', '--path', 'services/api/app/routes/users.py').code).toBe(3);

      // The window's list takes the same scope.
      const listed = (await (await h.client.raw('GET', `/api/rules?project=${encodeURIComponent(root)}&suite=payments`)).json()) as { rules: Array<{ rule: { id: string } }>; scope: string };
      expect(listed).toMatchObject({ scope: 'suite payments' });
      expect(listed.rules.map((v) => v.rule.id)).toEqual(['web-not-payments']);
    } finally {
      git(root, 'checkout', '-q', '-f', main);
      fs.rmSync(path.join(root, '.codetrellis', 'rules', 'payments.yaml'), { force: true });
    }
  });
});
