import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  DiscoveredSystem,
  ManifestKind,
  SystemLanguage,
  AliasMapping,
} from '../../shared/types';

/**
 * System discovery — see docs/SYSTEM-MODEL.md
 *
 * Walks a project root and emits a `DiscoveredSystem` for every
 * directory that contains a recognized manifest. The project root
 * itself always becomes a system (informal if it has no manifest).
 *
 * What this is for in Phase 1:
 *  - Build the workspace alias map (`@swf/ui` → `packages/ui`)
 *  - Read every `tsconfig.json` to capture path mappings
 *  - Detect non-npm systems (Python / Rust / PHP / Java / Go / Ruby)
 *    even if they aren't declared in any `workspaces` config
 *
 * Phase 3 will store these in a `systems` table and use them as a
 * first-class entity.
 */

const ALWAYS_IGNORED_DIRS = new Set([
  // Keep in sync with project-scanner.ts ALWAYS_IGNORED. Anything starting
  // with '.' is also skipped.
  'node_modules', 'dist', 'out', 'build',
  '__pycache__', 'venv', 'env',
  'target',
  'vendor',
  'coverage', 'test-results', 'playwright-report', 'cypress',
]);

/** Manifest filenames in priority order (highest priority first). */
const MANIFEST_PRIORITY: ReadonlyArray<{ filename: string; kind: ManifestKind }> = [
  { filename: 'package.json', kind: 'package.json' },
  { filename: 'pyproject.toml', kind: 'pyproject.toml' },
  { filename: 'Cargo.toml', kind: 'Cargo.toml' },
  { filename: 'composer.json', kind: 'composer.json' },
  { filename: 'go.mod', kind: 'go.mod' },
  { filename: 'pom.xml', kind: 'pom.xml' },
  { filename: 'build.gradle.kts', kind: 'build.gradle.kts' },
  { filename: 'build.gradle', kind: 'build.gradle' },
  { filename: 'Gemfile', kind: 'Gemfile' },
  { filename: 'Package.swift', kind: 'Package.swift' },
  // Lower-priority manifests that signal a project but with weaker info
  { filename: 'setup.py', kind: 'setup.py' },
  { filename: 'requirements.txt', kind: 'requirements.txt' },
  // tsconfig.json by itself only counts when there's no package.json
  // sibling — handled specially below.
];

/**
 * Walk the project tree and emit a system per directory that contains a
 * recognized manifest.
 *
 * Always emits a "project root" system as the first entry (informal if
 * no manifest, otherwise tied to the root manifest).
 */
export function discoverSystems(projectRoot: string): DiscoveredSystem[] {
  const absoluteRoot = path.resolve(projectRoot);
  const systems: DiscoveredSystem[] = [];

  walk(absoluteRoot, absoluteRoot, systems, 0, /* maxDepth */ 8);

  // Sort by rootPath length (shortest first → root system is first)
  systems.sort((a, b) => a.rootPath.length - b.rootPath.length);

  // If we never emitted a project-root system (because the root has no
  // manifest), prepend an informal one so every file has an ancestor.
  if (systems.length === 0 || systems[0].rootPath !== absoluteRoot) {
    systems.unshift(makeInformalSystem(absoluteRoot, absoluteRoot));
  }

  return systems;
}

function walk(
  dir: string,
  projectRoot: string,
  out: DiscoveredSystem[],
  depth: number,
  maxDepth: number,
): void {
  if (depth > maxDepth) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Try to detect a primary manifest at this level.
  const filenames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const sys = detectSystemAtDir(dir, projectRoot, filenames);
  if (sys) out.push(sys);

  // Recurse into child directories.
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (ALWAYS_IGNORED_DIRS.has(entry.name)) continue;

    walk(path.join(dir, entry.name), projectRoot, out, depth + 1, maxDepth);
  }
}

