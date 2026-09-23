/**
 * The endpoint and token files the connector reads on every connect, and
 * the command the app hands to an agent's config.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ENDPOINT_FILE,
  isLoopbackSseUrl,
  readConnectTarget,
  readEndpoint,
  readToken,
  removeEndpointFile,
  writeEndpointFile,
  TOKEN_FILE,
} from './files';
import { claudeCodeConnectorCommand, connectorConfig, resolveConnectorCommand, shellQuote } from './command';
import { TOKEN_HEADER } from './sse-upstream';
import { TOKEN_HEADER as SERVER_TOKEN_HEADER } from '../../services/capability-token';
import { agentTypeFromClientInfo } from '../client-identity';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-connector-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('endpoint file', () => {
  test('round-trips, and is readable only by this user', () => {
    writeEndpointFile(dir, { url: 'http://127.0.0.1:19433/sse', pid: 42, startedAt: 1 });
    assert.deepEqual(readEndpoint(dir), { url: 'http://127.0.0.1:19433/sse', pid: 42, startedAt: 1 });
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(dir, ENDPOINT_FILE)).mode & 0o777, 0o600);
    }
  });

  test('a stopping app removes only the file it wrote', () => {
    writeEndpointFile(dir, { url: 'http://127.0.0.1:19433/sse', pid: 42, startedAt: 1 });
    removeEndpointFile(dir, 7); // another instance, stopping
    assert.ok(readEndpoint(dir), 'the running instance keeps its file');
    removeEndpointFile(dir, 42);
    assert.equal(readEndpoint(dir), null);
  });

  test('never points the token anywhere but this machine', () => {
    for (const url of [
      'http://evil.example/sse',
      'https://127.0.0.1:19432/sse',
      'http://127.0.0.1.evil.example:19432/sse',
      'http://user:pw@127.0.0.1:19432/sse',
      'http://127.0.0.1:19432/other',
      'file:///etc/passwd',
    ]) {
      assert.equal(isLoopbackSseUrl(url), false, url);
      fs.writeFileSync(path.join(dir, ENDPOINT_FILE), JSON.stringify({ url, pid: 1, startedAt: 1 }));
      assert.equal(readEndpoint(dir), null, url);
    }
    for (const url of ['http://127.0.0.1:19432/sse', 'http://localhost:1/sse', 'http://[::1]:19432/sse']) {
      assert.equal(isLoopbackSseUrl(url), true, url);
    }
  });

  test('missing or malformed files read as absent, never throw', () => {
    assert.equal(readEndpoint(dir), null);
    assert.equal(readToken(dir), null);
    fs.writeFileSync(path.join(dir, ENDPOINT_FILE), '{not json');
    assert.equal(readEndpoint(dir), null);
    fs.writeFileSync(path.join(dir, TOKEN_FILE), 'short');
    assert.equal(readToken(dir), null);
    fs.writeFileSync(path.join(dir, TOKEN_FILE), 'a'.repeat(64) + '\n');
    assert.equal(readToken(dir), 'a'.repeat(64));
  });

  test('never connects to an endpoint published before the current token', () => {
    const token = 'b'.repeat(64);
    const setAge = (file: string, secondsAgo: number) => {
      const t = new Date(Date.now() - secondsAgo * 1000);
      fs.utimesSync(path.join(dir, file), t, t);
    };

    fs.writeFileSync(path.join(dir, TOKEN_FILE), token);
    assert.equal(readConnectTarget(dir).ok, false, 'no endpoint yet: no default-port guess');

    // The previous launch's endpoint, and this launch's token: the app is
    // mid-start, and whatever holds the old port must not get the token.
    writeEndpointFile(dir, { url: 'http://127.0.0.1:19432/sse', pid: 1, startedAt: 1 });
    setAge(ENDPOINT_FILE, 60);
    setAge(TOKEN_FILE, 5);
    assert.deepEqual(readConnectTarget(dir), { ok: false, reason: 'the app is still starting' });

    // The app binds and publishes.
    writeEndpointFile(dir, { url: 'http://127.0.0.1:19433/sse', pid: 2, startedAt: 2 });
    assert.deepEqual(readConnectTarget(dir), { ok: true, url: 'http://127.0.0.1:19433/sse', token });
  });

  test('the connector sends the header the server checks', () => {
    // Two constants because the connector cannot import the server's module
    // (it would drag the database layer into a process that must start fast).
    assert.equal(TOKEN_HEADER, SERVER_TOKEN_HEADER);
  });
});

describe('connector command', () => {
  const base = {
    execPath: '/Applications/CodeTrellis.app/Contents/MacOS/CodeTrellis',
    electronVersion: '44.4.1',
    resourcesPath: '/Applications/CodeTrellis.app/Contents/Resources',
    cwd: '/',
    dataDir: '/Users/a/.codetrellis',
  };

  test('packaged: the app binary in Node mode, the script beside the asar', () => {
    const cmd = resolveConnectorCommand({ ...base, exists: (p) => p.startsWith(base.resourcesPath) });
    assert.deepEqual(cmd, {
      command: base.execPath,
      args: ['/Applications/CodeTrellis.app/Contents/Resources/connector/mcp-connector.cjs', '--data-dir', base.dataDir],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  test('web dev: plain Node, the built script in the checkout, no env', () => {
    const cmd = resolveConnectorCommand({
      ...base, execPath: '/usr/bin/node', electronVersion: undefined, resourcesPath: undefined, cwd: '/src/ct',
      exists: (p) => p === '/src/ct/out/connector/mcp-connector.cjs',
    });
    assert.deepEqual(cmd?.env, {});
    assert.equal(cmd?.args[0], '/src/ct/out/connector/mcp-connector.cjs');
  });

  test('no script built: null, so the copy surfaces fall back and say why', () => {
    assert.equal(resolveConnectorCommand({ ...base, exists: () => false }), null);
  });

  test('a packaged app never offers a script from its launch directory', () => {
    const cmd = resolveConnectorCommand({
      ...base, cwd: '/tmp/somewhere',
      exists: (p) => p === '/tmp/somewhere/out/connector/mcp-connector.cjs',
    });
    assert.equal(cmd, null);
  });

  test('Electron from a checkout uses the built script there, on the dev binary', () => {
    const cmd = resolveConnectorCommand({
      ...base,
      execPath: '/src/ct/node_modules/electron/dist/electron',
      resourcesPath: '/src/ct/node_modules/electron/dist/resources',
      cwd: '/src/ct',
      exists: (p) => p === '/src/ct/out/connector/mcp-connector.cjs',
    });
    assert.equal(cmd?.args[0], '/src/ct/out/connector/mcp-connector.cjs');
    assert.deepEqual(cmd?.env, { ELECTRON_RUN_AS_NODE: '1' });
  });

  test('the configs a user pastes carry no secret and survive paths with spaces', () => {
    const cmd = {
      command: 'C:\\Program Files\\CodeTrellis\\CodeTrellis.exe',
      args: ['C:\\Program Files\\CodeTrellis\\resources\\connector\\mcp-connector.cjs', '--data-dir', 'C:\\Users\\A B\\.codetrellis'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
    const line = claudeCodeConnectorCommand(cmd, 'win32');
    assert.match(line, /^claude mcp add codetrellis --scope user -e ELECTRON_RUN_AS_NODE=1 -- "C:\\Program Files\\CodeTrellis\\CodeTrellis.exe" /);
    assert.match(line, /"C:\\Users\\A B\\.codetrellis"$/);
    assert.deepEqual(connectorConfig(cmd), { codetrellis: { command: cmd.command, args: cmd.args, env: cmd.env } });
    assert.equal(shellQuote("it's here", 'darwin'), `'it'\\''s here'`);
    assert.equal(shellQuote('/plain/path.cjs', 'darwin'), '/plain/path.cjs');
  });
});

describe('client identity', () => {
  test('known clients map to the agent types the rest of the app uses', () => {
    assert.equal(agentTypeFromClientInfo('claude-code'), 'claude-code');
    assert.equal(agentTypeFromClientInfo('claude-ai'), 'claude-desktop');
    assert.equal(agentTypeFromClientInfo('cursor-vscode'), 'cursor');
  });

  test('unknown clients keep their own name rather than collapsing to mcp-client', () => {
    assert.equal(agentTypeFromClientInfo('My Team Bot!'), 'my-team-bot');
    assert.equal(agentTypeFromClientInfo(''), null);
    assert.equal(agentTypeFromClientInfo(undefined), null);
    assert.equal(agentTypeFromClientInfo('x'.repeat(100))?.length, 40);
  });
});
