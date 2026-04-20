import fs from 'node:fs';
import path from 'node:path';
import type { MonorepoConfig, MonorepoType, PackageInfo } from '../../shared/types';

/**
 * Detects monorepo type and discovers workspace packages.
 * Reads config files directly — no dependency on pnpm/nx CLIs.
 */
export function detectMonorepo(rootPath: string): MonorepoConfig {
  const type = detectType(rootPath);
  const packages = discoverPackages(rootPath, type);
  const dependencyGraph = buildDependencyGraph(packages);

  return { type, root: rootPath, packages, dependencyGraph };
}

function detectType(rootPath: string): MonorepoType {
  // Check pnpm workspaces
  if (fs.existsSync(path.join(rootPath, 'pnpm-workspace.yaml'))) {
    return 'pnpm-workspaces';
  }

  // Check nx
  if (fs.existsSync(path.join(rootPath, 'nx.json'))) {
    return 'nx';
  }

  // Check turborepo
  if (fs.existsSync(path.join(rootPath, 'turbo.json'))) {
    return 'turborepo';
  }

  // Check npm workspaces (in package.json)
  const pkgPath = path.join(rootPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.workspaces) return 'npm-workspaces';
    } catch { /* ignore */ }
  }

  return 'single';
}

function discoverPackages(rootPath: string, type: MonorepoType): PackageInfo[] {
  if (type === 'single') {
    return [readPackageInfo(rootPath)].filter(Boolean) as PackageInfo[];
  }

  const patterns = getWorkspacePatterns(rootPath, type);
  const packages: PackageInfo[] = [];

  for (const pattern of patterns) {
    // Simple glob: resolve "packages/*" style patterns
    const basePath = pattern.replace(/\/?\*.*$/, '');
    const fullBase = path.join(rootPath, basePath);

    if (!fs.existsSync(fullBase)) continue;

    const entries = fs.readdirSync(fullBase, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const pkgDir = path.join(fullBase, entry.name);
      const info = readPackageInfo(pkgDir);
      if (info) packages.push(info);
    }
  }

  return packages;
}

function getWorkspacePatterns(rootPath: string, type: MonorepoType): string[] {
  if (type === 'pnpm-workspaces') {
    try {
      const content = fs.readFileSync(path.join(rootPath, 'pnpm-workspace.yaml'), 'utf-8');
      // Basic YAML parsing for packages list
      const matches = content.match(/- ['"]?([^'"]+)['"]?/g);
      return matches?.map((m) => m.replace(/^- ['"]?/, '').replace(/['"]?$/, '')) || [];
    } catch { return []; }
  }

  // npm workspaces / turborepo / nx — all use package.json workspaces
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8'));
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages || [];
    return workspaces;
  } catch { return []; }
}

function readPackageInfo(pkgDir: string): PackageInfo | null {
  const pkgPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return {
      name: pkg.name || path.basename(pkgDir),
      path: pkgDir,
      version: pkg.version || '0.0.0',
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
    };
  } catch {
    return null;
  }
}

function buildDependencyGraph(packages: PackageInfo[]): Map<string, string[]> {
  const names = new Set(packages.map((p) => p.name));
  const graph = new Map<string, string[]>();

  for (const pkg of packages) {
    const deps = [
      ...Object.keys(pkg.dependencies),
      ...Object.keys(pkg.devDependencies),
    ].filter((d) => names.has(d));

    graph.set(pkg.name, deps);
  }

  return graph;
}
