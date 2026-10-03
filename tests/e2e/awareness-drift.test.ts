/**
 * The drift signal (Phase 32 A2.5), end to end: an agent bound to a real
 * worktree claims an Action over MCP, and edits inside and outside the files
 * that Action names.
 *
 * Inside the claimed item's files, nothing is said. A file outside them is a
 * medium drift signal naming the file and the item; declaring an intent that
 * covers it brings it back into scope, and the signal resolves.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

interface Signal { id: string; kind: string; severity: string; summary: string; subject: { files?: string[]; items?: string[] }; workstreams: string[] }

const VALIDATORS = 'packages/shared/src/validators.ts';
const API = 'packages/web/src/api.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Drift signals', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let agent: ScriptedMcp;
  let itemUid: string;

  const drift = async () => {
    const res = await h.client.raw('GET', `/api/awareness?fresh=1&project=${encodeURIComponent(root)}`);
    return ((await res.json()) as { signals: Signal[] }).signals.filter((s) => s.kind === 'drift');
  };
  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);
  const append = (rel: string, text: string) => fs.appendFileSync(path.join(billing, rel), text);

  test.beforeAll(async () => {
    h = await setupHarness('awareness-drift', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', billing, '-b', 'billing-v2'], { env: ENV });
    await h.client.scanProject(root);
    const plan = (await h.client.createPlan({ title: 'Validation', projectPath: root })).uid;
    const res = await h.client.raw('POST', `/api/plans/${plan}/items`, {
      kind: 'action', title: 'Tighten the validators', fileSpecs: [{ path: VALIDATORS, action: 'modify' }],
    });
    itemUid = ((await res.json()) as { uid: string }).uid;
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [billing] });
    await agent.connect();
    const claimed = await agent.callTool('claim_item', { uid: itemUid });
    expect(claimed.isError, claimed.text).toBeFalsy();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', billing]); } catch { /* */ }
    await h?.teardown();
  });

  test('editing the claimed item\'s own file says nothing', async () => {
    append(VALIDATORS, '\nexport const STRICT = true;\n');
    await new Promise((r) => setTimeout(r, 600));
    expect(await drift()).toEqual([]);
  });

  test('a file outside it is medium drift, naming the file and the item, and the agent is told', async () => {
    append(API, '\n// billing-v2 reaches into the web client\n');
    // The watcher settles the edit first (debounced).
    await expect.poll(async () => (await drift()).length, { timeout: 10_000 }).toBe(1);
    const [d] = await drift();
    expect(d.severity).toBe('medium');
    expect(d.subject).toEqual({ files: [API], items: [itemUid] });
    expect(d.summary).toBe(`\`billing-v2\` changes 1 file outside the scope its claimed item gives it: ${API}`);
    expect(same(d.workstreams[0], billing)).toBe(true);

    const told = JSON.parse((await agent.callTool('get_awareness', {})).text) as { signals: Signal[] };
    expect(told.signals.map((s) => `${s.severity} ${s.kind}`)).toContain('medium drift');
  });

  test('declaring an intent that covers the file brings it into scope, and the signal resolves', async () => {
    const r = await agent.callTool('declare_intent', { summary: 'The web client needs the strict flag too', paths: [API] });
    expect(r.isError, r.text).toBeFalsy();
    await expect.poll(async () => (await drift()).length, { timeout: 10_000 }).toBe(0);
  });

  test('with the intent withdrawn and the item done, there is no scope, so nothing to drift from', async () => {
    await agent.callTool('declare_intent', { summary: 'done', clear: true });
    await expect.poll(async () => (await drift()).length, { timeout: 10_000 }).toBe(1);
    const done = await h.client.raw('PUT', `/api/items/${itemUid}`, { status: 'done' });
    expect(done.ok).toBe(true);
    await expect.poll(async () => (await drift()).length, { timeout: 10_000 }).toBe(0);
  });
});
