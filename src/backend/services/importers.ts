/**
 * Who imports a file, or a name from it (Phase 32 A2.2).
 *
 * "Who uses X" is answered from imports (awareness spec §3: there is no call
 * graph). Two things made that answer wrong:
 *
 *  - **Barrels.** `export * from './validators'` was not an import at all, so
 *    `validators.ts` had no importers, and a component importing
 *    `validateCreateUser` from the package's `index.ts` was not known to use
 *    it. Re-exports are now recorded (`imports.is_reexport`) and followed.
 *  - **Aliases.** Python recorded `from x import a as b` as `b`. It records
 *    `a` now, so a name is looked up as its module exports it.
 *
 * The lookup follows a re-export only for the names it passes on: through
 * `export *`, the names the file exports; through `export { a }`, just `a`.
 * So a file importing only types through a barrel is not counted as using
 * the barrel's validators. A namespace import (`import * as v`) could use
 * any of them, and is reported as "possibly".
 */

import path from 'node:path';
import { getDb } from './database';

export interface Importer {
  /** Absolute and project-relative path of the importing file. */
  path: string;
  relativePath: string;
  /** The names it imports that the file exports (its own spelling for a direct default import). */
  names: string[];
  /** A namespace import: it may use any of them. */
  possibly: boolean;
  /** The barrels it goes through, nearest the importer first; empty for a direct import. */
  via: string[];
}

/** How deep a chain of barrels is followed. Real ones are one or two deep. */
const MAX_DEPTH = 5;

interface Row { path: string; rel: string; specifiers: string[]; namespace: boolean; reexport: boolean }

/**
 * A Go file is imported through its package (A2.7): an import names a
 * directory, and the resolver stores one representative file of it. So a
 * Go file's importers are its package's, and each is a namespace import
 * (`ledger.Post`), which may use any of the package's names.
 */
const isGo = (file: string) => /\.go$/.test(file) && !/_test\.go$/.test(file);

function rowsImporting(target: string): Row[] {
  const go = isGo(target);
  const dir = path.dirname(target);
  const res = go
    ? getDb().exec(
      `SELECT f.path, f.relative_path, i.specifiers, i.is_namespace, i.is_reexport, i.resolved_path
         FROM imports i JOIN files f ON i.file_id = f.id
        WHERE i.resolved_path LIKE ? ESCAPE '\\'`,
      [`${dir.replace(/[\\%_]/g, (c) => `\\${c}`)}${path.sep}%.go`],
    )
    : getDb().exec(
      `SELECT f.path, f.relative_path, i.specifiers, i.is_namespace, i.is_reexport
         FROM imports i JOIN files f ON i.file_id = f.id
        WHERE i.resolved_path = ?`,
      [target],
    );
  const rows = (res[0]?.values ?? []).filter((r) => !go || (path.dirname(r[5] as string) === dir && isGo(r[5] as string)));
  if (go) {
    return rows.map((r) => ({ path: r[0] as string, rel: r[1] as string, specifiers: [], namespace: true, reexport: false }));
  }
  return rows.map((r) => ({
    path: r[0] as string,
    rel: r[1] as string,
    specifiers: JSON.parse((r[2] as string) || '[]') as string[],
    namespace: r[3] === 1,
    reexport: r[4] === 1,
  }));
}

/**
 * The names a file exports, from its top-level symbols: those marked
 * `export`, or for Python, those without a leading underscore. Empty when
 * the language marks nothing (then names can't be narrowed, and aren't).
 */
export function exportedNames(filePath: string): Set<string> {
  const res = getDb().exec(
    `SELECT s.name, s.modifiers, f.language FROM symbols s JOIN files f ON s.file_id = f.id
      WHERE f.path = ? AND s.parent_symbol_id IS NULL`,
    [filePath],
  );
  const out = new Set<string>();
  for (const [name, mods, lang] of res[0]?.values ?? []) {
    const modifiers = JSON.parse((mods as string) || '[]') as string[];
    if (modifiers.includes('export') || (lang === 'python' && !(name as string).startsWith('_'))) out.add(name as string);
  }
  return out;
}

