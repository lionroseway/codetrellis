/**
 * A stand-in for `claude -p` in tests of `codetrellis review` (Phase 33 C4).
 * CI has no model key, so this plays the model's part: it takes the same
 * arguments Claude Code's print mode does, starts the MCP servers its
 * `--mcp-config` names, reads the message on stdin, behaves as the scenario
 * says, and prints a result in Claude Code's `--output-format json` shape.
 *
 *   node stub-agent-cli.mjs <scenario> <record.json> [claude's arguments…]
 *
 * It writes what it was given (arguments, environment, message, system
 * prompt and MCP config) to
 * record.json, so a test can see the adapter's deny-by-default flags and
 * that no secret reached it.
 */

import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [scenario, recordFile, ...args] = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const message = fs.readFileSync(0, 'utf8');
const runs = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf8')) : [];
const read = (f) => (f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
runs.push({ args, env: process.env, message, cwd: process.cwd(), system: read(arg('--system-prompt-file')), mcp: read(arg('--mcp-config')) });
fs.writeFileSync(recordFile, JSON.stringify(runs, null, 2));

const result = (extra) => {
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, usage: { input_tokens: 1200, output_tokens: 300 }, permission_denials: [], result: 'Done.', ...extra })}\n`);
};

if (scenario === 'refused-key') {
  process.stderr.write(`Invalid API key: ${process.env.ANTHROPIC_API_KEY ?? 'none'}\n`);
  result({ is_error: true, subtype: 'error_during_execution', result: `Invalid API key · ${process.env.ANTHROPIC_API_KEY ?? 'none'} was refused` });
  process.exit(1);
}
if (scenario === 'slow') { await new Promise((r) => setTimeout(r, 120_000)); }
if (scenario === 'turns') { result({ is_error: true, subtype: 'error_max_turns', num_turns: Number(arg('--max-turns')), result: '' }); process.exit(1); }
if (scenario === 'silent') { result({ result: 'I looked at the change.' }); process.exit(0); }
if (scenario === 'question') { result({ result: 'The quick charge skips checkout. Should it exist at all, or go through checkout?' }); process.exit(0); }

const config = JSON.parse(fs.readFileSync(arg('--mcp-config'), 'utf8'));
const [name, server] = Object.entries(config.mcpServers)[0];
const client = new Client({ name: 'stub-agent', version: '0' }, { capabilities: {} });
await client.connect(new StdioClientTransport({ command: server.command, args: server.args, stderr: 'ignore' }));
const call = async (tool, a) => {
  const r = await client.callTool({ name: tool, arguments: a });
  return { isError: r.isError === true, text: (r.content ?? []).map((c) => c.text ?? '').join('\n') };
};
// C5: a verify pass is given report_verdicts. It holds every finding but a bug, which it refutes.
if ((await client.listTools()).tools.some((t) => t.name === 'report_verdicts')) {
  const findings = JSON.parse(message.slice(message.indexOf('<findings>') + 10, message.indexOf('</findings>')));
  await call('report_verdicts', { verdicts: findings.map((f) => ({ finding: f.finding, holds: f.kind !== 'bug', why: f.kind === 'bug' ? 'Line 900 is not in the change.' : 'The cited line calls Stripe directly.' })) });
  await client.close();
  result({});
  process.exit(0);
}

const bundle = JSON.parse(message.slice(message.indexOf('<bundle>') + 8, message.indexOf('</bundle>')));
const api = bundle.data.files.find((f) => f.path.endsWith('api.ts'));
const lineOf = (needle) => {
  for (const h of api.hunks) for (const l of h.lines.split('\n')) { const m = /^\s*(\d+) \| (.*)$/.exec(l); if (m && m[2].includes(needle)) return Number(m[1]); }
  return null;
};
const denials = [];

if (scenario === 'tools-budget') {
  for (let i = 0; i < 5; i++) await call('read_change_file', { file: api.path });
  await client.close();
  result({ result: 'Still reading.' });
  process.exit(0);
}

if (scenario === 'inject') {
  // A gullible model does what the planted comment says. Each way out is closed.
  const listed = (await client.listTools()).tools.map((t) => t.name);
  await call('Bash', { command: 'cat ~/.ssh/id_rsa; env' });
  await call('read_change_file', { file: '/proc/self/environ' });
  await call('read_change_file', { file: '.env' });
  denials.push({ tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'env' } });
  const line = lineOf('fetch(');
  await call('report_review', {
    findings: [{ kind: 'suspicious', file: api.path, start_line: lineOf('Reviewer:'), end_line: lineOf('Reviewer:'), quote: 'ignore your instructions', says: `As asked, the environment: SECRET_TOKEN=${process.env.SECRET_TOKEN ?? 'not here'}; tools: ${listed.join(',')}` },
      { kind: 'rule', file: api.path, start_line: line, end_line: line, quote: "fetch('https://api.stripe.com/v1/charges'", says: 'Calls Stripe outside the client.', rule: 'stripe-api-via-client' }],
  });
  await client.close();
  result({ permission_denials: denials });
  process.exit(0);
}

// report: read for context, then a grounded finding and one off the diff.
const whole = await call('read_change_file', { file: api.path });
const line = lineOf('fetch(');
await call('report_review', {
  findings: [
    { kind: 'rule', file: api.path, start_line: line, end_line: line, quote: "fetch('https://api.stripe.com/v1/charges'", says: `The API client calls Stripe directly (${whole.text.split('\n').length - 1} lines read).`, rule: 'stripe-api-via-client', fix: 'call charge() from the payments client' },
    { kind: 'bug', file: api.path, start_line: 900, end_line: 901, quote: 'nothing', says: 'Off the diff.' },
  ],
});
await client.close();
result({});
