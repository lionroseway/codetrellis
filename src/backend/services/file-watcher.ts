// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy___cross_system_service from './cross-system-service';
import * as _lazy___plan_progress_service from './plan-progress-service';
import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';
import { parseFile, initParser } from './ast-parser';
import { storeParsedFile, getFileHash } from './database';
import { broadcast } from '../server';
import { checkFileDeviation } from './deviation-service';
import { checkDocFreshnessForFile } from './sensor-bridge-service';
import { recordFileActivity } from './stuck-sensor-service';

let watcher: FSWatcher | null = null;

/**
 * Cross-system recompute is intentionally **debounced**: agents
 * often touch a burst of files in quick succession (rename refactor,
 * add-then-edit, batched code mods). Recomputing once per file would
 * thrash the matcher and re-broadcast `cross-system-changed` six
 * times for one logical edit. Once-per-burst is what the user
 * actually wants.
 *
 * 500 ms is generous on chokidar's already-debounced 300 ms
 * `awaitWriteFinish` — gives the second / third file in the same
 * burst a chance to roll into the same recompute.
 */
let crossSystemRecomputeTimer: NodeJS.Timeout | null = null;
const CROSS_SYSTEM_DEBOUNCE_MS = 500;

function scheduleCrossSystemRecompute(): void {
  if (crossSystemRecomputeTimer) clearTimeout(crossSystemRecomputeTimer);
  crossSystemRecomputeTimer = setTimeout(() => {
    crossSystemRecomputeTimer = null;
    try {
      // Lazy-require to avoid an import cycle. cross-system-service
      // → database → server → file-watcher → cross-system-service
      // would otherwise be a load-time loop.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { recomputeCrossSystemEdges } = _lazy___cross_system_service;
      recomputeCrossSystemEdges();
      try {
        broadcast('cross-system-changed', { reason: 'file-change' });
      } catch { /* server module may not be loaded in tests */ }
    } catch (err) {
      console.warn('[Watcher] Cross-system recompute failed:', err);
    }
  }, CROSS_SYSTEM_DEBOUNCE_MS);
}

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

  // Function-based ignore — globs in chokidar aren't reliable for
  // dotdir / node_modules in nested layouts. A function tested against
  // every path is foolproof. Mirrors project-scanner's ALWAYS_IGNORED.
  const HEAVY_DIRS = new Set([
    'node_modules', 'dist', 'out', 'build',
    '__pycache__', 'venv', 'env',
    'target',
    'vendor',
    'coverage', 'test-results', 'playwright-report', 'cypress',
  ]);
  const isIgnoredPath = (p: string): boolean => {
    // Any segment starting with '.' (dotdir / dotfile) is skipped.
    if (/[\\/]\.[^\\/]/.test(p)) return true;
    // Any segment matching a heavy non-source directory.
    const segs = p.split(/[\\/]/);
    for (const seg of segs) {
      if (HEAVY_DIRS.has(seg)) return true;
    }
    // Tail-only filters
    if (p.endsWith('.log')) return true;
    return false;
  };

  watcher = watch(projectRoot, {
    ignored: isIgnoredPath,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
    // Don't traverse symlinks — they often point into massive shared
    // dirs (homebrew prefixes, system Python) and explode the watch.
    followSymlinks: false,
  });

  watcher.on('error', (err) => {
    // chokidar surfaces EMFILE / EACCES etc. via this event. Logging
    // beats crashing the whole backend — the watcher just stops
    // updating for that subtree, the scan-time data is still valid.
    console.warn('[Watcher] error (continuing):', err);
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

    // Check for plan deviations + auto-advance task progress
    try { checkFileDeviation(relativePath); } catch { /* ignore */ }
    try {
      // Lazy-require to avoid an import cycle (plan-progress-service →
      // plan-service → database → broadcast → server → file-watcher).
      const { recordFileChange } = _lazy___plan_progress_service;
      recordFileChange(relativePath);
    } catch { /* ignore */ }
    // Phase 4.3 — check if this file is referenced by any system doc.
    try { checkDocFreshnessForFile(relativePath, projectRoot); } catch { /* ignore */ }
    // Phase 4.4 — reset idle-stall clock for stuck sensor.
    try { recordFileActivity(projectRoot); } catch { /* ignore */ }

    // Recompute cross-system edges so HTTP / SQL / etc. couplings
    // stay current with the latest callsite + route declarations.
    // Debounced; see `scheduleCrossSystemRecompute`.
    scheduleCrossSystemRecompute();
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
    const relPath = path.relative(projectRoot, filePath);
    try { checkFileDeviation(relPath); } catch { /* ignore */ }
    try {
      const { recordFileChange } = _lazy___plan_progress_service;
      recordFileChange(relPath);
    } catch { /* ignore */ }
    // Phase 4.3 — doc freshness check for new files too.
    try { checkDocFreshnessForFile(relPath, projectRoot); } catch { /* ignore */ }
    // Phase 4.4 — reset idle-stall clock.
    try { recordFileActivity(projectRoot); } catch { /* ignore */ }

    // A new route / fetch / SQL ref might pair with something that
    // already exists. Debounced recompute — see `change` handler.
    scheduleCrossSystemRecompute();
  });

  watcher.on('unlink', (filePath) => {
    console.log(`[Watcher] File removed: ${path.relative(projectRoot, filePath)}`);
    broadcast('file-removed', { path: filePath });

    // Removing a file can drop one side of a cross-system edge.
    // Debounced — let any in-flight rename (`unlink` followed by
    // `add` in the same tick) settle before recomputing.
    scheduleCrossSystemRecompute();
  });

  console.log(`[Watcher] Watching ${projectRoot}`);
}

export async function stopWatching(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}
