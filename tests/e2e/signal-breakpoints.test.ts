/**
 * Signal breakpoints (Phase 32 B4.2b), end to end: a person's rule on a kind
 * of serious signal, a real contract change between two real worktrees, and
 * the agents in both over MCP.
 *
 * Sam sets "ask me when there is a contract change". Billing changes
 * validateCreateUser's parameters; checkout's work imports it: a high
 * contract signal naming both. Codex in checkout goes to claim a task and is
 * paused; Sam answers with a steer and the claim goes through with it.
 * Claude Code in billing is paused too; Sam then marks the signal intended
 * in Awareness, and the waiting call is let through by CodeTrellis, which
 * says so rather than claiming a person answered it.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface Hit { ref: string; signalId: string | null; decision: string | null; answeredByType: string | null; note: string | null }

test.describe.serial('Signal breakpoints', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let claude: ScriptedMcp;
  let codex: ScriptedMcp;
  let planUid: string;
  let signupTask: string;
  let invoiceTask: string;
  let warmupTask: string;
  let contractId: string;
  let codexRef: string;
  let claudeRef: string;

  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
  };
  const first = (text: string) => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; } };

  test.beforeAll(async () => {
    h = await setupHarness('signal-breakpoints', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    planUid = (await h.client.createPlan({ title: 'Signup', projectPath: root })).uid;
    const add = async (title: string) => ((await (await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title })).json()) as { uid: string }).uid;
    signupTask = await add('Signup form validation');
    invoiceTask = await add('Invoice currency');
    warmupTask = await add('Rename the form fields');
    claude = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [billing] });
    codex = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [checkout] });
    await claude.connect();
    await codex.connect();
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
    expect((await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).ok).toBe(true);
  });

  test.afterAll(async () => {
    await claude?.disconnect().catch(() => {});
    await codex?.disconnect().catch(() => {});
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('a person sets a rule on contract changes for the opened project', async () => {
    const res = await h.client.raw('POST', '/api/breakpoints', { kind: 'signal', signal: 'contract', note: 'Contract changes need me' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { breakpoint: Record<string, unknown> }).breakpoint).toMatchObject({ kind: 'signal', target: 'contract', projectRoot: root });
    expect((await h.client.raw('POST', '/api/breakpoints', { kind: 'signal', signal: 'stale-base' })).status).toBe(400);
  });

  test('with no serious signal open, claims go through', async () => {
    expect(first((await codex.callTool('claim_item', { uid: warmupTask })).answer)).toMatchObject({ ok: true });
  });

  test('a contract change: the agent whose work imports it is paused at its next claim, told why', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    let r: Record<string, unknown> = {};
    await expect.poll(async () => {
      const s = ((await (await h.client.raw('GET', `/api/awareness?fresh=1&project=${encodeURIComponent(root)}`)).json()) as { signals: Array<{ id: string; kind: string; severity: string }> }).signals;
      contractId = s.find((x) => x.kind === 'contract' && x.severity === 'high')?.id ?? '';
      return contractId;
    }, { timeout: 15_000, intervals: [300] }).not.toBe('');

    r = first((await codex.callTool('claim_item', { uid: signupTask })).answer);
    expect(r).toMatchObject({ paused: true, status: 'paused: waiting for a decision', signal: { kind: 'contract' } });
    expect(String(r.message)).toContain('Your workstream is named in a serious contract signal: `billing-v2` changed validateCreateUser');
    expect(String(r.message)).toContain('Their note on the rule: Contract changes need me');
    codexRef = String(r.ref);
    expect(((await (await h.client.raw('GET', `/api/items/${signupTask}`)).json()) as { status: string }).status).toBe('pending');
    const waiting = ((await (await h.client.raw('GET', '/api/breakpoint-hits')).json()) as { hits: Hit[] }).hits;
    expect(waiting.find((x) => x.ref === codexRef)?.signalId).toBe(contractId);
  });

  test('a steer: the claim goes through with it, and later claims are not held by that signal', async () => {
    expect((await h.client.raw('POST', `/api/breakpoint-hits/${codexRef}/answer`, { decision: 'steer', note: 'Pass strict: false until billing merges' })).status).toBe(200);
    const claimed = await codex.callTool('claim_item', { uid: signupTask });
    expect(first(claimed.answer)).toMatchObject({ ok: true });
    expect(claimed.text).toContain('continue, with this steer: Pass strict: false until billing merges');
  });

  test('the changing side is held too; the person marking the signal intended lets it through, said as CodeTrellis', async () => {
    const held = first((await claude.callTool('claim_item', { uid: invoiceTask })).answer);
    expect(held).toMatchObject({ paused: true });
    claudeRef = String(held.ref);
    expect(claudeRef).not.toBe(codexRef);

    const answer = await h.client.raw('POST', `/api/awareness/${contractId}/state?project=${encodeURIComponent(root)}`, { state: 'intended' });
    expect(answer.ok).toBe(true);
    // Listing what waits settles it: the signal is answered, so nothing waits on it.
    const waiting = ((await (await h.client.raw('GET', '/api/breakpoint-hits')).json()) as { hits: Hit[] }).hits;
    expect(waiting.find((x) => x.ref === claudeRef)).toBeUndefined();
    const view = JSON.parse((await claude.callTool('await_decision', { ref: claudeRef, wait_seconds: 2 })).answer) as Record<string, unknown>;
    expect(view).toMatchObject({ status: 'answered', decision: 'continue', by: 'system', note: 'The signal was answered in Awareness.' });
    expect(first((await claude.callTool('claim_item', { uid: invoiceTask })).answer)).toMatchObject({ ok: true });
  });

  test('on the Timeline: the pauses name the signal, and the release is CodeTrellis\'s, not a person\'s', async () => {
    let events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    await expect.poll(async () => {
      events = ((await (await h.client.raw('GET', '/api/agent-events')).json()) as { events: typeof events }).events;
      return events.filter((e) => e.type === 'breakpoint_answered').length;
    }, { timeout: 10_000 }).toBe(2);
    expect(events.filter((e) => e.type === 'breakpoint_hit').map((e) => e.payload.signalKind)).toEqual(['contract', 'contract']);
    expect(events.filter((e) => e.type === 'breakpoint_answered').map((e) => e.payload.byType)).toEqual(['unverified', 'system']);
  });
});
