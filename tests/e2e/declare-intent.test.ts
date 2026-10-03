/**
 * Declared intent (Phase 32 A2.4), end to end: two worktrees, two agents
 * bound to them over MCP, and the running backend.
 *
 * An agent that says what it is about to change is part of its workstream's
 * footprint straight away, so an overlap with the other worktree's edits is
 * flagged before it edits anything, and the same signal carries on when the
 * edit lands. The person sees the agent's summary; the other agent sees only
 * what was claimed.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

interface Signal { id: string; kind: string; severity: string; summary: string; subject: { file?: string; symbol?: string; intended?: string[] }; workstreams: string[] }
interface Intent { sessionId: string; agentType: string; summary?: string; paths: string[]; symbols: string[] }
interface Ws { root: string; branch: string | null; intents?: Intent[]; yours?: boolean }

const REL = 'packages/shared/src/validators.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Declared intent', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let auth: string;
  let billing: string;
  let planner: ScriptedMcp; // works in billing, declares first
  let other: ScriptedMcp; // works in auth

  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);
  const signals = async () => {
    const res = await h.client.raw('GET', `/api/awareness?fresh=1&project=${encodeURIComponent(root)}`);
    return ((await res.json()) as { signals: Signal[] }).signals;
  };
  const declare = async (args: Record<string, unknown>) => {
    const r = await planner.callTool('declare_intent', args);
    return { ...r, body: r.isError ? null : JSON.parse(r.text) };
  };

  test.beforeAll(async () => {
    h = await setupHarness('declare-intent', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    auth = `${root}-auth`;
    billing = `${root}-billing`;
    for (const [dir, branch] of [[auth, 'auth-refresh'], [billing, 'billing-v2']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    planner = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [billing] });
    other = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [auth] });
    await planner.connect();
    await other.connect();
    // The other worktree is already editing isValidEmail.
    const f = path.join(auth, REL);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace('return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.trim());'));
  });

  test.afterAll(async () => {
    await planner?.disconnect().catch(() => {});
    await other?.disconnect().catch(() => {});
    for (const w of [auth, billing]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('declaring a function the other worktree is editing flags the overlap before any file changes', async () => {
    expect((await signals()).filter((s) => s.kind === 'collision')).toEqual([]);
    const r = await declare({ summary: 'Tighten email validation for billing contacts', paths: [REL], symbols: ['isValidEmail'] });
    expect(r.isError, r.text).toBeFalsy();
    expect(same(r.body.your_workstream, billing)).toBe(true);
    expect(r.body.declared).toEqual({ summary: 'Tighten email validation for billing contacts', paths: [REL], symbols: ['isValidEmail'] });

    // The answer comes back with the overlap in it.
    const [c] = (r.body.signals as Signal[]).filter((s) => s.kind === 'collision');
    expect(c).toMatchObject({ severity: 'high', subject: { file: REL, symbol: 'isValidEmail' } });
    expect(c.summary).toBe(`\`billing-v2\` means to change ${REL} → isValidEmail (declared), and \`auth-refresh\` changes it`);
    expect(c.subject.intended!.map((w) => same(w, billing))).toEqual([true]);
    // And the person sees it too.
    expect((await signals()).map((s) => s.id)).toContain(c.id);
  });

  test('the person sees the summary; the other agent sees what was claimed, not what was written', async () => {
    const people = (await (await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).json()) as Ws[];
    const mine = people.find((w) => same(w.root, billing))!;
    expect(mine.intents).toEqual([expect.objectContaining({ agentType: 'claude-code', summary: 'Tighten email validation for billing contacts', paths: [REL] })]);

    // `answer`: the other agent is told about the overlap in a notice after it.
    const seen = JSON.parse((await other.callTool('list_workstreams', {})).answer) as { workstreams: Ws[] };
    const theirs = seen.workstreams.find((w) => same(w.root, billing))!;
    expect(theirs.intents).toHaveLength(1);
    expect(theirs.intents![0].paths).toEqual([REL]);
    expect(theirs.intents![0].symbols).toEqual(['isValidEmail']);
    expect(theirs.intents![0].summary).toBeUndefined();

    // Its own summary comes back to the agent that wrote it.
    const own = JSON.parse((await planner.callTool('list_workstreams', {})).answer) as { workstreams: Ws[] };
    expect(own.workstreams.find((w) => w.yours)!.intents![0].summary).toBe('Tighten email validation for billing contacts');
  });

  test('when the edit lands, it is the same signal, no longer marked declared', async () => {
    const [before] = (await signals()).filter((s) => s.kind === 'collision');
    const f = path.join(billing, REL);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace('return EMAIL_RE.test(email);', 'return email.length > 3 && EMAIL_RE.test(email);'));
    await expect.poll(async () => (await signals()).find((s) => s.id === before.id)?.subject.intended ?? null, { timeout: 10_000 }).toBeNull();
    const after = (await signals()).find((s) => s.id === before.id)!;
    expect(after.summary).toBe(`\`auth-refresh\` and \`billing-v2\` both change ${REL} → isValidEmail`);
    execFileSync('git', ['-C', billing, 'checkout', '-q', '--', '.']);
  });

  test('a bare name with no paths is placed where it is defined', async () => {
    const r = await declare({ summary: 'Rework the user check', symbols: ['validateCreateUser'] });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.body.declared.symbols).toEqual([`${REL}#validateCreateUser`]);
    expect(r.body.resolved).toEqual([{ name: 'validateCreateUser', files: [REL] }]);
  });

  test('a path outside the repository is refused, and nothing is declared', async () => {
    const r = await declare({ summary: 'Sneak', paths: ['../../etc/passwd'] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('../../etc/passwd');
    // The previous intent stands.
    const people = (await (await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).json()) as Ws[];
    expect(people.find((w) => same(w.root, billing))!.intents![0].summary).toBe('Rework the user check');
  });

  test('clearing withdraws it, and the overlap it caused resolves', async () => {
    await declare({ summary: 'Back on email', paths: [REL], symbols: ['isValidEmail'] });
    await expect.poll(async () => (await signals()).filter((s) => s.kind === 'collision').length).toBe(1);
    const r = await declare({ summary: 'done', clear: true });
    expect(r.body).toMatchObject({ cleared: true });
    await expect.poll(async () => (await signals()).filter((s) => s.kind === 'collision').length, { timeout: 10_000 }).toBe(0);
  });

  test('it ends with the session', async () => {
    await declare({ summary: 'Once more', paths: [REL] });
    await expect.poll(async () => (await signals()).filter((s) => s.kind === 'collision').length).toBe(1);
    await planner.disconnect();
    await expect.poll(async () => (await signals()).filter((s) => s.kind === 'collision').length, { timeout: 15_000 }).toBe(0);
  });
});
