/**
 * Phase 33 C4 — adapters for the agent CLIs `codetrellis review` runs
 * (AGENT-CHECKS-AND-REVIEW §1.4).
 *
 * Each starts the person's own CLI headless, on their own model and key, and
 * holds it to a deny-by-default tool set through that CLI's own settings:
 * no built-in tools at all (no shell, no reading or writing files, no web),
 * one MCP server (the review sink) and its two tools pre-approved, anything
 * else denied without asking. It runs in an empty folder, so the repository's
 * own agent settings, hooks and instructions are never in reach.
 *
 * A CLI that cannot be held to that is not offered. Each adapter was checked
 * against its CLI's own documentation; the citations are beside it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SINK_TOOLS } from './review-sink';

export interface AdapterCommand { args: string[]; stdin?: string; /** Set for this run only, over the scrubbed environment. */ env?: Record<string, string> }

/** What one run said, from the CLI's own output. */
export interface AdapterRun {
  /** Its last words, when it ended without reporting. */
  finalText: string | null;
  /** Tool calls the CLI itself denied. */
  refused: string[];
  /** It stopped at its turn limit. */
  hitTurns: boolean;
  /** It could not run: the model unreachable, the key refused. */
  error: string | null;
  turns: number | null;
  tokens: number | null;
}

export interface AgentAdapter {
  id: string;
  label: string;
  /** The executable, and the variable that names another (tests, a pinned install). */
  bin: string;
  binEnv: string;
  /** It runs only on a key named by `--auth`, never the person's stored login. */
  needsAuth?: boolean;
  /** Variables the CLI reads for its own provider set-up, passed through when set. */
  passEnv: readonly string[];
  /** The credential and endpoint, as this CLI reads them. */
  env(o: { authVar: string | null; authValue: string | null; endpoint: string | null; model: string | null }): Record<string, string>;
  command(o: { instructions: string; message: string; sink: { command: string; args: string[] }; model: string | null; endpoint: string | null; maxTurns: number; dir: string; work: string; withKey: boolean }): AdapterCommand;
  parse(stdout: string, stderr: string, code: number | null): AdapterRun;
}

const SINK = 'codetrellis_review';

/**
 * Claude Code's print mode (code.claude.com/docs: CLI reference, headless,
 * settings; checked against `claude --help` 2.1.291):
 *
 *  - `--tools ""` removes every built-in tool: Bash, Read, Edit, Write,
 *    WebFetch, WebSearch, Glob, Grep, Task.
 *  - `--strict-mcp-config --mcp-config <file>`: the sink and no other server,
 *    whatever the user's or a project's config holds.
 *  - `--allowedTools mcp__codetrellis_review__…` pre-approves the sink's two
 *    tools; `--permission-mode dontAsk` denies anything else that would
 *    prompt, and the denials are in the result's `permission_denials`.
 *  - `--max-turns`: the turn budget; the result's subtype is
 *    `error_max_turns` when it is reached.
 *  - `--bare` with a key (`--auth`): no hooks, plugins, CLAUDE.md or
 *    keychain; auth is strictly ANTHROPIC_API_KEY. Without `--auth` the
 *    person's own login is used, which `--bare` would not read.
 */
const claudeCode: AgentAdapter = {
  id: 'claude-code',
  label: 'Claude Code',
  bin: 'claude',
  binEnv: 'CODETRELLIS_REVIEW_CLAUDE',
  passEnv: ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'AWS_REGION', 'AWS_PROFILE', 'ANTHROPIC_VERTEX_PROJECT_ID', 'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS'],
  env({ authValue, endpoint }) {
    return {
      ...(authValue ? { ANTHROPIC_API_KEY: authValue } : {}),
      ...(endpoint ? { ANTHROPIC_BASE_URL: endpoint } : {}),
      // No telemetry, error reports or update checks from a review.
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
  },
  command({ instructions, message, sink, model, maxTurns, dir, withKey }) {
    const mcp = path.join(dir, 'mcp.json');
    fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { [SINK]: { type: 'stdio', command: sink.command, args: sink.args } } }));
    const system = path.join(dir, 'system.md');
    fs.writeFileSync(system, instructions);
    return {
      args: [
        '-p',
        ...(withKey ? ['--bare'] : []),
        '--output-format', 'json',
        '--tools', '',
        '--strict-mcp-config', '--mcp-config', mcp,
        '--allowedTools', SINK_TOOLS.map((t) => `mcp__${SINK}__${t}`).join(','),
        '--permission-mode', 'dontAsk',
        '--max-turns', String(maxTurns),
        '--system-prompt-file', system,
        ...(model ? ['--model', model] : []),
      ],
      // The message on stdin: the bundle can be larger than an argument may be.
      stdin: message,
    };
  },
  parse(stdout, stderr, code) {
    let r: Record<string, unknown> | null = null;
    // `json` prints one result object; take the last line that parses, in case a CLI prints more.
    for (const line of stdout.trim().split('\n').reverse()) {
      try { const j = JSON.parse(line) as Record<string, unknown>; if (j && typeof j === 'object') { r = j; break; } } catch { /* not this line */ }
    }
    if (!r) {
      try { r = JSON.parse(stdout) as Record<string, unknown>; } catch { /* none */ }
    }
    if (!r) return { finalText: null, refused: [], hitTurns: false, error: code === 0 ? null : (stderr.trim() || `it exited ${code}`).slice(-400), turns: null, tokens: null };
    const denials = Array.isArray(r.permission_denials) ? r.permission_denials as Array<Record<string, unknown>> : [];
    const usage = (r.usage ?? {}) as Record<string, number>;
    const subtype = typeof r.subtype === 'string' ? r.subtype : '';
    const hitTurns = subtype === 'error_max_turns';
    const failed = r.is_error === true && !hitTurns;
    return {
      finalText: typeof r.result === 'string' ? r.result : null,
      refused: denials.map((d) => `${String(d.tool_name ?? 'a tool')}: denied by the CLI (not on the review's allowlist)`),
      hitTurns,
      error: failed ? String(r.result ?? r.error ?? subtype ?? 'the agent failed').slice(0, 400) : null,
      turns: typeof r.num_turns === 'number' ? r.num_turns : null,
      tokens: typeof usage.input_tokens === 'number' ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) : null,
    };
  },
};

