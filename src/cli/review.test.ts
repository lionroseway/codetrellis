/**
 * Phase 33 C4 — `codetrellis review`, its pure parts: the flags, the skills,
 * the environment the agent gets, each adapter's deny-by-default command and
 * how it reads the CLI's output, and the sink's refusals. The whole run, with
 * a stand-in for the agent CLI, is tests/e2e/agent-review-cli.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from './args';
import { agentEnv, readSkills, reviewOptions, ReviewUsageError } from './review';
import { adapterFor } from './review-adapters';
import { handleSinkCall, PASS_FILES } from './review-sink';

const opts = (line: string, env: NodeJS.ProcessEnv = {}) => reviewOptions(parseArgs(['review', ...line.split(' ').filter(Boolean)]), process.cwd(), env);

test('flags: an agent we offer, a key by the variable that holds it, budgets in range, --fail-on block or error', () => {
  const o = opts('--auth env:KEY --max-turns 12 --timeout 90 --fail-on block,error', { KEY: 'k' });
  assert.equal(o.adapter.id, 'claude-code');
  assert.equal(o.authVar, 'KEY');
  assert.equal(o.maxTurns, 12);
  assert.equal(o.timeoutMs, 90_000);
  assert.deepEqual([...o.failOn], ['block', 'error']);
  assert.throws(() => opts('--agent cursor'), ReviewUsageError);
  assert.throws(() => opts('--auth sk-live-123'), /env:<VARIABLE>/);
  assert.throws(() => opts('--auth env:KEY'), /KEY is not set/);
  assert.throws(() => opts('--agent codex'), /runs on a key/);
  assert.throws(() => opts('--max-turns 0'), /--max-turns/);
  assert.throws(() => opts('--endpoint ftp://x'), /http/);
  assert.throws(() => opts('--fail-on warn'), /--fail-on/);
  assert.equal(opts('', { CODETRELLIS_REVIEW_CLAUDE: '/opt/claude' }).bin, '/opt/claude');
});

test('skills: each *.md, or a folder\'s SKILL.md, is a pass; none named is the built-in one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-skills-'));
  fs.writeFileSync(path.join(dir, 'b.md'), 'B');
  fs.mkdirSync(path.join(dir, 'a'));
  fs.writeFileSync(path.join(dir, 'a', 'SKILL.md'), 'A');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a skill');
  assert.deepEqual(readSkills(dir, '/'), [{ name: 'a', text: 'A' }, { name: 'b', text: 'B' }]);
  assert.equal(readSkills(undefined, '/')[0].name, 'review');
  assert.throws(() => readSkills(path.join(dir, 'a', 'nope'), '/'), /no such folder/);
});

test('the agent\'s environment: enough to run and the one key named; nothing else of ours', () => {
  const env = { PATH: '/bin', HOME: '/home/sam', KEY: 'k-123', GITHUB_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 's', CODETRELLIS_DATA_DIR: '/d', AWS_REGION: 'eu-west-2' };
  const claude = agentEnv(env, { adapter: adapterFor('claude-code')!, authVar: 'KEY', endpoint: 'https://gw.acme.test', model: null });
  assert.deepEqual(Object.keys(claude).sort(), ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'AWS_REGION', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'HOME', 'PATH']);
  assert.equal(claude.ANTHROPIC_API_KEY, 'k-123');
  const codex = agentEnv(env, { adapter: adapterFor('codex')!, authVar: 'KEY', endpoint: null, model: 'gpt-5' });
  assert.deepEqual(Object.keys(codex).sort(), ['CODETRELLIS_REVIEW_KEY', 'HOME', 'PATH']);
});

test('Codex: no shell, no web, read-only, its own home and provider, the sink\'s two tools approved; its JSONL read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-codex-'));
  const cmd = adapterFor('codex')!.command({ instructions: 'I', message: 'M', sink: { command: '/node', args: ['/ct.mjs', 'review-sink', '--pass', dir] }, model: 'gpt-5', endpoint: 'http://localhost:8000/v1', maxTurns: 5, dir, work: dir, withKey: true });
  const sets = cmd.args.flatMap((a, i) => (cmd.args[i - 1] === '-c' ? [a] : []));
  for (const s of ['features.shell_tool=false', 'web_search="disabled"', 'features.view_image=false', 'features.multi_agent=false', 'project_doc_max_bytes=0',
    'mcp_servers.codetrellis_review.enabled_tools=["report_review", "read_change_file"]', 'mcp_servers.codetrellis_review.default_tools_approval_mode="approve"',
    'model_providers.codetrellis_review.base_url="http://localhost:8000/v1"', 'model_providers.codetrellis_review.env_key="CODETRELLIS_REVIEW_KEY"', 'model_provider="codetrellis_review"'])
    assert.ok(sets.includes(s), s);
  assert.deepEqual(cmd.args.slice(0, 6), ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only']);
  assert.equal(cmd.env?.CODEX_HOME, path.join(dir, 'codex-home'));
  assert.equal(cmd.stdin, 'M');

  const out = [
    { type: 'thread.started', thread_id: 't' },
    { type: 'item.completed', item: { type: 'command_execution', command: 'env', status: 'failed' } },
    { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'codetrellis_review', tool: 'read_change_file', status: 'failed', error: { message: 'Refused: .env is not a file in the change' } } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Should this exist?' } },
    { type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 100 } },
  ].map((e) => JSON.stringify(e)).join('\n');
  const run = adapterFor('codex')!.parse(out, '', 0);
  assert.deepEqual(run, { finalText: 'Should this exist?', refused: ['a shell command: env', 'codetrellis_review.read_change_file: Refused: .env is not a file in the change'], hitTurns: false, error: null, turns: 1, tokens: 1000 });
  assert.equal(adapterFor('codex')!.parse('', 'error: unknown config key', 2).error, 'error: unknown config key');
});

test('Claude Code: its result read: the turn limit, denials, an error', () => {
  const parse = adapterFor('claude-code')!.parse;
  const turns = parse(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 30 }), '', 1);
  assert.equal(turns.hitTurns, true);
  assert.equal(turns.error, null);
  const denied = parse(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', permission_denials: [{ tool_name: 'Bash' }], usage: { input_tokens: 5, output_tokens: 6 } }), '', 0);
  assert.deepEqual(denied.refused, ['Bash: denied by the CLI (not on the review\'s allowlist)']);
  assert.equal(denied.tokens, 11);
  assert.equal(parse('', 'command not found', 127).error, 'command not found');
});

test('the sink: the report taken, a changed file read, anything else refused and recorded, and the budget held', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sink-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-root-'));
  fs.writeFileSync(path.join(root, 'a.ts'), 'one\ntwo\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  const setup = { root, files: ['a.ts'], maxToolCalls: 3 };
  assert.match(handleSinkCall(dir, setup, 'read_change_file', { file: 'a.ts' }).content[0].text, /1 \| one\n2 \| two$/);
  assert.equal(handleSinkCall(dir, setup, 'read_change_file', { file: '.env' }).isError, true);
  assert.equal(handleSinkCall(dir, setup, 'Bash', { command: 'env' }).isError, true);
  assert.match(handleSinkCall(dir, setup, 'read_change_file', { file: 'a.ts' }).content[0].text, /budget of 3 tool calls is spent/);
  assert.equal(handleSinkCall(dir, setup, 'report_review', { findings: [{ kind: 'question', says: 'Why?' }] }).isError, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, PASS_FILES.report), 'utf8')), { findings: [{ kind: 'question', says: 'Why?' }], inconclusive: null });
  assert.deepEqual(fs.readFileSync(path.join(dir, PASS_FILES.refused), 'utf8').trim().split('\n').map((l) => JSON.parse(l).why), [
    '.env is not a file in the change', 'Bash is not a tool this review may use', 'the pass\'s budget of 3 tool calls is spent; call report_review now',
  ]);
});
