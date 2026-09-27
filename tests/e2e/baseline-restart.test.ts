/**
 * The baseline survives a restart (Phase 32 §0.6, bug 9).
 *
 * It lived only in memory, so a restart dropped it and the next scan
 * captured whatever the tree held at launch: "diff since baseline"
 * silently became "diff since this launch", and a pinned commit was
 * forgotten. Now it is stored per project and restored when the project
 * is scanned again — and clearing it clears the stored copy too, so the
 * next scan really does set a new one, as `set_baseline` says.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  setupHarness, startBackend, createClient, createScriptedAgent,
  type Harness, type RunningBackend,
} from '../harness';

interface Baseline { commitHash: string | null; source: string; capturedAt: number }

test.describe.serial('Baseline across a restart', () => {
  test.setTimeout(180_000);

  let h: Harness;
  let root: string;
  let first: string;
  const file = 'packages/web/src/api.ts';
  const running: RunningBackend[] = [];

  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
  }).trim();

  /** Stop whatever backend is up and start another on the same data directory. */
  const restart = async () => {
    await (running.at(-1) ?? h.backend).stop();
    const b = await startBackend({ dataDir: h.fixture.dataDir });
    running.push(b);
    const client = createClient(b.baseUrl, b.capabilityToken);
    await client.scanProject(root);
    return { b, client };
  };
  const baselineOf = async (client: ReturnType<typeof createClient>) =>
    (await (await client.raw('GET', '/api/baseline')).json()) as Baseline;
  const diffOf = async (client: ReturnType<typeof createClient>) =>
    (await (await client.raw('GET', `/api/diff?project=${encodeURIComponent(root)}`)).json()) as { modifiedFiles: string[] };

  test.beforeAll(async () => {
    h = await setupHarness('baseline-restart');
    root = h.fixture.projectPath;
    first = git('rev-parse', 'HEAD');
    fs.appendFileSync(path.join(root, file), '\nexport const second = 2;\n');
    git('commit', '-qam', 'second');
    await h.client.scanProject(root);
  });

  test.afterAll(async () => {
    for (const b of running) await b.stop().catch(() => {});
    await h?.teardown();
  });

  test('a pinned commit is still the baseline after a restart, and the diff still measures from it', async () => {
    const pinned = await h.client.raw('POST', '/api/baseline/capture', { projectPath: root, commitHash: first });
    expect(pinned.ok).toBe(true);
    const before = await baselineOf(h.client);
    expect(before).toMatchObject({ commitHash: first, source: 'commit' });
    expect((await diffOf(h.client)).modifiedFiles).toContain(file);

    const { client } = await restart();
    const after = await baselineOf(client);
    // The same baseline, not a new capture of the tree at launch.
    expect(after).toMatchObject({ commitHash: first, source: 'commit', capturedAt: before.capturedAt });
    expect((await diffOf(client)).modifiedFiles).toContain(file);
  });

  test('cleared, it stays cleared: the next scan after a restart sets a new one from the tree', async () => {
    const b = running.at(-1)!;
    const agent = createScriptedAgent({
      mcpPort: b.mcpPort, capabilityToken: b.capabilityToken, agentType: 'claude-desktop', projectPath: root,
    });
    await agent.connect();
    try {
      const cleared = await agent.callTool('set_baseline', { commit_hash: null });
      expect(cleared.isError, cleared.text).not.toBe(true);
    } finally {
      await agent.disconnect();
    }

    const { client } = await restart();
    const fresh = await baselineOf(client);
    expect(fresh.source).toBe('scan');
    expect(fresh.commitHash).toBe(git('rev-parse', 'HEAD'));
    // Nothing changed since the tree it was taken from.
    expect((await diffOf(client)).modifiedFiles).not.toContain(file);
  });
});
