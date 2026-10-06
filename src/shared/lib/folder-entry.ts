/**
 * Phase 33 R8 — what a folder rule reads about a file, and what it says
 * (RULES-AND-CLARITY §3.3).
 *
 * A folder rule says what the files in a folder are: named to a pattern
 * (`*-service.ts`), of a kind (`ts`), exporting one thing each. It reads one
 * fact per file, kept as an entry beside the import edges so the same check,
 * gate and rules view carry it:
 *
 *     file:<its name>:<how many names it exports, or ? when the language does not say>
 *
 * A renamed or added file gives a new fact, so the gate judges files a change
 * adds or renames, and one that changes what it exports; a file already there
 * and untouched is debt the rules view lists, never a new finding.
 */

const FACT_RE = /^file:([^:/]+):(\d+|\?)$/;

export interface FolderTerms {
  /** Name patterns, any of which a file's name matches: `*-service.ts`. */
  files?: string[];
  /** File kinds, by extension without the dot: `ts`, `tsx`. */
  kinds?: string[];
  /** `one`: each file exports one name. */
  exports?: 'one';
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** The fact for one file: its name and how many names it exports. */
export function fileFact(path: string, exportCount: number | null): string {
  return `file:${basename(path)}:${exportCount === null ? '?' : exportCount}`;
}

export function isFileFact(s: string): boolean {
  return FACT_RE.test(s);
}

export function parseFileFact(s: string): { name: string; exports: number | null } | null {
  const m = FACT_RE.exec(s);
  return m ? { name: m[1], exports: m[2] === '?' ? null : Number(m[2]) } : null;
}

/** A name pattern: `*` matches within the name. */
export function nameMatches(pattern: string, name: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(name);
}

const extOf = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };

/** What is wrong with a file under a folder rule, in words, or null: "is named rulebook.ts, not *-service.ts". */
export function folderProblem(terms: FolderTerms, fact: string): string | null {
  const f = parseFileFact(fact);
  if (!f) return null;
  if (terms.kinds?.length && !terms.kinds.includes(extOf(f.name))) {
    return `is a ${extOf(f.name) ? `.${extOf(f.name)}` : 'extensionless'} file, not ${terms.kinds.map((k) => `.${k}`).join(' or ')}`;
  }
  if (terms.files?.length && !terms.files.some((p) => nameMatches(p, f.name))) {
    return `is named ${f.name}, not ${terms.files.join(' or ')}`;
  }
  if (terms.exports === 'one' && f.exports !== null && f.exports > 1) return `exports ${f.exports} names, not one`;
  return null;
}

/** "files in src/backend/services/ are named *-service.ts and export one thing each" */
export function folderWords(folder: string, terms: FolderTerms): string {
  const parts = [
    terms.kinds?.length ? `are ${terms.kinds.map((k) => `.${k}`).join(' or ')} files` : null,
    terms.files?.length ? `are named ${terms.files.join(' or ')}` : null,
    terms.exports === 'one' ? 'export one thing each' : null,
  ].filter(Boolean) as string[];
  // C6: a guide alone says nothing checkable; the guide itself is shown beside the words.
  if (!parts.length) return `files in ${folder} follow its guide`;
  const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `files in ${folder} ${said}`;
}

const MARKS_EXPORTS = new Set(['typescript', 'tsx', 'javascript', 'jsx']);

/**
 * How many names a file exports, from its top-level symbols, the same way on
 * a branch (a parse) and in the scanned graph: the ones marked `export` in
 * TypeScript and JavaScript, the ones without a leading underscore in
 * Python; null where the language does not say, which no rule judges.
 */
export function exportCount(language: string, symbols: ReadonlyArray<{ name: string; modifiers: readonly string[] }>): number | null {
  const top = symbols.filter((s) => !/[.#(]/.test(s.name));
  if (MARKS_EXPORTS.has(language)) return top.filter((s) => s.modifiers.includes('export')).length;
  if (language === 'python') return top.filter((s) => !s.name.startsWith('_')).length;
  return null;
}
