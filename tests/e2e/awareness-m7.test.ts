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

interface Gate { ok: boolean; says: string[]; files: number; rules: Array<{ path: string; imports: string; rule: string; words: string; because: string }>; rulesNote?: string }

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
      from: 'services/api/app/routes/', mayNotImport: CONFIG, because: BECAUSE,
    });
    expect(res.status, await res.clone().text()).toBe(200);
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
    const digest = (JSON.parse(r.text) as { digest: string }).digest;
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
      expect(g.rules).toEqual([{ path: USERS, imports: CONFIG, rule: 'routes-not-config', words: RULE, because: BECAUSE }]);
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
});
