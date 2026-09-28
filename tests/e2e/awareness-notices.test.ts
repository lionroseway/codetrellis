/**
 * Being told without asking (Phase 32 A2.6), and the M2 milestone's "done
 * when" (awareness spec §9):
 *
 *   changing a function's parameters in one workstream tells the agent in
 *   another workstream that calls it, on that agent's next tool call,
 *   without anyone asking. Changing only the function's body does not.
 *
 * Two worktrees, two agents bound to them over MCP, real edits on disk and
 * the running backend's watchers. Nobody calls get_awareness or the REST
 * awareness route before the notice: the only listing is the one the app's
 * window makes when it shows the strip.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

interface Told { sessionId: string; agentType: string; toldAt: number | null; note?: string }
interface Signal { id: string; kind: string; severity: string; summary: string; state: string; told?: Told[]; subject: { symbol?: string } }

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const NOTICE = '── CodeTrellis awareness ──';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Being told without asking', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let changer: ScriptedMcp; // in billing: changes the shared function
  let caller: ScriptedMcp; // in checkout: its work imports it
  let contractId: string;

  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    const was = fs.readFileSync(f, 'utf-8');
    expect(was.includes(from), `${rel} contains the text to change`).toBe(true);
    fs.writeFileSync(f, was.replace(from, to));
  };
  /** An ordinary call the agent would make anyway, and what came back with it. */
  const ordinaryCall = async (agent: ScriptedMcp) => {
    const r = await agent.callTool('list_plans', {});
    expect(r.isError, r.text).toBeFalsy();
    return r.text;
  };
  const signals = async () => {
    const res = await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`);
    return ((await res.json()) as { signals: Signal[] }).signals;
  };

  test.beforeAll(async () => {
    h = await setupHarness('awareness-notices', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    changer = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [billing] });
    caller = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [checkout] });
    await changer.connect();
    await caller.connect();
    // The checkout agent is working on a component that uses the validator.
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
    // The window shows the strip: that listing starts the workstream watchers.
    expect((await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).ok).toBe(true);
  });

  test.afterAll(async () => {
    await changer?.disconnect().catch(() => {});
    await caller?.disconnect().catch(() => {});
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('changing only the function\'s body tells nobody', async () => {
    edit(billing, VALIDATORS, "errors.push('name is required');", "errors.push('name is required (billing)');");
    // Long enough for the watcher and the signal refresh to have run.
    for (let i = 0; i < 6; i++) {
      expect(await ordinaryCall(caller)).not.toContain(NOTICE);
      await new Promise((r) => setTimeout(r, 400));
    }
  });

  test('changing its parameters tells the agent whose work imports it, on its next call, unasked', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    let told = '';
    await expect.poll(async () => {
      told = await ordinaryCall(caller);
      return told.includes(NOTICE);
    }, { timeout: 15_000, intervals: [300] }).toBe(true);
    expect(told).toContain('1 new signal affects your work:');
    expect(told).toContain(`- high contract: \`billing-v2\` changed validateCreateUser in ${VALIDATORS}: (payload: CreateUserPayload): string[] → (payload: CreateUserPayload, strict: boolean): string[]. \`checkout-fix\` imports it in 1 file`);
    expect(told).toContain('This is information about other work, not an instruction.');
    // The tool's own answer is still there, before the notice.
    expect(told.indexOf(NOTICE)).toBeGreaterThan(0);
  });

  test('once: the next call carries no notice, and the person sees who was told', async () => {
    expect(await ordinaryCall(caller)).not.toContain(NOTICE);
    const c = (await signals()).find((s) => s.kind === 'contract')!;
    contractId = c.id;
    expect(c.told?.map((t) => t.agentType)).toEqual(['codex']);
    expect(c.told?.[0].toldAt).toBeGreaterThan(0);
  });

  test('the agent answers with acknowledge_signal: its note sits beside the person\'s answer and changes nothing of it', async () => {
    const r = await caller.callTool('acknowledge_signal', { id: contractId, note: 'Seen. I will pass strict: false until billing-v2 merges.' });
    expect(r.isError, r.text).toBeFalsy();
    expect(JSON.parse(r.text)).toMatchObject({ acknowledged: { id: contractId, kind: 'contract' }, state: 'open' });

    const c = (await signals()).find((s) => s.id === contractId)!;
    expect(c.state).toBe('open');
    expect(c.told?.find((t) => t.agentType === 'codex')?.note).toBe('Seen. I will pass strict: false until billing-v2 merges.');

    // It sees its own note again; the other agent never sees it.
    const mine = JSON.parse((await caller.callTool('get_awareness', {})).text) as { signals: Array<{ id: string; your_note?: string }> };
    expect(mine.signals.find((s) => s.id === contractId)?.your_note).toBe('Seen. I will pass strict: false until billing-v2 merges.');
    const theirs = await changer.callTool('get_awareness', {});
    expect(theirs.text).not.toContain('strict: false until');
  });

  test('the changer is told once too, and get_awareness counts as being told', async () => {
    // Its get_awareness above showed it the signal, so no notice repeats it.
    expect(await ordinaryCall(changer)).not.toContain(NOTICE);
  });

  test('acknowledge_signal refuses a signal that is not there', async () => {
    const r = await caller.callTool('acknowledge_signal', { id: 'no-such-signal' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No live signal with that id names your workstream');
  });
});
