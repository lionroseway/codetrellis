/**
 * Claude Code's PreToolUse hook, run the way Claude Code runs it: the
 * connector in `--hook pre-tool-use` mode, the edit on stdin, its decision
 * on stdout. As in `tests/e2e/code-breakpoints.test.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DemoOptions } from '../options';

export interface HookAnswer {
  permissionDecision?: string;
  permissionDecisionReason?: string;
  additionalContext?: string;
}

export function runHook(opts: DemoOptions, cwd: string, file: string): Promise<HookAnswer | null> {
  const tsx = path.join(opts.repo, 'node_modules/tsx/dist/loader.mjs');
  const args = opts.connector
    ? [path.resolve(opts.connector), '--data-dir', opts.dataDir, '--hook', 'pre-tool-use']
    : ['--import', fs.existsSync(tsx) ? tsx : 'tsx', path.join(opts.repo, 'src/backend/mcp/connector/main.ts'), '--data-dir', opts.dataDir, '--hook', 'pre-tool-use'];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: opts.repo, stdio: ['pipe', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', reject);
    child.on('close', () => {
      if (!stdout.trim()) return resolve(null);
      try { resolve((JSON.parse(stdout) as { hookSpecificOutput: HookAnswer }).hookSpecificOutput); } catch { resolve(null); }
    });
    child.stdin.end(JSON.stringify({
      session_id: 'demo-claude', cwd, hook_event_name: 'PreToolUse', tool_name: 'Edit',
      tool_input: { file_path: path.join(cwd, file), old_string: 'x', new_string: 'y' },
    }));
  });
}
