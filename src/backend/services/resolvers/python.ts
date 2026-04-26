import path from 'node:path';
import type { ResolverPlugin, ResolveContext } from './base';
import { findContainingSystem, tryExtensions } from './base';

/**
 * Python resolver.
 *
 * Handles four import shapes, in order:
 *   - `from . import x`            → relative to importer's directory
 *   - `from .x.y import z`         → relative `./x/y.py` or `./x/y/__init__.py`
 *   - `from x.y import z`          → absolute, anchored at the importer's
 *                                    nearest-ancestor system root (the Python
 *                                    project root)
 *   - `import x`, `import x.y`     → same absolute resolution
 *
 * The importing file's containing system tells us where `from x ...`
 * starts. For `backend/fastapi/app/routes/users.py` doing
 * `from app.models import User`, the containing system root is
 * `backend/fastapi/`, so we look for `backend/fastapi/app/models.py`
 * or `backend/fastapi/app/models/__init__.py`.
 */

const PY_EXTS = ['.py'] as const;
const PY_INDEX_SUFFIXES = ['/__init__.py'] as const;

function resolve(ctx: ResolveContext): string | null {
  const { importSource, importerPath, projectRoot, knownFiles, systems } = ctx;
  if (!importSource) return null;

  // Strip stdlib + obviously-external imports up front. This avoids
  // pretending to resolve `os`, `json`, `fastapi`, etc.
  if (isLikelyExternal(importSource)) return null;

  // 1. Relative — leading dots
  if (importSource.startsWith('.')) {
    const dots = importSource.match(/^\.+/)![0].length;
    const tail = importSource.slice(dots).replace(/^\./, '').replace(/\./g, '/');
    let baseDir = path.dirname(importerPath);
    // Each extra dot moves up one directory. `from . import x` → 1 dot, stay in dir.
    for (let i = 1; i < dots; i += 1) baseDir = path.dirname(baseDir);
    const base = tail ? path.join(baseDir, tail) : baseDir;
    return tryPython(base, knownFiles);
  }

  // 2. Absolute project import — anchor at the containing system, fall
  //    back to the overall project root if no system matches.
  const containing = findContainingSystem(importerPath, systems);
  const roots: string[] = [];
  if (containing) roots.push(containing.rootPath);
  if (containing?.rootPath !== projectRoot) roots.push(projectRoot);

  // Many Python projects keep code under `src/`. Try those too.
  const moduleSubpath = importSource.replace(/\./g, '/');
  for (const root of roots) {
    const candidatesBases = [
      path.join(root, moduleSubpath),
      path.join(root, 'src', moduleSubpath),
      path.join(root, 'app', moduleSubpath),
    ];
    for (const base of candidatesBases) {
      const hit = tryPython(base, knownFiles);
      if (hit) return hit;
    }
  }

  return null;
}

function tryPython(basePath: string, knownFiles: Set<string>): string | null {
  // First try exact `<base>.py`, then `<base>/__init__.py`. Re-use the
  // shared helper but with Python-specific extensions.
  return tryExtensions(basePath, knownFiles, [...PY_EXTS, ...PY_INDEX_SUFFIXES]);
}

/**
 * Quick filter for stdlib / 3rd-party imports we can't resolve. We
 * keep the list small — anything not on it gets a real attempt.
 */
const STDLIB_AND_COMMON_THIRD_PARTY = new Set([
  // stdlib
  'os', 'sys', 'io', 're', 'json', 'time', 'typing', 'pathlib',
  'collections', 'functools', 'itertools', 'datetime', 'subprocess',
  'asyncio', 'threading', 'logging', 'math', 'random', 'enum',
  'dataclasses', 'abc', 'inspect', 'copy', 'string', 'unittest',
  'shutil', 'tempfile', 'glob', 'argparse', 'contextlib', 'warnings',
  'urllib', 'http', 'socket', 'hashlib', 'base64', 'pickle', 'csv',
  'xml', 'html', 'sqlite3', 'concurrent', 'multiprocessing', 'queue',
  // common third-party we won't try to ingest from node_modules-equivalents
  'fastapi', 'pydantic', 'sqlalchemy', 'alembic', 'starlette', 'uvicorn',
  'celery', 'redis', 'requests', 'httpx', 'numpy', 'pandas', 'scipy',
  'sklearn', 'torch', 'tensorflow', 'matplotlib', 'pytest', 'click',
  'flask', 'django', 'jinja2', 'boto3', 'stripe', 'sentry_sdk',
]);

function isLikelyExternal(importSource: string): boolean {
  const top = importSource.replace(/^\.+/, '').split('.')[0];
  return STDLIB_AND_COMMON_THIRD_PARTY.has(top);
}

export const pythonResolver: ResolverPlugin = {
  languages: ['python'],
  resolve,
};
