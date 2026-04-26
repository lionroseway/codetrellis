import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';
import { parseFile, initParser } from './ast-parser';
import { storeParsedFile, getFileHash } from './database';
import { broadcast } from '../server';
import { checkFileDeviation } from './deviation-service';

let watcher: FSWatcher | null = null;

// Match the languages the AST parser actually supports — earlier this was
// limited to the TS/JS family, which meant agent edits to .py / .rs / .php
// / .java files never triggered a re-parse and the dependency graph went
// stale. Keep this list in sync with ast-parser.ts grammar registrations.
const PARSEABLE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.php', '.java',
]);

/**
 * Start watching a project directory for file changes.
 * On change, re-parses the file and updates the database.
 */
export async function startWatching(projectRoot: string): Promise<void> {
  await initParser();

  // Stop any existing watcher
  if (watcher) {
    await watcher.close();
  }

  watcher = watch(projectRoot, {
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.vite/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
    ],
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on('change', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!PARSEABLE_EXTS.has(ext)) return;

    const parsed = parseFile(filePath);
    if (!parsed) return;

    // Check if content actually changed
    const oldHash = getFileHash(filePath);
    if (oldHash === parsed.contentHash) return;

    storeParsedFile(parsed, projectRoot);
    console.log(`[Watcher] Re-parsed: ${path.relative(projectRoot, filePath)}`);

    const relativePath = path.relative(projectRoot, filePath);
    broadcast('file-changed', {
      path: filePath,
      relativePath,
      symbols: parsed.symbols.map((s) => ({ name: s.name, kind: s.kind })),
    });

    // Check for plan deviations
    try { checkFileDeviation(relativePath); } catch { /* ignore */ }
  });

  watcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!PARSEABLE_EXTS.has(ext)) return;

    const parsed = parseFile(filePath);
    if (!parsed) return;

    storeParsedFile(parsed, projectRoot);
    console.log(`[Watcher] New file parsed: ${path.relative(projectRoot, filePath)}`);

    broadcast('file-added', {
      path: filePath,
      relativePath: path.relative(projectRoot, filePath),
    });

    // Newly added files create new edges — flag for plan deviation too.
    try { checkFileDeviation(path.relative(projectRoot, filePath)); } catch { /* ignore */ }
  });

  watcher.on('unlink', (filePath) => {
    console.log(`[Watcher] File removed: ${path.relative(projectRoot, filePath)}`);
    broadcast('file-removed', { path: filePath });
  });

  console.log(`[Watcher] Watching ${projectRoot}`);
}

export async function stopWatching(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}