/** The absolute path a caller's path names, as the graph stores it. */
function stored(filePath: string): string {
  const row = getDb().exec(
    `SELECT path FROM files WHERE path = ? OR relative_path = ? LIMIT 1`,
    [filePath, filePath.replace(/^\.\//, '')],
  );
  return (row[0]?.values[0]?.[0] as string | undefined) ?? filePath;
}

/**
 * The files that import `filePath` — directly, or through re-exports — or,
 * with `names`, those that import one of those names from it. Barrels are
 * followed, not listed: a file that only passes names on does not use them.
 * One entry per importing file, the most direct route kept.
 */
export function importersOf(filePath: string, names?: readonly string[]): Importer[] {
  const target = stored(filePath);
  const found = new Map<string, Importer>();
  const seen = new Set<string>();

  const visit = (file: string, wanted: Set<string> | null, via: string[]) => {
    const key = `${file}\0${[...(wanted ?? ['*'])].sort().join(',')}`;
    if (seen.has(key) || via.length > MAX_DEPTH) return;
    seen.add(key);
    // What `file` offers: the asked-for names, or everything it exports.
    const offered = wanted ?? exportedNames(file);
    const narrow = wanted !== null || offered.size > 0;

    for (const row of rowsImporting(file)) {
      if (row.path === target) continue; // a cycle back to where we started
      if (row.reexport) {
        // Follow the barrel with the names it passes on.
        const star = row.specifiers.includes('*');
        const passed = row.namespace && !star
          ? null // `export * as ns`: a namespace downstream; followed as "anything"
          : new Set([...offered].filter((n) => star || row.specifiers.includes(n)));
        if (passed === null || passed.size > 0 || !narrow) visit(row.path, passed, [row.rel, ...via]);
        continue;
      }
      const direct = via.length === 0 && wanted === null;
      const uses = row.namespace ? [...offered] : row.specifiers.filter((s) => !narrow || offered.has(s));
      // A direct importer counts whatever it imports (a default import has its
      // own local name). Through a barrel, or when names were asked, it must
      // import one of them — or import everything as a namespace.
      if (!direct && !row.namespace && uses.length === 0) continue;
      const entry: Importer = {
        path: row.path, relativePath: row.rel,
        names: direct && !row.namespace ? row.specifiers : uses,
        possibly: row.namespace,
        via: [...via],
      };
      const had = found.get(row.path);
      if (!had || had.via.length > entry.via.length) found.set(row.path, entry);
    }
  };

  visit(target, names ? new Set(names) : null, []);
  return [...found.values()].sort((a, b) => a.via.length - b.via.length || a.relativePath.localeCompare(b.relativePath));
}

/**
 * Where a name a file offers comes from (Phase 33 R6): the file itself, then
 * each module it re-exports that name from, through barrels, nearest first.
 * So an import of `createCharge` from `src/payments/index.ts` is known to be
 * an import of `src/payments/charge.ts#createCharge` too. `*` (a namespace
 * import) follows every re-export. Absolute paths, as the graph stores them.
 */
export function originsOf(filePath: string, name: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string, depth: number) => {
    if (seen.has(file) || depth > MAX_DEPTH) return;
    seen.add(file);
    out.push(file);
    const res = getDb().exec(
      `SELECT i.resolved_path, i.specifiers FROM imports i JOIN files f ON i.file_id = f.id
        WHERE f.path = ? AND i.is_reexport = 1 AND i.resolved_path IS NOT NULL`,
      [file],
    );
    for (const [resolved, specs] of res[0]?.values ?? []) {
      const names = JSON.parse((specs as string) || '[]') as string[];
      if (name === '*' || names.includes(name) || names.includes('*')) visit(resolved as string, depth + 1);
    }
  };
  visit(stored(filePath), 0);
  return out;
}
