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
import { getAllFileHashes, getImportResolutionContext } from './database';
import { getResolverForLanguage } from './resolvers';
import { showAt } from './branch-workstreams';
import { baseContent, currentContent } from './workstream-symbols';

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
export function importsAdded(projectRoot: string, w: Pick<Workstream, 'root' | 'shape' | 'head' | 'changes'>, mainRoot: string | null): ImportEdge[] {
  const base = w.changes.base;
  const branch = w.shape === 'branch' && w.head && mainRoot ? w.head : null;
  const folder = branch ? mainRoot! : w.root;
  const read = (rel: string) => (branch ? showAt(mainRoot!, branch, rel) : currentContent(w.root, rel));

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
    }
    return out;
  };

  const edges: ImportEdge[] = [];
  for (const file of w.changes.files) {
    if (file.status === 'deleted') continue;
    const key = `${folder}\0${file.path}`;
    const stamp = stampOf(folder, base, file, branch);
    const hit = cache.get(key);
    if (hit && hit.stamp === stamp) { edges.push(...hit.added); continue; }
    const beforePath = file.status === 'renamed' && file.from ? file.from : file.path;
    const after = targets(file.path, read(file.path));
    const before = file.status === 'added' || !base ? new Set<string>() : targets(beforePath, baseContent(folder, base, beforePath));
    const added = [...after].filter((t) => !before.has(t)).sort().map((to) => ({ from: file.path, to }));
    if (cache.size >= MAX_CACHED) cache.clear();
    cache.set(key, { stamp, added });
    edges.push(...added);
  }
  return edges;
}
