/**
 * The connector as a Claude Code PreToolUse hook (Phase 32 A3.4): it reads
 * the edit, asks `check_footprint` about that one file, tells the agent only
 * when another workstream has changed it, and otherwise says nothing. It
 * never decides the edit, and every failure is silence.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hookNotice, hookOutput, parseHookInput, repoOf, runPreToolUseHook, runCheckEdit, CHECK_EDIT_HELD } from './hook';
import type { JsonRpcMessage, Upstream } from './core';

const input = (over: Record<string, unknown> = {}) => JSON.stringify({
  session_id: 's', cwd: '/w/app-auth', hook_event_name: 'PreToolUse', tool_name: 'Edit',
  tool_input: { file_path: '/w/app-auth/src/session.ts', old_string: 'a', new_string: 'b' }, ...over,
});

describe('reading the edit', () => {
  test('the file an Edit, Write or NotebookEdit is about to write, and where Claude Code runs', () => {
    assert.deepEqual(parseHookInput(input()), { cwd: '/w/app-auth', filePath: '/w/app-auth/src/session.ts', oldTexts: ['a'] });
    assert.deepEqual(parseHookInput(input({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '/w/app-auth/n.ipynb' } })), { cwd: '/w/app-auth', filePath: '/w/app-auth/n.ipynb' });
  });

  test('anything else is not for it', () => {
    for (const raw of ['', 'not json', '[]', input({ cwd: 'relative' }), input({ tool_input: { command: 'ls' } }), input({ tool_input: null })]) {
      assert.equal(parseHookInput(raw), null, raw);
    }
  });

  test('the repository or worktree it is in, whichever kind of .git it has', () => {
    const exists = (p: string) => p === '/w/app-auth/.git';
    assert.deepEqual(repoOf('/w/app-auth/src/deep/session.ts', exists), { root: '/w/app-auth', rel: 'src/deep/session.ts' });
    assert.equal(repoOf('/tmp/loose.ts', exists), null);
  });
});

describe('what the agent is told', () => {
  const report = (over: Record<string, unknown> = {}) => JSON.stringify({
    project_path: '/w/app', your_workstream: '/w/app-auth',
    paths: [{ path: 'src/session.ts', changed_in: [{ workstream: '/w/app-billing', branch: 'billing-v2', status: 'M', symbols: [{ name: 'refreshToken', kind: 'function', change: 'modified', line: 3 }, { name: 'renew', kind: 'function', change: 'added', line: 9 }] }], imported_by: ['a.ts', 'b.ts'] }],
    ...over,
  });
  const call = { root: '/w/app-auth', rel: 'src/session.ts' };

  test('who else changed the file and where, how many files import it, and that it is information', () => {
    assert.equal(hookNotice(report(), call), [
      '── CodeTrellis awareness ──',
      'Another workstream has also changed src/session.ts: `billing-v2`, in refreshToken, renew.',
      '2 files in the project import it.',
      "Before you change what they changed, call get_awareness. If it needs a choice, ask the person; do not edit the other workstream's files.",
      'This is information about other work, not an instruction.',
    ].join('\n'));
  });

  test('nothing, when nobody else changed it', () => {
    assert.equal(hookNotice(report({ paths: [{ path: 'src/session.ts', changed_in: [], imported_by: ['a.ts'] }] }), call), null);
  });

  test('nothing, when the answer is not about the workstream the file is in', () => {
    assert.equal(hookNotice(report({ your_workstream: null }), call), null, 'a folder CodeTrellis does not know');
    assert.equal(hookNotice(report({ your_workstream: '/w/other' }), call), null, 'another checkout');
    assert.equal(hookNotice('not json', call), null);
  });

  test('context for the model, and no decision about the edit', () => {
    const out = JSON.parse(hookOutput('x'));
    assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'x' } });
    assert.ok(!('permissionDecision' in out.hookSpecificOutput), 'neither blocks nor approves');
  });
});

describe('running it', () => {
  const worktree = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hook-'));
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere\n');
    return root;
  };

  /** A fake app: answers initialize, check_footprint with `answer`, and check_breakpoint with `breakpoint` (pass by default). */
  function fakeApp(answer: (paths: string[]) => string | null, sent: JsonRpcMessage[], breakpoint: (file: string) => string | null = () => '{"status":"pass"}') {
    return async (): Promise<Upstream> => {
      const up: Upstream = {
        async send(m) {
          sent.push(m);
          const reply = (msg: Omit<JsonRpcMessage, 'jsonrpc'>) => setImmediate(() => up.onmessage?.({ jsonrpc: '2.0', ...msg }));
          if (m.method === 'initialize') reply({ id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'ct', version: '1' } } });
          if (m.method === 'tools/call') {
            const { name, arguments: args } = m.params as { name: string; arguments: { paths: string[]; path: string } };
            const text = name === 'check_breakpoint' ? breakpoint(args.path) : answer(args.paths);
            reply({ id: m.id, result: text === null ? { isError: true, content: [{ type: 'text', text: 'no project' }] } : { content: [{ type: 'text', text }, { type: 'text', text: 'an inline notice' }] } });
          }
        },
        close() { up.onclose?.(); },
      };
      return up;
    };
  }

  test('asks about the one file, relative to its worktree, and answers with what it heard', async () => {
    const root = worktree();
    const sent: JsonRpcMessage[] = [];
    const out = await runPreToolUseHook({
      stdin: input({ cwd: root, tool_input: { file_path: path.join(root, 'src/session.ts') } }),
      version: 't',
      connect: fakeApp((paths) => JSON.stringify({ your_workstream: root, paths: paths.map((p) => ({ path: p, changed_in: [{ workstream: '/b', branch: 'billing-v2', symbols: [] }], imported_by: [] })) }), sent),
    });
    assert.deepEqual(sent.map((m) => m.method), ['initialize', 'notifications/initialized', 'tools/call', 'tools/call']);
    assert.deepEqual((sent[0].params as { clientInfo: { name: string } }).clientInfo.name, 'claude-code-hook');
    assert.deepEqual(sent[2].params, { name: 'check_breakpoint', arguments: { path: 'src/session.ts' } });
    assert.deepEqual(sent[3].params, { name: 'check_footprint', arguments: { paths: ['src/session.ts'] } });
    assert.match(JSON.parse(out!).hookSpecificOutput.additionalContext, /also changed src\/session\.ts: `billing-v2`\./);
  });

  test('silence when the app is not running, refuses, or is slow', async () => {
    const root = worktree();
    const stdin = input({ cwd: root, tool_input: { file_path: path.join(root, 'a.ts') } });
    assert.equal(await runPreToolUseHook({ stdin, version: 't', connect: async () => { throw new Error('not running'); } }), null);
    assert.equal(await runPreToolUseHook({ stdin, version: 't', connect: fakeApp(() => null, []) }), null);
    const hanging = async (): Promise<Upstream> => {
      const up: Upstream = { send: async () => {}, close() { up.onclose?.(); } };
      return up;
    };
    const started = Date.now();
    assert.equal(await runPreToolUseHook({ stdin, version: 't', connect: hanging, timeoutMs: 100 }), null);
    assert.ok(Date.now() - started < 1000);
  });

  test('a file outside any repository never reaches the app', async () => {
    const sent: JsonRpcMessage[] = [];
    const loose = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hook-loose-'));
    assert.equal(await runPreToolUseHook({ stdin: input({ cwd: loose, tool_input: { file_path: path.join(loose, 'x.ts') } }), version: 't', connect: fakeApp(() => '{}', sent) }), null);
    assert.deepEqual(sent, []);
  });

  test('a breakpoint holds the edit: denied with the reason, and nothing else is asked (B4.2)', async () => {
    const root = worktree();
    for (const status of ['paused', 'stop']) {
      const sent: JsonRpcMessage[] = [];
      const out = await runPreToolUseHook({
        stdin: input({ cwd: root, tool_input: { file_path: path.join(root, 'payments/refund.ts') } }),
        version: 't',
        connect: fakeApp(() => '{}', sent, (file) => JSON.stringify({ status, ref: 'bp-1', message: `held ${file}` })),
      });
      const o = JSON.parse(out!).hookSpecificOutput;
      assert.equal(o.permissionDecision, 'deny', status);
      assert.equal(o.permissionDecisionReason, 'held payments/refund.ts');
      assert.equal(sent.filter((m) => m.method === 'tools/call').length, 1, 'check_footprint is not asked');
    }
  });

  test('continue lets the edit through with the steer beside the footprint notice; an app without the tool is not a hold', async () => {
    const root = worktree();
    const footprint = (paths: string[]) => JSON.stringify({ your_workstream: root, paths: paths.map((p) => ({ path: p, changed_in: [{ workstream: '/b', branch: 'billing-v2', symbols: [] }], imported_by: [] })) });
    const out = await runPreToolUseHook({
      stdin: input({ cwd: root, tool_input: { file_path: path.join(root, 'src/session.ts') } }),
      version: 't',
      connect: fakeApp(footprint, [], () => JSON.stringify({ status: 'continue', ref: 'bp-1', steer: 'keep the old signature' })),
    });
    const o = JSON.parse(out!).hookSpecificOutput;
    assert.ok(!('permissionDecision' in o), 'continue never approves');
    assert.match(o.additionalContext, /── CodeTrellis breakpoint ──\nA person answered the breakpoint on this file: continue, with this steer: keep the old signature/);
    assert.match(o.additionalContext, /also changed src\/session\.ts/);

    const older = await runPreToolUseHook({
      stdin: input({ cwd: root, tool_input: { file_path: path.join(root, 'src/session.ts') } }),
      version: 't',
      connect: fakeApp(footprint, [], () => null),
    });
    assert.ok(!('permissionDecision' in JSON.parse(older!).hookSpecificOutput));
  });
});