const toml = (v: string) => JSON.stringify(v);

/**
 * Codex's non-interactive mode, `codex exec` (Apache-2.0; checked against
 * its source and config schema, codex-rs at 0b863c6, 2026-10-06, as its docs
 * site was out of reach):
 *
 *  - `-c features.shell_tool=false` removes the shell (`exec_command` and
 *    the one-shot shell), not just sandboxes it; `web_search="disabled"`
 *    (the default is `cached`), `features.view_image=false` and
 *    `features.multi_agent=false` remove the rest that reaches out.
 *  - `--sandbox read-only`: no write reaches the disk. Its patch tool is
 *    still offered for known OpenAI models, and refused here by the sandbox,
 *    since exec never asks for approval.
 *  - The sink by `-c mcp_servers.…`, its two tools only (`enabled_tools`),
 *    approved (`default_tools_approval_mode`).
 *  - A fresh `CODEX_HOME` per pass: none of the person's config, servers,
 *    hooks, rules or AGENTS.md; `project_doc_max_bytes=0` reads none from
 *    the folder either.
 *  - The model through a provider of our own (`model_providers.…`), so the
 *    key named by `--auth` is the only credential and any endpoint serving
 *    the Responses API works: this is the runner for a bare endpoint (§1.4).
 *    It has no turn limit: `--timeout` and `--max-tool-calls` hold it.
 */
const codex: AgentAdapter = {
  id: 'codex',
  label: 'Codex',
  bin: 'codex',
  binEnv: 'CODETRELLIS_REVIEW_CODEX',
  passEnv: [],
  needsAuth: true,
  env({ authValue }) {
    const out: Record<string, string> = {};
    if (authValue) out.CODETRELLIS_REVIEW_KEY = authValue;
    return out;
  },
  command({ instructions, message, sink, model, endpoint, dir }) {
    const home = path.join(dir, 'codex-home');
    fs.mkdirSync(home, { recursive: true });
    const server = `mcp_servers.${SINK}`;
    const set = (k: string, v: string) => ['-c', `${k}=${v}`];
    return {
      args: [
        'exec', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only',
        ...set('features.shell_tool', 'false'),
        ...set('web_search', toml('disabled')),
        ...set('features.view_image', 'false'),
        ...set('features.multi_agent', 'false'),
        ...set('project_doc_max_bytes', '0'),
        ...set(`${server}.command`, toml(sink.command)),
        ...set(`${server}.args`, `[${sink.args.map(toml).join(', ')}]`),
        ...set(`${server}.enabled_tools`, `[${SINK_TOOLS.map(toml).join(', ')}]`),
        ...set(`${server}.default_tools_approval_mode`, toml('approve')),
        ...set('model_providers.codetrellis_review.name', toml('codetrellis review')),
        ...set('model_providers.codetrellis_review.base_url', toml(endpoint ?? 'https://api.openai.com/v1')),
        ...set('model_providers.codetrellis_review.env_key', toml('CODETRELLIS_REVIEW_KEY')),
        ...set('model_provider', toml('codetrellis_review')),
        ...set('developer_instructions', toml(instructions)),
        ...(model ? ['-m', model] : []),
        '-',
      ],
      stdin: message,
      env: { CODEX_HOME: home },
    };
  },
  parse(stdout, stderr, code) {
    let finalText: string | null = null;
    let error: string | null = null;
    let tokens: number | null = null;
    let turns = 0;
    const refused: string[] = [];
    for (const line of stdout.split('\n')) {
      let e: Record<string, any>;
      try { e = JSON.parse(line) as Record<string, any>; } catch { continue; }
      if (e.type === 'turn.completed') { turns += 1; const u = e.usage ?? {}; tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0); }
      else if (e.type === 'turn.failed') error = String(e.error?.message ?? 'the turn failed');
      else if (e.type === 'error') error = String(e.message ?? 'an error');
      else if (e.type === 'item.completed' && e.item) {
        const it = e.item as Record<string, any>;
        if (it.type === 'agent_message' && typeof it.text === 'string') finalText = it.text;
        else if (it.type === 'mcp_tool_call' && it.status === 'failed') refused.push(`${it.server}.${it.tool}: ${String(it.error?.message ?? 'failed')}`);
        else if (it.type === 'command_execution') refused.push(`a shell command: ${String(it.command ?? '').slice(0, 200)}`);
        else if (it.type === 'file_change') refused.push('a file change: refused by the read-only sandbox');
        else if (it.type === 'web_search') refused.push('a web search');
      }
    }
    if (!error && code !== 0 && turns === 0) error = (stderr.trim() || `it exited ${code}`).slice(-400);
    return { finalText, refused, hitTurns: false, error, turns: turns || null, tokens };
  },
};

export const ADAPTERS: readonly AgentAdapter[] = [claudeCode, codex];

export function adapterFor(id: string): AgentAdapter | null {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}
