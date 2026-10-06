/**
 * Phase 32 A7.2 — the imports a workstream adds (awareness spec M7).
 *
 * For each file a workstream changed, its imports at the merge base and now,
 * parsed and resolved by the scanner's own parser and resolvers (A2.2), as
 * A5.1's commit edges are. The difference is what the workstream adds: an
 * import that was already there is never news, so a rule written today
 * signals only what work in flight brings.
 *
 * Resolution needs the project's import context (aliases, discovered
 * systems), which the backend holds for the project whose graph is loaded;
 * the caller asks only for that project.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ChangedFile, Workstream } from '../../shared/types';
import { parseVirtualFile } from './ast-parser';
import { getAllFileHashes, getImportResolutionContext, resolutionContextRoot } from './database';
import { getResolverForLanguage } from './resolvers';
import { packageEntry } from '../../shared/lib/package-entry';
import { symbolEntry } from '../../shared/lib/symbol-entry';
import { originsOf } from './importers';
import { ruleFix } from '../../shared/lib/check-words';
import { showAtAsync } from './branch-workstreams';
import { baseContent, currentContent } from './workstream-symbols';
import { checkEdges, ruleStatement, rulesOf } from './architecture-rules';
import type { RuleImport } from './conformity-gate';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';

export interface ImportEdge { from: string; to: string }

const MAX_CACHED = 5_000;
const cache = new Map<string, { stamp: string; added: ImportEdge[] }>();

const posix = (p: string) => p.split(path.sep).join('/');

function stampOf(folder: string, base: string | null, file: ChangedFile, head: string | null): string {
  if (head) return `${base}|${head}|${file.status}|${file.from ?? ''}`;
  let st = 'gone';
  try {
    const s = fs.statSync(path.join(folder, file.path));
    st = `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  } catch { /* deleted */ }
  return `${base}|${file.status}|${file.from ?? ''}|${st}`;
}

/**
 * The import edges a workstream's changes add, project-relative. `mainRoot`
 * is the main checkout, where a branch workstream (no folder of its own) is
 * read at its head commit.
 */
export async function importsAdded(
  projectRoot: string,
  w: Pick<Workstream, 'root' | 'shape' | 'head' | 'changes'>,
  mainRoot: string | null,
  opts: { packages?: boolean; symbols?: boolean } = {},
): Promise<ImportEdge[]> {
  const base = w.changes.base;
  const branch = w.shape === 'branch' && w.head && mainRoot ? w.head : null;
  const folder = branch ? mainRoot! : w.root;
  const read = async (rel: string) => (branch ? showAtAsync(mainRoot!, branch, rel) : currentContent(w.root, rel));

  const known = new Set(getAllFileHashes().keys());
  for (const f of w.changes.files) if (f.status !== 'deleted') known.add(path.join(projectRoot, f.path));
  const { aliasMap, systems } = getImportResolutionContext(projectRoot);

  const targets = (rel: string, content: string | null): Set<string> => {
    const out = new Set<string>();
    if (content === null) return out;
    const abs = path.join(projectRoot, rel);
    let parsed: ReturnType<typeof parseVirtualFile> = null;
    try { parsed = parseVirtualFile(abs, content); } catch { return out; }
    if (!parsed) return out;
    const resolver = getResolverForLanguage(parsed.language);
    if (!resolver) return out;
    for (const imp of parsed.imports) {
      const hit = resolver.resolve({ importSource: imp.source, importerPath: abs, projectRoot, knownFiles: known, aliasMap, systems, isRelative: imp.isRelative });
      if (hit) out.add(posix(path.relative(projectRoot, hit)));
      if (hit && opts.symbols && !imp.isReexport) {
        // R6: each name it imports, where it is defined as well as where it was
        // imported from, so a barrel does not hide it. A namespace may use any.
        const names = imp.isNamespace ? ['*'] : [...imp.specifiers, ...(imp.isDefault ? ['default'] : [])];
        for (const name of names) {
          for (const origin of originsOf(hit, name)) out.add(symbolEntry(posix(path.relative(projectRoot, origin)), name));
        }
      }
      else if (opts.packages) {
        // R5: an outside import, as its package, for package rules to read.
        const entry = packageEntry(parsed.language, imp.source, imp.isRelative);
        if (entry) out.add(entry);
      }
    }
    return out;
  };

  const edges: ImportEdge[] = [];
  for (const file of w.changes.files) {
    if (file.status === 'deleted') continue;
    const key = `${folder}\0${file.path}\0${opts.packages ? 'p' : ''}${opts.symbols ? 's' : ''}`;
    const stamp = stampOf(folder, base, file, branch);
    const hit = cache.get(key);
    if (hit && hit.stamp === stamp) { edges.push(...hit.added); continue; }
    const beforePath = file.status === 'renamed' && file.from ? file.from : file.path;
    const after = targets(file.path, await read(file.path));
    const before = file.status === 'added' || !base ? new Set<string>() : targets(beforePath, await baseContent(folder, base, beforePath));
    const added = [...after].filter((t) => !before.has(t)).sort().map((to) => ({ from: file.path, to }));
    if (cache.size >= MAX_CACHED) cache.clear();
    cache.set(key, { stamp, added });
    edges.push(...added);
  }
  return edges;
}

const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/**
 * Whether this project's imports can be resolved here: its aliases and
 * systems are held only for the project whose graph was last scanned.
 * Resolving another with none would invent breaches, or miss them.
 */
export function importsReadableFor(projectRoot: string): boolean {
  const held = resolutionContextRoot();
  return !!held && real(held) === real(projectRoot);
}

/**
 * The gate's question (A7.3): which imports do these changed files, in the
 * project's own folder, add across its rules since `base` (a commit)? Null
 * when the project's imports cannot be read here; empty when it has no rules.
 * `rules` are the ones to judge by: the base's (Phase 33 R2), else the
 * project's own.
 */
export async function ruleImports(projectRoot: string, files: readonly string[], base: string | null, judgeBy?: readonly ArchitectureRule[]): Promise<RuleImport[] | null> {
  const rules = judgeBy ? [...judgeBy] : rulesOf(projectRoot);
  if (rules.length === 0) return [];
  if (!importsReadableFor(projectRoot)) return null;
  const edges = await importsAdded(projectRoot, {
    root: projectRoot, shape: 'shared', head: null,
    changes: { base, files: files.map((f) => ({ path: f, status: 'modified' as const })), truncated: false },
  }, null, { packages: true, symbols: rules.some((r) => r.kind === 'symbol') });
  const byId = new Map(rules.map((r) => [r.id, r]));
  return checkEdges(rules, edges).map((b) => {
    const rule = byId.get(b.rule)!;
    return {
      path: b.from, imports: b.to, rule: rule.id, words: ruleStatement({ ...rule, except: [] }), because: rule.because, strength: rule.strength === 'block' ? 'block' : 'warn',
      suite: rule.suite ?? 'architecture', fix: ruleFix(rule),
    };
  });
}
