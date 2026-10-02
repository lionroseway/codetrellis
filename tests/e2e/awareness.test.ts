/**
 * Awareness signals (Phase 32 A1.6), end to end: two worktrees of the
 * fixture repository, real edits on disk, the running backend's parser and
 * git, and what a person (REST) and an agent (MCP) are told.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, openEventStream, type Harness, type ScriptedMcp, type EventStream } from '../harness';

interface Signal { id: string; kind: string; severity: string; summary: string; subject: { file?: string; symbol?: string; files?: string[] }; workstreams: string[]; state: string }

const REL = 'packages/shared/src/validators.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Awareness signals', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let events: EventStream;
  let root: string;
  let auth: string;
  let billing: string;
  let agent: ScriptedMcp;
  let original: string;

  const signals = async () => {
    const res = await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { signals: Signal[] }).signals;
  };
  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);
  const edit = (folder: string, from: RegExp, to: string) => {
    const f = path.join(folder, REL);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
  };

  test.beforeAll(async () => {
    h = await setupHarness('awareness', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    auth = `${root}-auth`;
    billing = `${root}-billing`;
    for (const [dir, branch] of [[auth, 'auth-refresh'], [billing, 'billing-v2']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    original = fs.readFileSync(path.join(root, REL), 'utf-8');
    await h.client.scanProject(root);
    events = await openEventStream(h.backend);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [auth] });
    await agent.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    await events?.close();
    for (const w of [auth, billing]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('nothing overlaps yet, so nothing is said', async () => {
    expect(await signals()).toEqual([]);
  });

  test('both worktrees editing the same function is a high collision, naming it', async () => {
    edit(auth, /return EMAIL_RE\.test\(email\);/, 'return EMAIL_RE.test(email.trim());');
    edit(billing, /return EMAIL_RE\.test\(email\);/, 'return email.length > 3 && EMAIL_RE.test(email);');
    const s = await signals();
    expect(s.map((x) => `${x.severity} ${x.kind} ${x.subject.file}#${x.subject.symbol}`)).toEqual([`high collision ${REL}#isValidEmail`]);
    expect(s[0].summary).toBe(`\`auth-refresh\` and \`billing-v2\` both change ${REL} → isValidEmail`);
    expect(s[0].workstreams.map((w) => [same(w, auth), same(w, billing)])).toEqual([[true, false], [false, true]]);
    expect(s[0].state).toBe('open');
  });

  test('asking again does not duplicate it', async () => {
    const [first] = await signals();
    const again = await signals();
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(first.id);
  });

  test('an agent in one of them is told, and check_footprint names the other side', async () => {
    const res = await agent.callTool('get_awareness', {});
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.text) as { your_workstream: string; signals: Signal[] };
    expect(same(body.your_workstream, auth)).toBe(true);
    expect(body.signals.map((x) => x.kind)).toEqual(['collision']);

    const fp = JSON.parse((await agent.callTool('check_footprint', { paths: [REL, 'packages/shared/src/nothing.ts'] })).text) as {
      paths: Array<{ path: string; changed_in: Array<{ workstream: string; branch: string; symbols: Array<{ name: string }> | null }>; imported_by: string[] }>;
    };
    const [v, none] = fp.paths;
    // Its own workstream is left out: only billing is "someone else".
    expect(v.changed_in.map((c) => c.branch)).toEqual(['billing-v2']);
    expect(v.changed_in[0].symbols?.map((x) => x.name)).toEqual(['isValidEmail']);
    expect(Array.isArray(v.imported_by)).toBe(true);
    expect(none.changed_in).toEqual([]);
  });

  test('when one side reverts, the collision resolves on its own, and the window is told', async () => {
    const before = events.ofType('awareness-changed').length;
    fs.writeFileSync(path.join(billing, REL), original);
    await expect.poll(async () => (await signals()).length, { timeout: 10_000 }).toBe(0);
    await expect.poll(() => events.ofType('awareness-changed').length, { timeout: 10_000 }).toBeGreaterThan(before);
  });

  test('different functions of one file are a medium, file-level collision', async () => {
    edit(billing, /export function validateCreateOrder\(/, 'export function validateCreateOrderV2(payload: CreateOrderPayload): string[] { return []; }\nexport function validateCreateOrder(');
    const s = await signals();
    expect(s.map((x) => `${x.severity} ${x.kind} ${x.subject.file}${x.subject.symbol ? '#' + x.subject.symbol : ''}`)).toEqual([`medium collision ${REL}`]);
    fs.writeFileSync(path.join(billing, REL), original);
  });

  test('main moving on a file a worktree changes is a low stale-base for that worktree', async () => {
    fs.writeFileSync(path.join(root, REL), original + '\nexport const MAIN_ONLY = 1;\n');
    execFileSync('git', ['-C', root, 'commit', '-q', '-am', 'main moves'], { env: ENV });
    try {
      await expect.poll(async () => (await signals()).map((x) => `${x.severity} ${x.kind}`), { timeout: 10_000 }).toEqual(['low stale-base']);
      const [stale] = await signals();
      expect(stale.subject.files).toEqual([REL]);
      expect(same(stale.workstreams[0], auth)).toBe(true);
      expect(stale.summary).toContain('since `auth-refresh` branched');
    } finally {
      execFileSync('git', ['-C', root, 'reset', '-q', '--hard', 'HEAD~1'], { env: ENV });
    }
  });

  test('the project comes from what is opened, not from the caller', async () => {
    expect((await h.client.raw('GET', '/api/awareness')).status).toBe(400);
    expect((await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(path.dirname(root))}`)).status).toBe(403);
    for (const tool of ['get_awareness', 'check_footprint']) {
      const r = await agent.callTool(tool, { project_path: path.dirname(root), ...(tool === 'check_footprint' ? { paths: [REL] } : {}) });
      expect(r.isError).toBe(true);
      expect(r.text).toContain('not open');
    }
  });
});