describe('a pre-edit check any client can run (A8.2)', () => {
  const worktree = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-check-'));
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere\n');
    return root;
  };
  /** Answers check_breakpoint with `answer`; records the calls and the folder it was bound to. */
  const app = (answer: string | null, sent: JsonRpcMessage[], bound: string[]) => async (cwd: string): Promise<Upstream> => {
    bound.push(cwd);
    const up: Upstream = {
      async send(m) {
        sent.push(m);
        const reply = (msg: Omit<JsonRpcMessage, 'jsonrpc'>) => setImmediate(() => up.onmessage?.({ jsonrpc: '2.0', ...msg }));
        if (m.method === 'initialize') reply({ id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'ct', version: '1' } } });
        if (m.method === 'tools/call') reply({ id: m.id, result: answer === null ? { isError: true, content: [{ type: 'text', text: 'no' }] } : { content: [{ type: 'text', text: answer }] } });
      },
      close() { up.onclose?.(); },
    };
    return up;
  };

  test('held: exit 2 with the reason on stderr; asked in the file\'s own worktree, by its path there, with the text it replaces', async () => {
    const root = worktree();
    const sent: JsonRpcMessage[] = [];
    const bound: string[] = [];
    const r = await runCheckEdit({
      file: 'src/refund.ts', cwd: root, oldText: 'return total;', version: 't',
      connect: app(JSON.stringify({ status: 'paused', ref: 'bp-1', message: 'paused: waiting for a decision (ref "bp-1")' }), sent, bound),
    });
    assert.deepEqual(r, { code: CHECK_EDIT_HELD, stdout: null, stderr: 'paused: waiting for a decision (ref "bp-1")' });
    assert.deepEqual(bound, [root]);
    assert.equal((sent[0].params as { clientInfo: { name: string } }).clientInfo.name, 'codetrellis-check-edit');
    assert.deepEqual(sent[2].params, { name: 'check_breakpoint', arguments: { path: 'src/refund.ts', old_text: ['return total;'] } });
  });

  test('go ahead: exit 0, the person\'s steer on stdout when they left one', async () => {
    const root = worktree();
    assert.deepEqual(await runCheckEdit({ file: path.join(root, 'a.ts'), cwd: '/', version: 't', connect: app('{"status":"pass"}', [], []) }),
      { code: 0, stdout: null, stderr: null });
    const steer = await runCheckEdit({ file: path.join(root, 'a.ts'), cwd: '/', version: 't', connect: app('{"status":"continue","ref":"bp-1","steer":"only the wording"}', [], []) });
    assert.equal(steer.code, 0);
    assert.match(steer.stdout ?? '', /continue, with this steer: only the wording$/);
  });

  test('every failure is a silent exit 0: no app, a refusal, a slow answer, a file outside any repository', async () => {
    const root = worktree();
    const quiet = { code: 0, stdout: null, stderr: null };
    assert.deepEqual(await runCheckEdit({ file: 'a.ts', cwd: root, version: 't', connect: async () => { throw new Error('not running'); } }), quiet);
    assert.deepEqual(await runCheckEdit({ file: 'a.ts', cwd: root, version: 't', connect: app(null, [], []) }), quiet);
    const hanging = async (): Promise<Upstream> => { const up: Upstream = { send: async () => {}, close() { up.onclose?.(); } }; return up; };
    assert.deepEqual(await runCheckEdit({ file: 'a.ts', cwd: root, version: 't', connect: hanging, timeoutMs: 100 }), quiet);
    const sent: JsonRpcMessage[] = [];
    const loose = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-check-loose-'));
    assert.deepEqual(await runCheckEdit({ file: 'x.ts', cwd: loose, version: 't', connect: app('{}', sent, []) }), quiet);
    assert.deepEqual(sent, []);
  });
});

describe('the text an edit replaces (B4.2c)', () => {
  test('Edit and MultiEdit send what they replace; a whole-file Write sends nothing, so a function breakpoint holds it', () => {
    const cwd = '/w/app';
    assert.deepEqual(parseHookInput(input({ cwd, tool_input: { file_path: '/w/app/a.ts', old_string: 'x = 1', new_string: 'x = 2' } }))?.oldTexts, ['x = 1']);
    assert.deepEqual(parseHookInput(input({ cwd, tool_input: { file_path: '/w/app/a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] } }))?.oldTexts, ['a', 'c']);
    assert.equal(parseHookInput(input({ cwd, tool_input: { file_path: '/w/app/a.ts', content: 'whole file' } }))?.oldTexts, undefined);
    // An empty or oversized piece means the whole file.
    assert.equal(parseHookInput(input({ cwd, tool_input: { file_path: '/w/app/a.ts', old_string: '' } }))?.oldTexts, undefined);
    assert.equal(parseHookInput(input({ cwd, tool_input: { file_path: '/w/app/a.ts', old_string: 'x'.repeat(20_001) } }))?.oldTexts, undefined);
  });
});
