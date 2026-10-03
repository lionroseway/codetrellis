/**
 * Phase 32 A7.2 — rule signals, against a real backend and a real worktree.
 *
 * Sam's team keeps the API's routes off its settings module ("routes read
 * settings through the app"), and off the database layer, which they already
 * import today. On the exports-v2 worktree an agent adds `from app.config
 * import DATABASE_URL` to routes/users.py: one high `rule` signal names the
 * workstream, the rule, why, and the import. The routes' import of db.py,
 * there before the branch, raises nothing, though users.py changed. The agent
 * working in exports-v2 is told on its next call, unasked. Taken out again,
 * the signal resolves.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';
import type { AwarenessSignal } from '../../src/shared/types';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const USERS = 'services/api/app/routes/users.py';
const ADDED = 'from app.config import DATABASE_URL\n';
const NOTICE = '── CodeTrellis awareness ──';

test.describe.serial('Rule signals', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let root: string;
  let tree: string;
  let original: string;
  let worker: ScriptedMcp; // the agent working in exports-v2

  const q = () => `project=${encodeURIComponent(root)}`;
  const ruleSignals = async () => {
    await h.client.raw('GET', `/api/workstreams?${q()}`);
    const body = (await (await h.client.raw('GET', `/api/awareness?fresh=1&${q()}`)).json()) as { signals: AwarenessSignal[] };
    return body.signals.filter((s) => s.kind === 'rule' && s.state !== 'resolved');
  };

  test.beforeAll(async () => {
    h = await setupHarness('rule-signals', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    for (const [id, body] of [
      ['routes-not-config', { from: 'services/api/app/routes/', mayNotImport: 'services/api/app/config.py', because: 'routes read settings through the app' }],
      ['routes-not-db', { from: 'services/api/app/routes/', mayNotImport: 'services/api/app/db.py', because: 'routes go through the service layer' }],
    ] as const) {
      const res = await h.client.raw('PUT', `/api/rules/${id}?${q()}`, body);
      expect(res.status, await res.clone().text()).toBe(200);
    }
    tree = `${root}-exports-v2`;
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', tree, '-b', 'exports-v2'], { env: ENV });
    original = fs.readFileSync(path.join(tree, USERS), 'utf-8');
    worker = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [tree] });
    await worker.connect();
  });

  test.afterAll(async () => {
    await worker?.disconnect().catch(() => {});
    try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', tree]); } catch { /* */ }
    await h?.teardown();
  });

  test('nothing in flight, nothing said: the imports already there are the rule\'s to list, not a signal', async () => {
    fs.writeFileSync(path.join(tree, USERS), `${original}\n# exports: a comment only\n`);
    await expect.poll(async () => ((await (await h.client.raw('GET', `/api/workstreams?${q()}`)).json()) as Array<{ root: string; changes: { files: unknown[] } }>)
      .find((w) => w.root === tree)?.changes.files.length ?? 0, { timeout: 15_000 }).toBe(1);
    expect(await ruleSignals()).toEqual([]);
  });

  test('a worktree adding a forbidden import: one high signal naming the workstream, the rule, why, and the import', async () => {
    fs.writeFileSync(path.join(tree, USERS), original.replace('from app.db import', `${ADDED}from app.db import`));
    await expect.poll(async () => (await ruleSignals()).length, { timeout: 20_000 }).toBe(1);
    const [s] = await ruleSignals();
    expect(s).toMatchObject({ kind: 'rule', severity: 'high', workstreams: [tree] });
    expect(s.subject.rule).toEqual({ id: 'routes-not-config', words: 'services/api/app/routes/ may not import services/api/app/config.py', because: 'routes read settings through the app' });
    expect(s.subject.edges).toEqual([{ from: USERS, to: 'services/api/app/config.py' }]);
    expect(s.summary).toBe('`exports-v2` now imports services/api/app/config.py from services/api/app/routes/ (services/api/app/routes/users.py → services/api/app/config.py), which the rule “services/api/app/routes/ may not import services/api/app/config.py” forbids: routes read settings through the app');
    // The agent in exports-v2 is told on its next call, without asking.
    let told = '';
    await expect.poll(async () => {
      const r = await worker.callTool('list_plans', {});
      told = r.text;
      return told.includes(NOTICE);
    }, { timeout: 15_000, intervals: [300] }).toBe(true);
    expect(told).toContain(`- high rule: ${s.summary}`);
    // The digest an agent gets says it in one line.
    const agent = await h.spawnAgent({ agentType: 'cursor' });
    const r = await agent.callTool('get_awareness', { project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toContain('`exports-v2` now imports across the rule “services/api/app/routes/ may not import services/api/app/config.py”: services/api/app/routes/users.py → services/api/app/config.py');
  });

  test('taken out again, the signal resolves', async () => {
    fs.writeFileSync(path.join(tree, USERS), original);
    await expect.poll(async () => (await ruleSignals()).length, { timeout: 20_000 }).toBe(0);
  });
});
