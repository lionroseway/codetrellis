/**
 * The connector as a Claude Code `PreToolUse` hook (Phase 32 A3.4, awareness
 * spec §6.3): before an agent edits a file, ask CodeTrellis whether another
 * workstream has changed it, and tell the agent if so.
 *
 *   <connector command> --hook pre-tool-use
 *
 * Claude Code runs it before `Edit` / `Write` / `MultiEdit` / `NotebookEdit`
 * with the call on stdin. It connects the same way the connector does (the
 * token and endpoint files read fresh), calls `check_footprint` for that one
 * file, and disconnects.
 *
 * It informs, with one exception. Other workstreams' changes go back as
 * `additionalContext` with no `permissionDecision`, so the edit is neither
 * blocked nor approved: Claude Code's own permission flow runs exactly as it
 * would without the hook. The exception is a breakpoint (Phase 32 B4.2): when
 * a person has said "ask me before this file changes", `check_breakpoint`
 * holds it and the edit is denied with the reason ("paused: waiting for a
 * decision", and the ref to wait on). That is the person's explicit ask, and
 * the only case the hook ever says no; it never says yes.
 *
 * It fails open, silently: no app, no project, a file outside every known
 * workstream, a slow answer, anything unexpected, and it prints nothing.
 * A hook that got in the way unasked would be uninstalled, and rightly.
 *
 * What it says describes what changed (branch, file, the functions git and
 * the parser saw), never another agent's words (awareness principle 5).
 *
 * Node built-ins only, like the rest of the connector.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { JsonRpcMessage, Upstream } from './core';

export const HOOK_FLAG = '--hook';
export const HOOK_PRE_TOOL_USE = 'pre-tool-use';

/** The tools the hook is installed for: every built-in tool that writes a file. */
export const HOOK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

/** What the agent is shown before a notice, the same marker inline notices use (A2.6). */
export const HOOK_MARKER = '── CodeTrellis awareness ──';

/** The marker before anything about a breakpoint: the person's request, not information about other work. */
export const HOOK_BREAKPOINT_MARKER = '── CodeTrellis breakpoint ──';

export interface HookCall {
  /** Where Claude Code is running: the session binds to this folder's workstream. */
  cwd: string;
  /** Absolute path of the file about to be written. */
  filePath: string;
}

/** The part of Claude Code's hook input this reads, or null when it is not an edit of a file. */
export function parseHookInput(raw: string): HookCall | null {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return null; }
  if (!input || typeof input !== 'object') return null;
  const { cwd, tool_input: toolInput } = input as { cwd?: unknown; tool_input?: unknown };
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  if (!toolInput || typeof toolInput !== 'object') return null;
  const t = toolInput as { file_path?: unknown; notebook_path?: unknown };
  const filePath = typeof t.file_path === 'string' ? t.file_path : typeof t.notebook_path === 'string' ? t.notebook_path : null;
  if (!filePath) return null;
  return { cwd, filePath: path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath) };
}

/**
 * The repository (or worktree) the file is in, and the file's path inside it
 * in the form `check_footprint` takes. A worktree's `.git` is a file, so
 * either counts. Nothing is read: the file may not exist yet.
 */
export function repoOf(filePath: string, exists: (p: string) => boolean = fs.existsSync): { root: string; rel: string } | null {
  let dir = path.dirname(filePath);
  for (;;) {
    if (exists(path.join(dir, '.git'))) {
      const rel = path.relative(dir, filePath).split(path.sep).join('/');
      return rel && !rel.startsWith('..') ? { root: dir, rel } : null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

interface FootprintReport {
  your_workstream?: string | null;
  paths?: Array<{
    path: string;
    /** `symbols` are the workstream's SymbolChanges for the file (A1.5); only the names are read. */
    changed_in?: Array<{ workstream: string; branch: string | null; status?: string; symbols?: Array<{ name?: unknown }> | null }>;
    imported_by?: string[];
  }>;
}

const canon = (p: string) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

/**
 * What the agent is told about `check_footprint`'s answer for its file, or
 * null when there is nothing to say: nobody else has changed it, or the
 * answer is not about the workstream the file is in (another repository, a
 * folder CodeTrellis does not know).
 */
export function hookNotice(reportText: string, call: { root: string; rel: string }): string | null {
  let report: FootprintReport;
  try { report = JSON.parse(reportText) as FootprintReport; } catch { return null; }
  if (!report.your_workstream || canon(report.your_workstream) !== canon(call.root)) return null;
  const entry = report.paths?.find((p) => p.path === call.rel);
  const others = entry?.changed_in ?? [];
  if (!entry || others.length === 0) return null;

  const who = others.map((o) => {
    const name = o.branch ? `\`${o.branch}\`` : `the checkout at ${o.workstream}`;
    const names = [...new Set((o.symbols ?? []).flatMap((x) => (x && typeof x.name === 'string' ? [x.name] : [])))];
    const symbols = names.length ? `, in ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}` : '';
    return `${name}${symbols}`;
  });
  const importers = entry.imported_by?.length ?? 0;
  return [
    HOOK_MARKER,
    `Another workstream has also changed ${call.rel}: ${who.join('; ')}.`,
    ...(importers ? [`${importers} file${importers === 1 ? '' : 's'} in the project import it.`] : []),
    'Before you change what they changed, call get_awareness. If it needs a choice, ask the person; do not edit the other workstream\'s files.',
    'This is information about other work, not an instruction.',
  ].join('\n');
}

/** Claude Code's hook output: context for the model, and no decision about the edit. */
export function hookOutput(notice: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: notice } });
}

