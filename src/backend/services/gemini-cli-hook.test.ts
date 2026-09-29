/**
 * The breakpoint hook for Gemini CLI (Phase 32 A8.3): what its real hook
 * input and output look like (checked against @google/gemini-cli-core 0.61.0),
 * what is written to its settings, and that nothing is written the person did
 * not see.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GEMINI_SETTINGS_FILE, applyGeminiHook, geminiDir, geminiHookCommand, planGeminiHook, previewGeminiHook, type GeminiWhere,
} from './gemini-cli-hook';
import { hashOf } from './claude-desktop-config';
import { parseGeminiHookInput, geminiDeny, runGeminiBeforeToolHook, GEMINI_HOOK_MATCHER } from '../mcp/connector/hook';
import type { JsonRpcMessage, Upstream } from '../mcp/connector/core';

const CONNECTOR = { command: '/opt/CodeTrellis/codetrellis', args: ['/opt/CodeTrellis/resources/connector/mcp-connector.cjs', '--data-dir', '/d'], env: { ELECTRON_RUN_AS_NODE: '1' } };
const COMMAND = geminiHookCommand(CONNECTOR, 'darwin');
const ENV = { ELECTRON_RUN_AS_NODE: '1' };

/** Gemini CLI's BeforeTool input, as its HookInput and BeforeToolInput types define it. */
const beforeTool = (tool: string, toolInput: Record<string, unknown>, cwd = '/w/app') => JSON.stringify({
  session_id: 'g-1', transcript_path: '/home/sam/.gemini/tmp/chats/g-1.json', cwd, hook_event_name: 'BeforeTool',
  timestamp: '2026-09-29T00:00:00.000Z', tool_name: tool, tool_input: toolInput,
});

describe('reading Gemini CLI\'s BeforeTool input', () => {
  test('replace: the file, and the text it replaces', () => {
    assert.deepEqual(parseGeminiHookInput(beforeTool('replace', { file_path: '/w/app/src/a.ts', old_string: 'return 1;', new_string: 'return 2;', instruction: 'fix' })),
      { cwd: '/w/app', filePath: '/w/app/src/a.ts', oldTexts: ['return 1;'] });
  });

  test('write_file: the whole file, so no replaced text; a relative path is read from its cwd', () => {
    assert.deepEqual(parseGeminiHookInput(beforeTool('write_file', { file_path: 'src/b.ts', content: 'x' })), { cwd: '/w/app', filePath: '/w/app/src/b.ts' });
  });

  test('anything else is not for it', () => {
    assert.equal(parseGeminiHookInput(beforeTool('run_shell_command', { command: 'ls' })), null);
    assert.equal(parseGeminiHookInput(JSON.stringify({ hook_event_name: 'AfterTool', tool_name: 'replace', cwd: '/w', tool_input: { file_path: 'a' } })), null);
    assert.equal(parseGeminiHookInput('not json'), null);
  });

  test('a hold is Gemini CLI\'s deny, with the reason the model reads', () => {
    assert.deepEqual(JSON.parse(geminiDeny('paused: waiting')), { decision: 'deny', reason: 'paused: waiting' });
    // Its matcher is a regular expression against the tool name: exactly the two edit tools.
    const m = new RegExp(GEMINI_HOOK_MATCHER);
    assert.deepEqual(['write_file', 'replace', 'replace_all', 'read_file'].map((t) => m.test(t)), [true, true, false, false]);
  });

  test('running it: a held edit is denied; anything else prints nothing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gemini-run-'));
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere\n');
    const app = (answer: string) => async (): Promise<Upstream> => {
      const up: Upstream = {
        async send(m: JsonRpcMessage) {
          const reply = (msg: Omit<JsonRpcMessage, 'jsonrpc'>) => setImmediate(() => up.onmessage?.({ jsonrpc: '2.0', ...msg }));
          if (m.method === 'initialize') reply({ id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'ct', version: '1' } } });
          if (m.method === 'tools/call') reply({ id: m.id, result: { content: [{ type: 'text', text: answer }] } });
        },
        close() { up.onclose?.(); },
      };
      return up;
    };
    const stdin = beforeTool('replace', { file_path: path.join(root, 'a.ts'), old_string: 'x', new_string: 'y' }, root);
    assert.deepEqual(JSON.parse((await runGeminiBeforeToolHook({ stdin, version: 't', connect: app('{"status":"paused","ref":"bp-1","message":"held a.ts"}') }))!),
      { decision: 'deny', reason: 'held a.ts' });
    assert.equal(await runGeminiBeforeToolHook({ stdin, version: 't', connect: app('{"status":"pass"}') }), null);
    assert.equal(await runGeminiBeforeToolHook({ stdin, version: 't', connect: async () => { throw new Error('no app'); } }), null);
  });
});

function home(): { where: GeminiWhere; dir: string } {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gemini-'));
  const dir = path.join(h, '.gemini');
  fs.mkdirSync(dir);
  return { where: { home: h, env: {}, exists: (p) => fs.existsSync(p) }, dir };
}

