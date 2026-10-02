/**
 * The parallel skill and the optional hook for Claude Code (Phase 32 A3.4):
 * what is written, where, and that nothing is written the person did not
 * choose and see.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SETTINGS_FILE, SKILL_FILE, applyClaudeCode, claudeCodeDir, hookCommand, planHook, previewClaudeCode, skillText,
  type ClaudeCodeWhere,
} from './claude-code-parallel';
import { hashOf } from './claude-desktop-config';
import { buildSkillGuide } from '../mcp/skill-guide';

const CONNECTOR = { command: '/Applications/Code Trellis.app/Contents/MacOS/CodeTrellis', args: ['/r/connector/mcp-connector.cjs', '--data-dir', '/d'], env: { ELECTRON_RUN_AS_NODE: '1' } };
const COMMAND = hookCommand(CONNECTOR);

function home(): { where: ClaudeCodeWhere; dir: string } {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-claude-code-'));
  const dir = path.join(h, '.claude');
  fs.mkdirSync(dir);
  return { where: { home: h, env: {}, exists: (p) => fs.existsSync(p) }, dir };
}

describe('where, and what', () => {
  test("Claude Code's folder: ~/.claude, or CLAUDE_CONFIG_DIR, only where it exists", () => {
    const at = (existing: string[], env: Record<string, string> = {}) => claudeCodeDir({ home: '/h', env, exists: (p) => existing.includes(p) });
    assert.equal(at(['/h/.claude']), '/h/.claude');
    assert.equal(at(['/cfg'], { CLAUDE_CONFIG_DIR: '/cfg' }), '/cfg');
    assert.equal(at([]), null);
  });

  test('the skill is the parallel guide, with the frontmatter Claude Code loads it by', () => {
    const text = skillText();
    assert.match(text, /^---\nname: codetrellis-parallel\ndescription: .+\n---\n/);
    // Generated from the guide, so the two never drift: every line of its body is here.
    const guide = buildSkillGuide('parallel').replace(/^# .*\n+/, '');
    assert.ok(text.includes(guide.trimEnd()));
    assert.match(text, /mcp__codetrellis__get_awareness/);
  });

  test('the hook runs the connector this app resolved, in hook mode, quoted for a POSIX shell', () => {
    assert.equal(COMMAND, "ELECTRON_RUN_AS_NODE=1 '/Applications/Code Trellis.app/Contents/MacOS/CodeTrellis' /r/connector/mcp-connector.cjs --data-dir /d --hook pre-tool-use");
  });
});

describe('the settings merge', () => {
  const ours = { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: COMMAND, timeout: 10 }] };

  test('adds one PreToolUse entry and keeps every other setting and hook', () => {
    const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'lint.sh' }] };
    const current = JSON.stringify({ model: 'opus', hooks: { PreToolUse: [theirs], Stop: [{ hooks: [] }] }, permissions: { allow: ['Read'] } }, null, 2);
    const plan = planHook(current, COMMAND);
    assert.ok(plan.ok);
    assert.equal(plan.status, 'update');
    const after = JSON.parse(plan.after);
    assert.equal(after.model, 'opus');
    assert.deepEqual(after.permissions, { allow: ['Read'] });
    assert.deepEqual(after.hooks.Stop, [{ hooks: [] }]);
    assert.deepEqual(after.hooks.PreToolUse, [theirs, ours]);
  });

  test('a new file gets just the hook; applying twice changes nothing', () => {
    const first = planHook(null, COMMAND);
    assert.ok(first.ok);
    assert.equal(first.status, 'add');
    assert.deepEqual(JSON.parse(first.after), { hooks: { PreToolUse: [ours] } });
    const again = planHook(first.after, COMMAND);
    assert.ok(again.ok);
    assert.equal(again.status, 'unchanged');
    assert.deepEqual(again.diff, []);
  });

  test('an older entry of ours (another install) is replaced in place, never duplicated', () => {
    const old = { type: 'command', command: '/old/CodeTrellis /old/mcp-connector.cjs --hook pre-tool-use', timeout: 5 };
    const mixed = { matcher: 'Edit', hooks: [old, { type: 'command', command: 'fmt.sh' }] };
    const plan = planHook(JSON.stringify({ hooks: { PreToolUse: [mixed, { matcher: 'Write', hooks: [old] }] } }), COMMAND);
    assert.ok(plan.ok);
    assert.deepEqual(JSON.parse(plan.after).hooks.PreToolUse, [ours, { matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt.sh' }] }]);
  });

  test('settings it does not understand are left alone, with why', () => {
    for (const bad of ['{ not json', '[]', '{"hooks": []}', '{"hooks": {"PreToolUse": {}}}']) {
      const plan = planHook(bad, COMMAND);
      assert.equal(plan.ok, false, bad);
      assert.match((plan as { reason: string }).reason, /left alone/);
    }
  });
});

describe('preview and apply', () => {
  test('nothing is offered where Claude Code has never run', () => {
    const w: ClaudeCodeWhere = { home: '/nowhere', env: {}, exists: () => false };
    assert.deepEqual(previewClaudeCode(w, CONNECTOR), { ok: false, reason: "Claude Code's settings folder (~/.claude) was not found on this computer. Install Claude Code and run it once, then try again." });
    assert.equal(applyClaudeCode(w, CONNECTOR, { skill: 'a'.repeat(64) }).ok, false);
  });

  test('the skill alone writes the skill, and settings.json is not touched', () => {
    const { where, dir } = home();
    const settings = JSON.stringify({ model: 'opus' });
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), settings);
    const p = previewClaudeCode(where, CONNECTOR);
    assert.ok(p.ok);
    assert.equal(p.skill.status, 'add');
    assert.ok('beforeHash' in p.hook && p.hook.status === 'update');

    const r = applyClaudeCode(where, CONNECTOR, { skill: p.skill.beforeHash });
    assert.ok(r.ok);
    assert.equal(r.skill?.status, 'add');
    assert.equal(r.hook, undefined);
    assert.equal(fs.readFileSync(path.join(dir, SKILL_FILE), 'utf-8'), skillText());
    assert.equal(fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf-8'), settings);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['settings.json', 'skills']);

    // Shown again, the skill is up to date.
    const again = previewClaudeCode(where, CONNECTOR);
    assert.ok(again.ok);
    assert.equal(again.skill.status, 'unchanged');
  });

  test('both: the hook is merged, the old settings kept beside it', () => {
    const { where, dir } = home();
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ model: 'opus' }));
    const p = previewClaudeCode(where, CONNECTOR);
    assert.ok(p.ok && 'beforeHash' in p.hook);
    const r = applyClaudeCode(where, CONNECTOR, { skill: p.skill.beforeHash, hook: (p.hook as { beforeHash: string }).beforeHash }, new Date('2026-09-28T10:00:00Z'));
    assert.ok(r.ok);
    assert.equal(r.hook?.backupPath, path.join(dir, 'settings.before-codetrellis-2026-09-28T10-00-00-000Z.json'));
    assert.equal(fs.readFileSync(r.hook!.backupPath!, 'utf-8'), JSON.stringify({ model: 'opus' }));
    const after = JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf-8'));
    assert.equal(after.model, 'opus');
    assert.equal(after.hooks.PreToolUse[0].hooks[0].command, COMMAND);
  });

  test('a file that changed after it was shown: nothing is written, not even the other one', () => {
    const { where, dir } = home();
    const p = previewClaudeCode(where, CONNECTOR);
    assert.ok(p.ok && 'beforeHash' in p.hook);
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ model: 'sonnet' }));
    const r = applyClaudeCode(where, CONNECTOR, { skill: p.skill.beforeHash, hook: (p.hook as { beforeHash: string }).beforeHash });
    assert.deepEqual(r, { ok: false, changed: true, reason: "Claude Code's settings.json changed after you looked at it. Here is the change again, against the file as it is now." });
    assert.equal(fs.existsSync(path.join(dir, SKILL_FILE)), false);
    assert.equal(fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf-8'), JSON.stringify({ model: 'sonnet' }));
  });

  test('no connector: the skill is still offered, the hook says why it is not', () => {
    const { where } = home();
    const p = previewClaudeCode(where, null);
    assert.ok(p.ok);
    assert.deepEqual(p.hook, { unavailable: 'The connector is not built in this checkout, so there is no hook to add yet (npm run build:connector).' });
    assert.equal(applyClaudeCode(where, null, { hook: hashOf(null) }).ok, false);
  });

  test("the portable build's caveat comes with the hook: it stops working after an update", () => {
    const { where } = home();
    const p = previewClaudeCode(where, { ...CONNECTOR, caveat: 'This is the portable build.' });
    assert.ok(p.ok && 'beforeHash' in p.hook);
    assert.equal((p.hook as { caveat?: string }).caveat, 'This is the portable build.');
  });

  test('a link planted at settings.json is not followed', () => {
    const { where, dir } = home();
    const elsewhere = path.join(path.dirname(dir), 'elsewhere.json');
    fs.writeFileSync(elsewhere, '{}');
    fs.symlinkSync(elsewhere, path.join(dir, SETTINGS_FILE));
    const p = previewClaudeCode(where, CONNECTOR);
    assert.ok(p.ok);
    assert.ok('unavailable' in p.hook && /link/.test(p.hook.unavailable));
    assert.equal(applyClaudeCode(where, CONNECTOR, { hook: hashOf('{}') }).ok, false);
    assert.equal(fs.readFileSync(elsewhere, 'utf-8'), '{}');
  });
});
