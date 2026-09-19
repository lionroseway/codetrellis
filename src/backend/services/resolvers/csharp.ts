import path from 'node:path';
import fs from 'node:fs';
import type { ResolverPlugin, ResolveContext } from './base';
import { pickRepresentativeFile } from './base';
import type { DiscoveredSystem } from '../../../shared/types';

/**
 * C# resolver — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * ## What a `using` actually is
 *
 * A `using` names a **namespace**, and a namespace is not a file, not a
 * directory, and not a project. It can be declared by one file or by two
 * hundred spread across three assemblies; nothing in the language ties it
 * to a path. So there is no resolution rule here that is *correct* — only
 * one that is useful and honest about being a convention.
 *
 * The convention every .NET project template and every IDE enforces is:
 *
 *   <project dir>/<RootNamespace>            ← the csproj
 *   <project dir>/Services/                  ← namespace <Root>.Services
 *   <project dir>/Services/InvoicePoster.cs
 *
 * So the rule is the Go rule with namespaces instead of module paths:
 * index every csproj by its root namespace, take the longest matching
 * prefix, map the remaining dotted segments to directories, and let one
 * representative file in that directory carry the edge.
 *
 * ## What this deliberately does not do
 *
 * - **No type-level resolution.** `using Acme.Billing` followed by
 *   `new Invoice()` is the coupling a reader cares about, and it is
 *   invisible without a symbol table. The namespace edge is a coarser
 *   claim that we can actually justify.
 * - **No `<Compile Include>` handling.** A csproj can pull files from
 *   anywhere; the SDK-style default (everything under the project
 *   directory) is what is assumed. A project using explicit includes
 *   under-resolves rather than mis-resolves.
 * - **No BCL or NuGet edges.** Those are external by definition, and an
 *   edge to a package we cannot see would be a lie about the graph.
 */

interface NamespaceRoot {
  /** Root namespace the project directory maps to. */
  namespace: string;
  /** Absolute directory holding the csproj. */
  rootPath: string;
}

/**
 * Framework and first-party-Microsoft namespaces. An import of these is
 * an external dependency in every project, so there is nothing in the
 * scanned tree for the edge to point at.
 */
const EXTERNAL_PREFIXES = [
  'System', 'Microsoft', 'Windows', 'Internal', 'Newtonsoft',
  'Xunit', 'NUnit', 'Moq', 'FluentAssertions', 'AutoMapper', 'Serilog',
];

function isExternal(namespace: string): boolean {
  const first = namespace.split('.')[0];
  return EXTERNAL_PREFIXES.includes(first);
}

// `<RootNamespace>` parsing keyed by csproj path + mtime, so editing a
// project file is picked up on the next scan without a restart. Same
// shape as the Go resolver's `replace` cache.
const rootNamespaceCache = new Map<string, { mtimeMs: number; value: string | null }>();

/**
 * `<RootNamespace>` from the csproj, or null to fall back to the project
 * file's own name — which is what MSBuild itself does.
 */
function readRootNamespace(manifestPath: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(manifestPath);
  } catch {
    return null;
  }
  const cached = rootNamespaceCache.get(manifestPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;

  let value: string | null = null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    value = raw.match(/<RootNamespace>\s*([^<\s]+)\s*<\/RootNamespace>/)?.[1] ?? null;
  } catch {
    value = null;
  }
  rootNamespaceCache.set(manifestPath, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function buildNamespaceIndex(systems: ReadonlyArray<DiscoveredSystem>): NamespaceRoot[] {
  const roots: NamespaceRoot[] = [];
  for (const sys of systems) {
    if (sys.manifestKind !== 'csproj') continue;
    const declared = sys.manifestPath ? readRootNamespace(sys.manifestPath) : null;
    // MSBuild's default root namespace is the project file's base name,
    // which `system-discovery` already stores as `packageName`.
    const ns = declared || sys.packageName || sys.name;
    if (ns) roots.push({ namespace: ns, rootPath: sys.rootPath });
  }
  // Longest namespace first: a solution can hold `Acme.Billing` and
  // `Acme.Billing.Api` side by side, and the more specific must win.
  roots.sort((a, b) => b.namespace.length - a.namespace.length);
  return roots;
}

function resolve(ctx: ResolveContext): string | null {
  const { importSource, knownFiles, systems } = ctx;
  if (!importSource) return null;
  if (isExternal(importSource)) return null;

  for (const root of buildNamespaceIndex(systems)) {
    if (importSource !== root.namespace && !importSource.startsWith(root.namespace + '.')) {
      continue;
    }
    const remainder = importSource.slice(root.namespace.length).replace(/^\./, '');
    const dir = remainder
      ? path.join(root.rootPath, ...remainder.split('.'))
      : root.rootPath;

    const hit = pickRepresentativeFile(dir, knownFiles, {
      extensions: ['.cs'],
      prefer: remainder ? remainder.split('.').pop() : path.basename(dir),
    });
    if (hit) return hit;
    // Prefix matched but nothing scanned lives there — keep trying
    // shorter roots rather than claiming a miss.
  }

  return null;
}

export const csharpResolver: ResolverPlugin = {
  languages: ['csharp'],
  resolve,
};
