/**
 * Dependency edges for a `commit:` side of a comparison (Phase 32 A5.1).
 *
 * A commit side used to carry files and no edges, so every comparison with
 * one switched off "dependencies nobody planned" and blast radius. That is
 * the default review (the newest commit against the working tree), and it
 * is every branch review parallel work produces.
 *
 * The edges are built from what is already known:
 *
 *  - A file whose bytes are the same at the commit as in the working tree,
 *    and whose imports all still land on files that exist at the commit,
 *    keeps its edges from the opened project's graph.
 *  - Any other file is parsed at the commit with its imports kept, and each
 *    import is resolved by the project's own resolver against the files
 *    that exist at the commit.
 *
 * Parsed imports are cached by blob id. A blob id names its bytes, so the
 * cache holds across commits and projects, which is what keeps playback
 * (up to 100 commits in a row, mostly sharing blobs) affordable. Past
 * `MAX_PARSED` files to parse, the edges stay unknown and the reason is
 * given, rather than stalling the request.
 */

import path from 'node:path';

export const MAX_PARSED = 400;
const IMPORT_CACHE_MAX = 20_000;

export interface ParsedImports {
  language: string;
  imports: Array<{ source: string; isRelative?: boolean }>;
}

export interface CommitEdgeDeps {
  /** Blob contents by id; an id git cannot read is left out. */
  readBlobs(oids: string[]): Map<string, string>;
  /** The imports of a file, parsed from its content; null when the language has no parser. */
  parseImports(absPath: string, content: string): ParsedImports | null;
  /** The project's resolver for that language: an absolute path, or null. */
  resolve(language: string, importSource: string, importerAbs: string, knownFiles: Set<string>, isRelative?: boolean): string | null;
  /** A path relative to the project, in the form snapshots use. */
  relative(absPath: string): string;
}

export interface CommitEdgeInput {
  projectPath: string;
  /** The commit's files: relative path to content hash. */
  files: Map<string, { hash: string }>;
  /** The commit's files: relative path to blob id. */
  oids: Map<string, string>;
  /** The working tree as the opened project's graph has it. */
  live: { files: Map<string, { hash: string }>; edges: Set<string> };
}

export type CommitEdges = { ok: true; edges: Set<string>; parsed: number } | { ok: false; reason: string };

const importCache = new Map<string, ParsedImports | null>();

/** Tests only. */
export function clearCommitEdgeCache(): void {
  importCache.clear();
}

export function commitEdges(input: CommitEdgeInput, deps: CommitEdgeDeps): CommitEdges {
  const { projectPath, files, oids, live } = input;

  const liveOut = new Map<string, string[]>();
  for (const e of live.edges) {
    const i = e.indexOf('->');
    if (i === -1) continue;
    const src = e.slice(0, i);
    const list = liveOut.get(src);
    if (list) list.push(e.slice(i + 2));
    else liveOut.set(src, [e.slice(i + 2)]);
  }

  const edges = new Set<string>();
  const toParse: string[] = [];
  for (const [rel, { hash }] of files) {
    const same = live.files.get(rel)?.hash === hash;
    const targets = liveOut.get(rel) ?? [];
    if (same && targets.every((t) => files.has(t))) {
      for (const t of targets) edges.add(`${rel}->${t}`);
    } else {
      toParse.push(rel);
    }
  }

  if (toParse.length > MAX_PARSED) {
    return {
      ok: false,
      reason: `${toParse.length} files differ from the working tree at this commit, more than the ${MAX_PARSED} parsed to find its dependencies.`,
    };
  }

  const uncached = [...new Set(toParse.map((rel) => oids.get(rel)).filter((o): o is string => !!o && !importCache.has(o)))];
  const blobs = uncached.length ? deps.readBlobs(uncached) : new Map<string, string>();
  const knownFiles = new Set([...files.keys()].map((rel) => path.join(projectPath, rel)));

  for (const rel of toParse) {
    const oid = oids.get(rel);
    if (!oid) continue;
    const abs = path.join(projectPath, rel);
    if (!importCache.has(oid)) {
      const content = blobs.get(oid);
      if (content === undefined) continue;
      if (importCache.size >= IMPORT_CACHE_MAX) importCache.clear();
      importCache.set(oid, deps.parseImports(abs, content));
    }
    const parsed = importCache.get(oid);
    if (!parsed) continue;
    for (const imp of parsed.imports) {
      const target = deps.resolve(parsed.language, imp.source, abs, knownFiles, imp.isRelative);
      if (!target || target === abs) continue;
      const targetRel = deps.relative(target);
      if (files.has(targetRel)) edges.add(`${rel}->${targetRel}`);
    }
  }

  return { ok: true, edges, parsed: toParse.length };
}