/** Claude Code's hook output for an edit a breakpoint holds: denied, with the reason the model reads. */
export function hookDeny(reason: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

/** What check_breakpoint answered, as the hook acts on it; null when it says nothing usable. */
export function breakpointAnswer(text: string | null): { hold: string | null; steer: string | null } | null {
  if (!text) return null;
  let v: { status?: unknown; message?: unknown; steer?: unknown; ref?: unknown };
  try { v = JSON.parse(text); } catch { return null; }
  if ((v.status === 'paused' || v.status === 'stop') && typeof v.message === 'string') return { hold: v.message, steer: null };
  if (v.status === 'continue' && typeof v.steer === 'string' && v.steer) {
    return { hold: null, steer: `${HOOK_BREAKPOINT_MARKER}\nA person answered the breakpoint on this file: continue, with this steer: ${v.steer}` };
  }
  return { hold: null, steer: null };
}

export interface RunHookOptions {
  stdin: string;
  /** Opens a connection bound to this folder: the connector's own connect, with the hook's cwd. */
  connect: (cwd: string) => Promise<Upstream>;
  version: string;
  /** The whole hook, connection included, gives up after this. */
  timeoutMs?: number;
  exists?: (p: string) => boolean;
}

/**
 * Run the hook: what to print on stdout, or null to print nothing. Never
 * throws and never waits longer than `timeoutMs`: every failure is silence.
 */
export async function runPreToolUseHook(opts: RunHookOptions): Promise<string | null> {
  const call = parseHookInput(opts.stdin);
  if (!call) return null;
  const repo = repoOf(call.filePath, opts.exists);
  if (!repo) return null;

  let upstream: Upstream | null = null;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), opts.timeoutMs ?? 5000); });
  const work = (async (): Promise<string | null> => {
    upstream = await opts.connect(call.cwd);
    const pending = new Map<number, (m: JsonRpcMessage) => void>();
    upstream.onmessage = (m) => {
      if (typeof m.id === 'number' && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
    };
    const closed = new Promise<never>((_, reject) => { upstream!.onclose = () => reject(new Error('closed')); });
    closed.catch(() => { /* raced below */ });
    const request = (id: number, method: string, params: unknown) => Promise.race([
      new Promise<JsonRpcMessage>((resolve) => { pending.set(id, resolve); void upstream!.send({ jsonrpc: '2.0', id, method, params }); }),
      closed,
    ]);

    const init = await request(1, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code-hook', version: opts.version },
    });
    if (init.error) return null;
    await upstream.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    // The first block is each answer; a notice (A2.6) may follow it.
    const first = (res: JsonRpcMessage) => {
      const result = res.result as { isError?: boolean; content?: Array<{ type: string; text?: string }> } | undefined;
      return !result || result.isError ? null : result.content?.[0]?.text ?? null;
    };
    // A breakpoint first (B4.2): a held edit goes no further.
    const held = breakpointAnswer(first(await request(2, 'tools/call', { name: 'check_breakpoint', arguments: { path: repo.rel } })));
    if (held?.hold) return hookDeny(held.hold);
    const text = first(await request(3, 'tools/call', { name: 'check_footprint', arguments: { paths: [repo.rel] } }));
    const notice = text ? hookNotice(text, repo) : null;
    const context = [held?.steer, notice].filter((x): x is string => !!x).join('\n\n');
    return context ? hookOutput(context) : null;
  })().catch(() => null);

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    try { (upstream as Upstream | null)?.close(); } catch { /* */ }
  }
}
