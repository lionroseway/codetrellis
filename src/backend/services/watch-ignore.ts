/**
 * What a file watcher never descends into — one rule for every watcher that
 * covers a whole checkout (the opened project's, and each line of work's).
 *
 * chokidar 5 has no FSEvents on macOS, so every watched file holds a file
 * descriptor. A checkout's dependencies and build output can be tens of
 * thousands of files: the 0.1.18 demo watched a React Native checkout as a
 * line of work, held 20,000 descriptors on `mobile/ios/Pods` (whose
 * symlinks lead into `node_modules`), and from then on git could not start,
 * so every line of work, overlap and rule came back empty without an error.
 * The two watchers kept separate lists, and the line-of-work one had neither
 * `ios/Pods` nor `followSymlinks: false`.
 *
 * Mirrors project-scanner's ALWAYS_IGNORED for the directory names.
 */

import path from 'node:path';

/** Directory names that are dependencies, build output or tool caches. */
export const HEAVY_DIRS: ReadonlySet<string> = new Set([
  'node_modules', 'dist', 'out', 'build',
  '__pycache__', 'venv', 'env',
  'target',
  'vendor',
  // Go's convention for fixture input that is deliberately not valid
  // source — mirrors project-scanner's ALWAYS_IGNORED.
  'testdata',
  'coverage', 'test-results', 'playwright-report', 'cypress',
  // Xcode and CocoaPods / Carthage: generated, and in a React Native or
  // Expo checkout the biggest tree there is.
  'Pods', 'Carthage', 'DerivedData',
]);

/**
 * True for a path a checkout watcher skips: any dot segment (`.git`,
 * `.codetrellis`, `.venv`, `.gradle`, `.next`), any heavy directory, and
 * log files. Given an absolute path, only the part under `root` is tested,
 * so a checkout that itself lives under a dot folder is still watched.
 */
export function isIgnoredByWatchers(p: string, root?: string): boolean {
  const rel = root ? path.relative(root, p) : p;
  if (rel === '') return false;
  // Any segment starting with '.' (dotdir / dotfile).
  if (/(^|[\\/])\.[^\\/]/.test(rel)) return true;
  for (const seg of rel.split(/[\\/]/)) {
    if (HEAVY_DIRS.has(seg)) return true;
  }
  return rel.endsWith('.log');
}

/**
 * The chokidar options every checkout watcher shares. Links are not
 * followed: they lead into shared trees (Homebrew prefixes, `node_modules`
 * through `Pods/Headers`) and the ignore rule tests the link's path, not
 * where it leads.
 */
export function checkoutWatchOptions(root: string): { ignored: (p: string) => boolean; followSymlinks: false } {
  return { ignored: (p: string) => isIgnoredByWatchers(p, root), followSymlinks: false };
}