function detectSystemAtDir(
  dir: string,
  projectRoot: string,
  filenames: Set<string>,
): DiscoveredSystem | null {
  // Walk priority list and emit for the first matching manifest.
  for (const { filename, kind } of MANIFEST_PRIORITY) {
    if (!filenames.has(filename)) continue;
    return readManifest(dir, projectRoot, filename, kind);
  }

  // Special case: a .NET project file is named after the project
  // (`Acme.Billing.csproj`), so it cannot be matched by filename like
  // every other manifest. It is checked after the priority list so a
  // directory holding both a csproj and, say, a package.json still
  // reports as the npm package it primarily is.
  // Sorted so a directory with more than one project file always picks
  // the same one — readdir order is not guaranteed, and a graph that
  // differs between scans of an unchanged tree is worse than a graph
  // that picks the "wrong" project consistently.
  const csproj = [...filenames]
    .filter((name) => name.toLowerCase().endsWith('.csproj'))
    .sort()[0];
  if (csproj) {
    return readCsproj(dir, projectRoot, path.join(dir, csproj));
  }

  // Special case: tsconfig.json is only a system if there's no
  // package.json sibling. That covers standalone TS areas like e2e/
  // or scripts/ that have a tsconfig but not their own package.
  if (filenames.has('tsconfig.json') && !filenames.has('package.json')) {
    return readTsconfigSystem(dir, projectRoot);
  }

  return null;
}

/**
 * A .NET project. MSBuild's default root namespace is the project
 * file's base name, so that is what `packageName` carries — the C#
 * resolver overrides it with `<RootNamespace>` when the csproj declares
 * one, which it reads itself rather than making every scan parse XML.
 */
function readCsproj(dir: string, projectRoot: string, manifestPath: string): DiscoveredSystem {
  const projectName = path.basename(manifestPath, path.extname(manifestPath));
  return {
    id: stableId(dir),
    name: projectName,
    rootPath: dir,
    relativeRoot: path.relative(projectRoot, dir),
    language: 'csharp',
    manifestKind: 'csproj',
    manifestPath,
    isWorkspaceRoot: false,
    packageName: projectName,
  };
}

function readManifest(
  dir: string,
  projectRoot: string,
  filename: string,
  kind: ManifestKind,
): DiscoveredSystem {
  const manifestPath = path.join(dir, filename);
  const id = stableId(dir);
  const relativeRoot = path.relative(projectRoot, dir);
  const baseName = path.basename(dir) || 'project';

  switch (kind) {
    case 'package.json':
      return readPackageJson(dir, projectRoot, manifestPath, id, relativeRoot, baseName);
    case 'pyproject.toml':
    case 'setup.py':
    case 'requirements.txt':
      return {
        id, name: baseName, rootPath: dir, relativeRoot,
        language: 'python', manifestKind: kind, manifestPath,
        isWorkspaceRoot: false,
      };
    case 'Cargo.toml':
      return readCargoToml(dir, projectRoot, manifestPath, id, relativeRoot, baseName);
    case 'go.mod':
      return readGoMod(dir, projectRoot, manifestPath, id, relativeRoot, baseName);
    case 'composer.json':
      return readComposerJson(dir, projectRoot, manifestPath, id, relativeRoot, baseName);
    case 'pom.xml':
      return {
        id, name: baseName, rootPath: dir, relativeRoot,
        language: 'java', manifestKind: kind, manifestPath,
        isWorkspaceRoot: false,
      };
    case 'build.gradle':
    case 'build.gradle.kts':
      return {
        id, name: baseName, rootPath: dir, relativeRoot,
        language: 'java', manifestKind: kind, manifestPath,
        isWorkspaceRoot: false,
      };
    case 'Gemfile':
      return {
        id, name: baseName, rootPath: dir, relativeRoot,
        language: 'ruby', manifestKind: kind, manifestPath,
        isWorkspaceRoot: false,
      };
    case 'Package.swift':
      return readSwiftPackage(dir, projectRoot, manifestPath, id, relativeRoot, baseName);
    default:
      return {
        id, name: baseName, rootPath: dir, relativeRoot,
        language: 'unknown', manifestKind: kind, manifestPath,
        isWorkspaceRoot: false,
      };
  }
}

