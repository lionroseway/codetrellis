import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { connectorLine, flag, headlessDataDir, parseArgs } from './args';

test('a command, its flags with and without values, and the rest in order', () => {
  const p = parseArgs(['serve', '--project', '/work/app', '--json', '--port=4100', 'extra', '--', '--not-a-flag']);
  assert.equal(p.command, 'serve');
  assert.equal(flag(p, 'project'), '/work/app');
  assert.equal(p.flags.json, true);
  assert.equal(flag(p, 'json'), undefined);
  assert.equal(flag(p, 'port'), '4100');
  assert.deepEqual(p.rest, ['extra', '--not-a-flag']);
  // A switch never swallows the next word.
  assert.deepEqual(parseArgs(['scan', '--json', 'here']).rest, ['here']);
  for (const sw of ['--quiet', '--share-task-state', '--top', '--page']) assert.deepEqual(parseArgs(['start', sw, 'here']).rest, ['here'], sw);
  assert.equal(parseArgs(['-h']).flags.help, true);
  assert.equal(parseArgs([]).command, null);
});

test('a headless data dir is in the user\'s cache, one per project, never the checkout', () => {
  const linux = headlessDataDir('/work/board-pack', {}, '/home/sam', 'linux');
  assert.match(linux, /^\/home\/sam\/\.cache\/codetrellis\/board-pack-[a-f0-9]{10}$/);
  assert.equal(headlessDataDir('/work/board-pack', {}, '/home/sam', 'linux'), linux);
  assert.notEqual(headlessDataDir('/other/board-pack', {}, '/home/sam', 'linux'), linux);
  assert.match(headlessDataDir('/work/board-pack', { XDG_CACHE_HOME: '/var/cache/sam' }, '/home/sam', 'linux'), /^\/var\/cache\/sam\/codetrellis\//);
  // A relative XDG_CACHE_HOME is ignored, as the spec says.
  assert.match(headlessDataDir('/work/board-pack', { XDG_CACHE_HOME: 'rel' }, '/home/sam', 'linux'), /^\/home\/sam\/\.cache\//);
  assert.match(headlessDataDir('/work/board-pack', {}, '/Users/sam', 'darwin'), /^\/Users\/sam\/Library\/Caches\/codetrellis\//);
  assert.equal(headlessDataDir('/work/x', { CODETRELLIS_DATA_DIR: '/data/ct' }, '/home/sam', 'linux'), '/data/ct');
  assert.ok(!headlessDataDir('/work/board-pack', {}, '/home/sam', 'linux').startsWith('/work/'));
  // A name that is not a safe folder name is made one.
  assert.match(path.basename(headlessDataDir('/work/my app!', {}, '/home/sam', 'linux')), /^my-app-[a-f0-9]{10}$/);
});

test('the connector line names the CLI\'s own mcp command and carries no secret', () => {
  const l = connectorLine('/usr/bin/node', '/opt/ct/bin/codetrellis.mjs', '/home/sam/.cache/codetrellis/app-1');
  assert.deepEqual(l.args, ['/opt/ct/bin/codetrellis.mjs', 'mcp', '--data-dir', '/home/sam/.cache/codetrellis/app-1']);
  assert.equal(l.claude, 'claude mcp add codetrellis -- /usr/bin/node /opt/ct/bin/codetrellis.mjs mcp --data-dir /home/sam/.cache/codetrellis/app-1');
  assert.deepEqual(JSON.parse(l.json), { mcpServers: { codetrellis: { command: '/usr/bin/node', args: l.args } } });
  assert.ok(!/token/i.test(l.claude + l.json));
  assert.match(connectorLine('/usr/bin/node', '/opt/my ct/bin/codetrellis.mjs', '/d').claude, /'\/opt\/my ct\/bin\/codetrellis\.mjs'/);
});