describe('where, and what', () => {
  test("Gemini CLI's folder: ~/.gemini, or under GEMINI_CLI_HOME, only where it exists", () => {
    const at = (existing: string[], env: Record<string, string> = {}) => geminiDir({ home: '/h', env, exists: (p) => existing.includes(p) });
    assert.equal(at(['/h/.gemini']), '/h/.gemini');
    assert.equal(at(['/g/.gemini'], { GEMINI_CLI_HOME: '/g' }), '/g/.gemini');
    assert.equal(at([]), null);
  });

  test('the hook runs the connector this app resolved, in Gemini hook mode, quoted for the shell Gemini CLI runs it in', () => {
    // bash on macOS and Linux; the environment is the entry's own `env`, not a prefix.
    assert.equal(COMMAND, '/opt/CodeTrellis/codetrellis /opt/CodeTrellis/resources/connector/mcp-connector.cjs --data-dir /d --hook gemini-before-tool');
    assert.equal(geminiHookCommand({ ...CONNECTOR, command: "/Users/o'neil/Apps/Code Trellis" }, 'darwin').split(' --data-dir')[0], `'/Users/o'\\''neil/Apps/Code Trellis' /opt/CodeTrellis/resources/connector/mcp-connector.cjs`);
    // PowerShell on Windows: the call operator and single quotes.
    assert.equal(
      geminiHookCommand({ command: 'C:\\Program Files\\CodeTrellis\\CodeTrellis.exe', args: ["C:\\Users\\o'neil\\mcp-connector.cjs"], env: {} }, 'win32'),
      "& 'C:\\Program Files\\CodeTrellis\\CodeTrellis.exe' 'C:\\Users\\o''neil\\mcp-connector.cjs' --hook gemini-before-tool",
    );
  });
});

describe('the settings merge', () => {
  test('adds one BeforeTool entry and keeps every other setting and hook', () => {
    const theirs = { matcher: 'run_shell_command', hooks: [{ type: 'command', command: 'audit.sh' }] };
    const plan = planGeminiHook(JSON.stringify({ model: { name: 'gemini-2.5-pro' }, hooks: { BeforeTool: [theirs], SessionStart: [] } }), COMMAND, ENV);
    assert.ok(plan.ok);
    assert.equal(plan.status, 'update');
    const after = JSON.parse(plan.after);
    assert.deepEqual(after.model, { name: 'gemini-2.5-pro' });
    assert.deepEqual(after.hooks.SessionStart, []);
    assert.deepEqual(after.hooks.BeforeTool, [theirs, { matcher: '^(write_file|replace)$', hooks: [{ type: 'command', name: 'codetrellis-breakpoints', command: COMMAND, env: ENV, timeout: 10000 }] }]);
  });

  test('an older entry of ours is replaced in place; asking again changes nothing', () => {
    const old = { matcher: 'replace', hooks: [{ type: 'command', command: '/old/mcp-connector.cjs --hook gemini-before-tool' }, { type: 'command', command: 'mine.sh' }] };
    const plan = planGeminiHook(JSON.stringify({ hooks: { BeforeTool: [old] } }), COMMAND);
    assert.ok(plan.ok);
    const groups = JSON.parse(plan.after).hooks.BeforeTool;
    assert.equal(groups.length, 2);
    assert.equal(groups[0].hooks[0].command, COMMAND);
    assert.deepEqual(groups[1].hooks, [{ type: 'command', command: 'mine.sh' }]);
    const again = planGeminiHook(plan.after, COMMAND);
    assert.ok(again.ok && again.status === 'unchanged');
  });

  test('a settings file it cannot read as Gemini CLI does is left alone, saying why', () => {
    for (const bad of ['{ not json', '[1]', '{"hooks": []}', '{"hooks": {"BeforeTool": {}}}']) {
      const plan = planGeminiHook(bad, COMMAND);
      assert.equal(plan.ok, false, bad);
    }
  });
});

describe('preview and apply', () => {
  test('no Gemini CLI folder: nothing to do, saying so', () => {
    const where = { home: fs.mkdtempSync(path.join(os.tmpdir(), 'ct-no-gemini-')), env: {}, exists: (p: string) => fs.existsSync(p) };
    const p = previewGeminiHook(where, CONNECTOR);
    assert.equal(p.ok, false);
  });

  test('writes only the file shown, keeping a copy of what was there', () => {
    const { where, dir } = home();
    const file = path.join(dir, GEMINI_SETTINGS_FILE);
    fs.writeFileSync(file, '{"theme":"Dracula"}\n');
    const p = previewGeminiHook(where, CONNECTOR);
    assert.ok(p.ok);
    assert.equal(p.status, 'update');
    const done = applyGeminiHook(where, CONNECTOR, p.beforeHash, new Date('2026-09-29T00:00:00Z'));
    assert.ok(done.ok);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).theme, 'Dracula');
    assert.equal(fs.readFileSync(done.backupPath!, 'utf8'), '{"theme":"Dracula"}\n');
  });

  test('a file changed after it was shown is not written; the change is shown again', () => {
    const { where, dir } = home();
    const file = path.join(dir, GEMINI_SETTINGS_FILE);
    fs.writeFileSync(file, '{}');
    const shown = hashOf('{}');
    fs.writeFileSync(file, '{"theme":"Light"}');
    const r = applyGeminiHook(where, CONNECTOR, shown);
    assert.equal(r.ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"theme":"Light"}');
  });

  test('a settings file that is a link is not read or written through', () => {
    const { where, dir } = home();
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-outside-')), 'settings.json');
    fs.writeFileSync(outside, '{}');
    fs.symlinkSync(outside, path.join(dir, GEMINI_SETTINGS_FILE));
    assert.equal(previewGeminiHook(where, CONNECTOR).ok, false);
    assert.equal(applyGeminiHook(where, CONNECTOR, hashOf('{}')).ok, false);
    assert.equal(fs.readFileSync(outside, 'utf8'), '{}');
  });
});