function readPackageJson(
  dir: string,
  projectRoot: string,
  manifestPath: string,
  id: string,
  relativeRoot: string,
  baseName: string,
): DiscoveredSystem {
  let pkg: any = {};
  try {
    pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch { /* leave empty */ }

  const packageName: string | undefined = typeof pkg.name === 'string' ? pkg.name : undefined;
  const workspacesRaw = pkg.workspaces;
  const workspaceGlobs: string[] = Array.isArray(workspacesRaw)
    ? workspacesRaw
    : (Array.isArray(workspacesRaw?.packages) ? workspacesRaw.packages : []);
  const isWorkspaceRoot = workspaceGlobs.length > 0;

  // Decide language from common signals:
  //   - presence of typescript dep / `types` field / .ts source / tsconfig.json
  //   - else default to javascript
  const hasTypeScript =
    pkg.devDependencies?.typescript || pkg.dependencies?.typescript ||
    pkg.types || pkg.typings ||
    fs.existsSync(path.join(dir, 'tsconfig.json'));
  const language: SystemLanguage = hasTypeScript ? 'typescript' : 'javascript';

  const entryHints = computePackageEntryHints(dir, pkg);
  const packageMeta = {
    main: typeof pkg.main === 'string' ? pkg.main : undefined,
    source: typeof pkg.source === 'string' ? pkg.source : undefined,
    types: typeof pkg.types === 'string' ? pkg.types : undefined,
    module: typeof pkg.module === 'string' ? pkg.module : undefined,
    exports: pkg.exports,
  };

  return {
    id,
    name: packageName || baseName,
    rootPath: dir,
    relativeRoot,
    language,
    manifestKind: 'package.json',
    manifestPath,
    isWorkspaceRoot,
    workspaceGlobs: isWorkspaceRoot ? workspaceGlobs : undefined,
    packageName,
    entryHints,
    packageMeta,
  };
}

function computePackageEntryHints(dir: string, pkg: any): string[] {
  const hints = new Set<string>();
  // Source-first hints (TS monorepos)
  for (const candidate of [pkg.source, pkg.types, pkg.module, pkg.main]) {
    if (typeof candidate === 'string') hints.add(candidate);
  }
  // Conventional source entry points
  for (const candidate of [
    'src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx',
    'src/main.ts', 'src/main.tsx',
    'index.ts', 'index.tsx', 'index.js', 'index.jsx',
  ]) {
    if (fs.existsSync(path.join(dir, candidate))) hints.add(candidate);
  }
  return [...hints];
}

function readCargoToml(
  dir: string,
  _projectRoot: string,
  manifestPath: string,
  id: string,
  relativeRoot: string,
  baseName: string,
): DiscoveredSystem {
  // Light parsing — we just need the [workspace] flag + crate name
  let raw = '';
  try { raw = fs.readFileSync(manifestPath, 'utf-8'); } catch { /* ignore */ }
  const isWorkspaceRoot = /\[workspace\]/.test(raw);
  const nameMatch = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
  const name = nameMatch ? nameMatch[1] : baseName;

  const workspaceGlobs: string[] = [];
  if (isWorkspaceRoot) {
    const membersBlock = raw.match(/members\s*=\s*\[([\s\S]*?)\]/);
    if (membersBlock) {
      const members = membersBlock[1].match(/"([^"]+)"/g) || [];
      for (const m of members) workspaceGlobs.push(m.replace(/"/g, ''));
    }
  }

  return {
    id, name, rootPath: dir, relativeRoot,
    language: 'rust',
    manifestKind: 'Cargo.toml',
    manifestPath,
    isWorkspaceRoot,
    workspaceGlobs: isWorkspaceRoot ? workspaceGlobs : undefined,
  };
}

function readGoMod(
  dir: string,
  _projectRoot: string,
  manifestPath: string,
  id: string,
  relativeRoot: string,
  baseName: string,
): DiscoveredSystem {
  let raw = '';
  try { raw = fs.readFileSync(manifestPath, 'utf-8'); } catch { /* ignore */ }
  const moduleMatch = raw.match(/^module\s+(\S+)/m);
  const moduleName = moduleMatch ? moduleMatch[1] : baseName;

  return {
    id, name: moduleName, rootPath: dir, relativeRoot,
    language: 'go',
    manifestKind: 'go.mod',
    manifestPath,
    isWorkspaceRoot: false,
    packageName: moduleName,
  };
}

/**
 * A SwiftPM package. The `name:` in the `Package(` initialiser is the
 * package name, which is *not* necessarily the directory name and is
 * what a cross-package `import` is written against.
 */
function readSwiftPackage(
  dir: string,
  _projectRoot: string,
  manifestPath: string,
  id: string,
  relativeRoot: string,
  baseName: string,
): DiscoveredSystem {
  let raw = '';
  try { raw = fs.readFileSync(manifestPath, 'utf-8'); } catch { /* ignore */ }
  // `let package = Package(\n    name: "BillingCore",` — the first
  // `name:` in the file is the package's own, since targets come later.
  const nameMatch = raw.match(/name\s*:\s*"([^"]+)"/);
  const packageName = nameMatch ? nameMatch[1] : baseName;

  return {
    id, name: packageName, rootPath: dir, relativeRoot,
    language: 'swift',
    manifestKind: 'Package.swift',
    manifestPath,
    isWorkspaceRoot: false,
    packageName,
  };
}

function readComposerJson(
  dir: string,
  _projectRoot: string,
  manifestPath: string,
  id: string,
  relativeRoot: string,
  baseName: string,
): DiscoveredSystem {
  let pkg: any = {};
  try { pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { /* ignore */ }
  const packageName: string | undefined = typeof pkg.name === 'string' ? pkg.name : undefined;

  return {
    id, name: packageName || baseName, rootPath: dir, relativeRoot,
    language: 'php',
    manifestKind: 'composer.json',
    manifestPath,
    isWorkspaceRoot: false,
    packageName,
  };
}

function readTsconfigSystem(dir: string, projectRoot: string): DiscoveredSystem {
  const id = stableId(dir);
  const relativeRoot = path.relative(projectRoot, dir);
  const baseName = path.basename(dir) || 'project';
  return {
    id,
    name: baseName,
    rootPath: dir,
    relativeRoot,
    language: 'typescript',
    manifestKind: 'tsconfig.json',
    manifestPath: path.join(dir, 'tsconfig.json'),
    isWorkspaceRoot: false,
  };
}

function makeInformalSystem(rootPath: string, projectRoot: string): DiscoveredSystem {
  return {
    id: stableId(rootPath),
    name: path.basename(rootPath) || 'project',
    rootPath,
    relativeRoot: path.relative(projectRoot, rootPath),
    language: 'mixed',
    manifestKind: 'informal',
    manifestPath: null,
    isWorkspaceRoot: false,
  };
}

function stableId(absPath: string): string {
  return createHash('sha1').update(absPath).digest('hex').slice(0, 12);
}

// ============================================================
// Alias map building
// ============================================================

/**
 * Build the workspace-alias map from a list of discovered systems plus
 * any tsconfig.json `compilerOptions.paths` mappings reachable from
 * those systems' roots.
 *
 * The resolver consumes this map to turn `@swf/ui` into a real file
 * path under `packages/ui`.
 */
export function buildAliasMap(systems: DiscoveredSystem[]): AliasMapping[] {
  const map: AliasMapping[] = [];

  // 1. npm-style package aliases — every package.json with a name
  for (const sys of systems) {
    if (!sys.packageName) continue;
    if (sys.manifestKind !== 'package.json') continue;
    map.push({
      alias: sys.packageName,
      rootPath: sys.rootPath,
      entries: sys.entryHints,
      source: 'package',
    });
  }

  // 2. tsconfig.json `paths` — pulled per-tsconfig
  for (const sys of systems) {
    const tsconfigPath = path.join(sys.rootPath, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) continue;
    const tsPaths = readTsconfigPaths(tsconfigPath, sys.rootPath);
    for (const m of tsPaths) map.push(m);
  }

  // Stable ordering: longest alias first so prefix matching is greedy.
  map.sort((a, b) => b.alias.length - a.alias.length);
  return map;
}

function readTsconfigPaths(tsconfigPath: string, configDir: string): AliasMapping[] {
  const out: AliasMapping[] = [];
  let raw = '';
  try { raw = fs.readFileSync(tsconfigPath, 'utf-8'); } catch { return out; }

  // tsconfig.json often has comments, which JSON.parse rejects. Strip them.
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,\s*([}\]])/g, '$1'); // tolerate trailing commas

  let pkg: any;
  try { pkg = JSON.parse(stripped); } catch { return out; }

  const compilerOptions = pkg?.compilerOptions || {};
  const baseUrl: string = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
  const baseDir = path.resolve(configDir, baseUrl);
  const paths = compilerOptions.paths;
  if (!paths || typeof paths !== 'object') return out;

  for (const [pattern, candidates] of Object.entries(paths)) {
    if (!Array.isArray(candidates)) continue;
    // Only keep simple "@app/*" or "@app" style aliases. Wildcards are
    // expanded by stripping the trailing /*.
    const cleanAlias = pattern.replace(/\/\*$/, '');
    for (const candidate of candidates as string[]) {
      const cleanCandidate = candidate.replace(/\/\*$/, '');
      const resolvedRoot = path.resolve(baseDir, cleanCandidate);
      out.push({
        alias: cleanAlias,
        rootPath: resolvedRoot,
        source: 'tsconfig-paths',
      });
    }
  }

  return out;
}
