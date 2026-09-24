import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONFIG_NAME, applyClaudeDesktop, claudeDesktopConfigDir, hashOf, lineDiff, planMerge, previewClaudeDesktop, type Where,
} from './claude-desktop-config';

const ENTRY = { command: '/Applications/CodeTrellis.app/Contents/MacOS/CodeTrellis', args: ['/x/mcp-connector.cjs', '--data-dir', '/d'], env: { ELECTRON_RUN_AS_NODE: '1' } };

function where(platform: NodeJS.Platform, existing: string[], env: Record<string, string> = {}, listing: Record<string, string[]> = {}): Where {
  return { platform, env, home: '/home/u', exists: (p) => existing.includes(p), list: (d) => listing[d] ?? [] };
}

test('the config folder, per platform, only where it exists', () => {
  assert.equal(claudeDesktopConfigDir(where('darwin', ['/home/u/Library/Application Support/Claude'])), '/home/u/Library/Application Support/Claude');
  assert.equal(claudeDesktopConfigDir(where('darwin', [])), null);
  assert.equal(claudeDesktopConfigDir(where('linux', ['/home/u/.config/Claude'])), '/home/u/.config/Claude');
  assert.equal(claudeDesktopConfigDir(where('linux', ['/xdg/Claude'], { XDG_CONFIG_HOME: '/xdg' })), '/xdg/Claude');
  const win = path.join('C:\\Users\\u\\AppData\\Roaming', 'Claude');
  assert.equal(claudeDesktopConfigDir(where('win32', [win], { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' })), win);
  // The Microsoft Store build keeps it under its package folder.
  const local = 'C:\\Users\\u\\AppData\\Local';
  const packages = path.join(local, 'Packages');
  const store = path.join(packages, 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
  assert.equal(claudeDesktopConfigDir(where('win32', [packages, store], { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: local }, { [packages]: ['Microsoft.Foo', 'Claude_pzs8sxrjxfjjc'] })), store);
});

test('the merge adds our entry and changes nothing else', () => {
  const current = JSON.stringify({ globalShortcut: 'Cmd+Space', mcpServers: { other: { command: 'x' } } }, null, 2);
  const plan = planMerge(current, ENTRY);
  assert.ok(plan.ok);
  assert.equal(plan.status, 'add');
  const after = JSON.parse(plan.after);
  assert.equal(after.globalShortcut, 'Cmd+Space');
  assert.deepEqual(after.mcpServers.other, { command: 'x' });
  assert.deepEqual(after.mcpServers.codetrellis, ENTRY);
  assert.ok(plan.diff.some((l) => l.op === '+' && l.text.includes('"codetrellis"')));
  assert.ok(!plan.diff.some((l) => l.op === '-'), 'nothing of theirs removed');
});

test('an absent or empty file becomes one with just our entry; an identical entry changes nothing', () => {
  for (const current of [null, '', '  \n']) {
    const plan = planMerge(current, ENTRY);
    assert.ok(plan.ok && plan.status === 'add');
    assert.deepEqual(JSON.parse(plan.after), { mcpServers: { codetrellis: ENTRY } });
  }
  const done = `${JSON.stringify({ mcpServers: { codetrellis: ENTRY } }, null, 2)}\n`;
  const again = planMerge(done, ENTRY);
  assert.ok(again.ok && again.status === 'unchanged' && again.after === done && again.diff.length === 0);
  const moved = planMerge(done, { ...ENTRY, command: '/elsewhere/CodeTrellis' });
  assert.ok(moved.ok && moved.status === 'update');
  assert.ok(moved.diff.some((l) => l.op === '-' && l.text.includes('/Applications/CodeTrellis.app')));
});

test('a file that is not what we expect is left alone, with a reason', () => {
  for (const bad of ['{ not json', '[1,2]', '"str"', JSON.stringify({ mcpServers: [] }), JSON.stringify({ mcpServers: 'x' })]) {
    const plan = planMerge(bad, ENTRY);
    assert.equal(plan.ok, false, bad);
    assert.ok(!plan.ok && plan.reason.length > 10);
  }
});

test('lineDiff marks only what changed', () => {
  assert.deepEqual(lineDiff('a\nb\nc\n', 'a\nx\nc\n'), [{ op: ' ', text: 'a' }, { op: '-', text: 'b' }, { op: '+', text: 'x' }, { op: ' ', text: 'c' }]);
  assert.deepEqual(lineDiff('', 'a\n'), [{ op: '+', text: 'a' }]);
});

function sandbox(): { dir: string; w: Where; cleanup: () => void } {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-claude-')));
  const dir = path.join(home, '.config', 'Claude');
  fs.mkdirSync(dir, { recursive: true });
  const w: Where = { platform: 'linux', env: {}, home, exists: (p) => fs.existsSync(p), list: (d) => fs.readdirSync(d) };
  return { dir, w, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('apply writes what was previewed, keeps the old file, and refuses a file that changed since', () => {
  const { dir, w, cleanup } = sandbox();
  try {
    const file = path.join(dir, CONFIG_NAME);
    const original = `${JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2)}\n`;
    fs.writeFileSync(file, original);
    const preview = previewClaudeDesktop(w, ENTRY);
    assert.ok(preview.ok && preview.status === 'add' && preview.exists);

    // Edited by someone else between preview and apply: nothing written.
    fs.writeFileSync(file, original.replace('"x"', '"y"'));
    const stale = applyClaudeDesktop(w, ENTRY, preview.beforeHash);
    assert.ok(!stale.ok && stale.changed);
    assert.ok(fs.readFileSync(file, 'utf8').includes('"y"'));

    const fresh = previewClaudeDesktop(w, ENTRY);
    assert.ok(fresh.ok);
    const applied = applyClaudeDesktop(w, ENTRY, fresh.beforeHash, new Date('2026-09-24T12:00:00Z'));
    assert.ok(applied.ok && applied.backupPath);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.codetrellis, ENTRY);
    assert.equal(fs.readFileSync(applied.backupPath, 'utf8'), original.replace('"x"', '"y"'));
    assert.match(path.basename(applied.backupPath), /^claude_desktop_config\.before-codetrellis-2026-09-24T12-00-00-000Z\.json$/);

    // Again: nothing to do, nothing written, no second backup.
    const again = previewClaudeDesktop(w, ENTRY);
    assert.ok(again.ok && again.status === 'unchanged');
    const noop = applyClaudeDesktop(w, ENTRY, again.beforeHash);
    assert.ok(noop.ok && noop.status === 'unchanged' && noop.backupPath === null);
    assert.equal(fs.readdirSync(dir).filter((f) => f.includes('before-codetrellis')).length, 1);
  } finally { cleanup(); }
});

test('a config that is a link is not read or written through', () => {
  const { dir, w, cleanup } = sandbox();
  try {
    const elsewhere = path.join(path.dirname(dir), 'elsewhere.json');
    fs.writeFileSync(elsewhere, '{}');
    fs.symlinkSync(elsewhere, path.join(dir, CONFIG_NAME));
    const preview = previewClaudeDesktop(w, ENTRY);
    assert.equal(preview.ok, false);
    const applied = applyClaudeDesktop(w, ENTRY, hashOf('{}'));
    assert.equal(applied.ok, false);
    assert.equal(fs.readFileSync(elsewhere, 'utf8'), '{}');
  } finally { cleanup(); }
});

test('no Claude Desktop, or no connector: a sentence, and nothing created', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-noclaude-')));
  try {
    const w: Where = { platform: 'linux', env: {}, home, exists: (p) => fs.existsSync(p), list: () => [] };
    const p = previewClaudeDesktop(w, ENTRY);
    assert.ok(!p.ok && /not found/.test(p.reason));
    assert.ok(!fs.existsSync(path.join(home, '.config')));
    const n = previewClaudeDesktop(w, null);
    assert.ok(!n.ok && /connector/.test(n.reason));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
