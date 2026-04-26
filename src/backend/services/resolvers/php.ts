import fs from 'node:fs';
import path from 'node:path';
import type { ResolverPlugin, ResolveContext } from './base';
import { findContainingSystem } from './base';

/**
 * PHP resolver — minimum viable.
 *
 * Resolves `App\Auth\User` by reading the nearest composer.json's
 * PSR-4 autoload mapping. PSR-4 maps namespace prefixes to source
 * directories; we walk longest-prefix first.
 *
 * Composer's standard autoload section:
 *   {
 *     "autoload": {
 *       "psr-4": { "App\\": "src/", "Tests\\": "tests/" }
 *     }
 *   }
 */

interface Psr4Mapping {
  prefix: string;     // "App\\"  (without the trailing slash semantics)
  basePath: string;   // absolute directory
}

const psr4Cache = new Map<string, Psr4Mapping[]>();

function readPsr4(composerPath: string): Psr4Mapping[] {
  if (psr4Cache.has(composerPath)) return psr4Cache.get(composerPath)!;
  let mappings: Psr4Mapping[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(composerPath, 'utf-8'));
    const dir = path.dirname(composerPath);
    for (const section of ['autoload', 'autoload-dev'] as const) {
      const psr4 = pkg?.[section]?.['psr-4'];
      if (!psr4 || typeof psr4 !== 'object') continue;
      for (const [prefix, target] of Object.entries(psr4)) {
        const targets = Array.isArray(target) ? target : [target];
        for (const t of targets) {
          if (typeof t !== 'string') continue;
          mappings.push({
            prefix: prefix.replace(/\\$/, ''),
            basePath: path.resolve(dir, t),
          });
        }
      }
    }
  } catch { /* ignore malformed composer.json */ }
  // Longest prefix first
  mappings.sort((a, b) => b.prefix.length - a.prefix.length);
  psr4Cache.set(composerPath, mappings);
  return mappings;
}

function resolve(ctx: ResolveContext): string | null {
  const { importSource, importerPath, knownFiles, systems } = ctx;
  if (!importSource) return null;

  const fqcn = importSource.replace(/^\\/, '');

  const containing = findContainingSystem(importerPath, systems);
  if (!containing || containing.manifestKind !== 'composer.json' || !containing.manifestPath) {
    return null;
  }

  const mappings = readPsr4(containing.manifestPath);
  const cleanFqcn = fqcn.replace(/\\/g, '\\').replace(/\\$/, '');

  for (const m of mappings) {
    if (cleanFqcn === m.prefix || cleanFqcn.startsWith(m.prefix + '\\')) {
      const sub = cleanFqcn.slice(m.prefix.length).replace(/^\\/, '').replace(/\\/g, '/');
      const candidate = path.join(m.basePath, sub) + '.php';
      if (knownFiles.has(candidate)) return candidate;
    }
  }
  return null;
}

export const phpResolver: ResolverPlugin = {
  languages: ['php'],
  resolve,
};
