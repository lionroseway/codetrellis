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
import {
  APPIMAGE_BOOTSTRAP,
  PORTABLE_CAVEAT,
  claudeCodeConnectorCommand,
  connectorConfig,
  resolveConnectorCommand,
  shellQuote,
} from './command';
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

  test('a link planted at either file is refused, not followed', { skip: process.platform === 'win32' }, () => {
    const elsewhere = path.join(dir, 'elsewhere');
    fs.writeFileSync(elsewhere, 'c'.repeat(64));
    fs.symlinkSync(elsewhere, path.join(dir, TOKEN_FILE));
    assert.equal(readToken(dir), null, 'the token is not read through a link');

    fs.writeFileSync(path.join(dir, 'victim'), 'untouched');
    fs.symlinkSync(path.join(dir, 'victim'), path.join(dir, ENDPOINT_FILE));
    assert.throws(() => writeEndpointFile(dir, { url: 'http://127.0.0.1:1/sse', pid: 1, startedAt: 1 }));
    assert.equal(fs.readFileSync(path.join(dir, 'victim'), 'utf-8'), 'untouched', 'nothing written through the link');
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

  describe('Linux AppImage', () => {
    // What the AppImage runtime hands the app: a fresh mount every launch.
    const mount = '/tmp/.mount_CodeTrA1b2C3';
    const appImage = '/home/a/Apps/CodeTrellis-0.1.17-x86_64.AppImage';
    const launched = {
      ...base,
      execPath: `${mount}/codetrellis`,
      resourcesPath: `${mount}/resources`,
      dataDir: '/home/a/.codetrellis',
      env: { APPIMAGE: appImage, APPDIR: mount },
    };
    const onDisk = (p: string) => p === appImage || p === `${mount}/resources/connector/mcp-connector.cjs`;

    test('the config names the AppImage file, never the mount', () => {
      const cmd = resolveConnectorCommand({ ...launched, exists: onDisk });
      assert.deepEqual(cmd, {
        command: appImage,
        args: ['-e', APPIMAGE_BOOTSTRAP, '--', '--data-dir', '/home/a/.codetrellis', '--no-sandbox'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      });
      assert.ok(!JSON.stringify(cmd).includes('.mount_'), 'nothing in it dies with this launch');
    });

    test('two launches, two mounts, one config', () => {
      const other = '/tmp/.mount_CodeTrZz9Yy8';
      const again = resolveConnectorCommand({
        ...launched,
        execPath: `${other}/codetrellis`,
        resourcesPath: `${other}/resources`,
        env: { APPIMAGE: appImage, APPDIR: other },
        exists: (p) => p === appImage || p === `${other}/resources/connector/mcp-connector.cjs`,
      });
      assert.deepEqual(again, resolveConnectorCommand({ ...launched, exists: onDisk }));
    });

    test('the bootstrap loads the connector this binary shipped, and nothing spliced in', () => {
      assert.equal(
        APPIMAGE_BOOTSTRAP,
        "require(require('path').join(process.resourcesPath, 'connector', 'mcp-connector.cjs'))",
      );
    });

    test('the arguments survive Node\'s option parser and AppRun\'s sandbox probe', () => {
      const args = resolveConnectorCommand({ ...launched, exists: onDisk })!.args;
      // Everything after `--` is the connector's; before it, only Node's own `-e`.
      const end = args.indexOf('--');
      assert.deepEqual(args.slice(0, end), ['-e', APPIMAGE_BOOTSTRAP]);
      // AppRun prepends --no-sandbox unless an argument already is one;
      // prepended, Node would exit with "bad option".
      assert.ok(args.slice(end + 1).includes('--no-sandbox'));
    });

    test('shell-quoted for `claude mcp add`', () => {
      const line = claudeCodeConnectorCommand(resolveConnectorCommand({ ...launched, exists: onDisk })!, 'linux');
      assert.equal(
        line,
        'claude mcp add codetrellis --scope user -e ELECTRON_RUN_AS_NODE=1 -- '
        + `${appImage} -e 'require(require('\\''path'\\'').join(process.resourcesPath, '\\''connector'\\'', '\\''mcp-connector.cjs'\\''))' `
        + '-- --data-dir /home/a/.codetrellis --no-sandbox',
      );
    });

    test('APPIMAGE alone does not redirect a .deb install', () => {
      // An ordinary environment variable: only the mount the binary runs from counts.
      const deb = {
        ...base,
        execPath: '/opt/CodeTrellis/codetrellis',
        resourcesPath: '/opt/CodeTrellis/resources',
        exists: (p: string) => p === appImage || p.startsWith('/opt/CodeTrellis/'),
      };
      for (const env of [
        { APPIMAGE: appImage },
        { APPIMAGE: appImage, APPDIR: mount },
        { APPIMAGE: appImage, APPDIR: '/opt/CodeTrellis/..' },
        { APPIMAGE: 'CodeTrellis.AppImage', APPDIR: '/opt/CodeTrellis' },
      ]) {
        const cmd = resolveConnectorCommand({ ...deb, env });
        assert.equal(cmd?.command, '/opt/CodeTrellis/codetrellis', JSON.stringify(env));
        assert.equal(cmd?.args[0], '/opt/CodeTrellis/resources/connector/mcp-connector.cjs');
      }
    });

    test('an AppImage file that has gone is not offered', () => {
      const cmd = resolveConnectorCommand({ ...launched, exists: (p) => p !== appImage && onDisk(`${p}`) });
      assert.equal(cmd?.command, launched.execPath, 'falls back to this launch, which at least works now');
    });

    test('an AppImage that shipped no connector offers none', () => {
      assert.equal(resolveConnectorCommand({ ...launched, exists: (p) => p === appImage }), null);
    });

    test('a checkout run never takes the AppImage path', () => {
      const cmd = resolveConnectorCommand({
        ...launched,
        execPath: '/src/ct/node_modules/electron/dist/electron',
        cwd: '/src/ct',
        env: { APPIMAGE: appImage, APPDIR: '/src/ct/node_modules/electron/dist' },
        exists: (p) => p === appImage || p === '/src/ct/out/connector/mcp-connector.cjs',
      });
      assert.equal(cmd?.command, '/src/ct/node_modules/electron/dist/electron');
    });
  });

  describe('Windows portable', () => {
    // electron-builder's portable launcher unpacks to %TEMP%\<build id> and
    // runs the app from there; its own .exe cannot carry stdio (NSIS ExecWait
    // hands the child no handles), so it is never the command.
    const unpacked = 'C:\\Users\\A\\AppData\\Local\\Temp\\2mXk3Q9pZ8';
    const portable = {
      ...base,
      execPath: `${unpacked}\\CodeTrellis.exe`,
      resourcesPath: `${unpacked}\\resources`,
      env: { PORTABLE_EXECUTABLE_FILE: 'C:\\Users\\A\\Downloads\\CodeTrellis-Portable-0.1.17.exe' },
      exists: () => true,
    };

    test('runs the unpacked binary, and says when that stops working', () => {
      const cmd = resolveConnectorCommand(portable);
      assert.equal(cmd?.command, portable.execPath);
      assert.deepEqual(cmd?.env, { ELECTRON_RUN_AS_NODE: '1' });
      assert.equal(cmd?.caveat, PORTABLE_CAVEAT);
      assert.notEqual(cmd?.command, portable.env.PORTABLE_EXECUTABLE_FILE);
    });

    test('the caveat is for the person, never part of the config', () => {
      const cmd = resolveConnectorCommand(portable)!;
      assert.ok(!JSON.stringify(connectorConfig(cmd)).includes('portable build'));
      assert.ok(!claudeCodeConnectorCommand(cmd, 'win32').includes('portable build'));
    });

    test('an installed app carries no caveat', () => {
      assert.equal(resolveConnectorCommand({ ...portable, env: {} })?.caveat, undefined);
      assert.equal(resolveConnectorCommand({ ...base, exists: () => true })?.caveat, undefined);
    });
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

  test('a client cannot name itself into the human\'s seat', () => {
    // channel-tools attributes an mcp-client session to the human.
    for (const name of ['mcp-client', 'MCP Client', 'human', 'user', 'mcp-agent']) {
      assert.equal(agentTypeFromClientInfo(name), null, name);
    }
  });

  test('unknown clients keep their own name rather than collapsing to mcp-client', () => {
    assert.equal(agentTypeFromClientInfo('My Team Bot!'), 'my-team-bot');
    assert.equal(agentTypeFromClientInfo(''), null);
    assert.equal(agentTypeFromClientInfo(undefined), null);
    assert.equal(agentTypeFromClientInfo('x'.repeat(100))?.length, 40);
  });
});
