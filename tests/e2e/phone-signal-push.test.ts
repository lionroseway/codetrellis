/**
 * A serious overlap reaches the phone as a push (Phase 32 A4.4), end to end.
 *
 * Journey C2's first moment: Sam is out, the phone asleep. billing-v2's agent
 * changes a function checkout-fix's work imports. With no window asking,
 * the watchers open a high contract signal and Sam's phone is pushed once:
 * "Needs you", words that name no file or function, and the signal's id for
 * the tap. The signal keeping on firing pushes nothing more. A phone that is
 * open and connected is not pushed: its live count moves instead.
 *
 * Pushes go to a receiver on this machine (`CODETRELLIS_PUSH_URL`, loopback
 * only), so nothing leaves it.
 */

import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { setupHarness, createMcpClient, pairPhone, type Harness, type ScriptedMcp, type Phone } from '../harness';

interface Push { to: string; title: string; body: string; data: Record<string, string> }

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const AWAY = 'AA:BB:CC:sams-phone-asleep';

test.describe.serial('A serious overlap, pushed', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let agent: ScriptedMcp;
  let phone: Phone;
  let receiver: http.Server;
  const pushes: Push[] = [];

  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
  };

  test.beforeAll(async () => {
    receiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { pushes.push(...(JSON.parse(body) as Push[])); } catch { /* not a push */ }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
    const port = (receiver.address() as AddressInfo).port;

    h = await setupHarness('phone-signal-push', {
      env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150', CODETRELLIS_PUSH_URL: `http://127.0.0.1:${port}/push` },
    });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [billing] });
    await agent.connect();
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");

    // One phone open and connected; Sam's own asleep, with only its push token.
    phone = await pairPhone(h.client, { alias: 'Open phone' });
    expect((await h.client.raw('POST', '/api/peers/push-tokens', { fingerprint: phone.fingerprint, token: 'ExponentPushToken[open]' })).ok).toBe(true);
    expect((await h.client.raw('POST', '/api/peers/push-tokens', { fingerprint: AWAY, token: 'ExponentPushToken[asleep]' })).ok).toBe(true);
    // The strip was shown once, which starts the watchers; nobody asks again.
    expect((await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).ok).toBe(true);
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    await agent?.disconnect().catch(() => {});
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  test('a contract opens with no window asking: the asleep phone is pushed once, in words naming nothing, with the id', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    await expect.poll(() => pushes.length, { timeout: 15_000, intervals: [300] }).toBe(1);
    const [push] = pushes;
    expect(push).toMatchObject({
      to: 'ExponentPushToken[asleep]',
      title: 'Needs you',
      body: 'An exported function another line of work uses has changed.',
      data: { type: 'signal' },
    });
    expect(JSON.stringify(push)).not.toMatch(/validateCreateUser|validators|billing|checkout|claude/i);

    // The id opens the signal the desktop shows.
    const res = await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`);
    const contract = ((await res.json()) as { signals: Array<{ id: string; kind: string }> }).signals.find((s) => s.kind === 'contract')!;
    expect(push.data.id).toBe(contract.id);
  });

  test('the open phone was not pushed: its live count moved instead', async () => {
    expect(pushes.map((p) => p.to)).not.toContain('ExponentPushToken[open]');
    await phone.waitForState((s) => s.openSignals === 1);
  });

  // Within a minute the per-kind limit would hold a second push as well; what
  // decides that a signal still firing is not news is `newlySerious`, which
  // push-signal.test.ts covers alone.
  test('the signal keeping on firing pushes nothing more', async () => {
    edit(billing, VALIDATORS, 'strict: boolean)', 'strict: boolean /* still */)');
    await new Promise((r) => setTimeout(r, 2_000));
    expect(pushes).toHaveLength(1);
  });
});
