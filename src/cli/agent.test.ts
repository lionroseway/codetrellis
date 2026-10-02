import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentName, dataDirFor } from './agent';
import { headlessDataDir } from './args';

test('the CLI names itself after the agent running it, never the person', () => {
  assert.equal(agentName('codex', {}), 'codex');
  assert.equal(agentName(undefined, { CODETRELLIS_AGENT: 'aider' }), 'aider');
  assert.equal(agentName(undefined, { CLAUDECODE: '1' }), 'claude-code');
  assert.equal(agentName('  ', { CLAUDECODE: '1' }), 'claude-code');
  assert.equal(agentName(undefined, {}), 'codetrellis-cli');
});

test('it talks to the backend named, else the headless one for this folder, else the app\'s', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-agent-'));
  const env = { XDG_CACHE_HOME: path.join(home, 'cache'), HOME: home };
  const cwd = path.join(home, 'project');
  fs.mkdirSync(cwd);
  assert.equal(dataDirFor('/data/x', cwd, env), path.resolve('/data/x'));
  // No headless backend has published an endpoint: the app's.
  assert.equal(dataDirFor(undefined, cwd, { ...env, CODETRELLIS_DATA_DIR: '/app/data' }), '/app/data');
  const here = headlessDataDir(cwd, env, os.homedir());
  fs.mkdirSync(here, { recursive: true });
  fs.writeFileSync(path.join(here, 'mcp-endpoint.json'), '{}');
  assert.equal(dataDirFor(undefined, cwd, env), here);
  fs.rmSync(home, { recursive: true, force: true });
});
