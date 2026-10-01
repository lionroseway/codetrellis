#!/usr/bin/env node
/**
 * `codetrellis` — the CLI's launcher (Phase 32 D1.1). The CLI is TypeScript
 * beside the backend it boots, so this runs it under tsx in one Node process
 * of its own: stdin, stdout and signals pass straight through, which the
 * `mcp` command needs for the protocol. See src/cli/main.ts.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const loader = pathToFileURL(path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'loader.mjs')).href;

const child = spawn(process.execPath, ['--import', loader, path.join(root, 'src', 'cli', 'main.ts'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
