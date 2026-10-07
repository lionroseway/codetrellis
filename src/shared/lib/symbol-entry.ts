/**
 * Phase 33 R6 — a named export, as a symbol rule names it
 * (RULES-AND-CLARITY §3.3).
 *
 * A symbol entry is a project file and a name it exports:
 * `src/payments/charge.ts#createCharge`. A symbol rule names one and says who
 * alone may import it. An import of that name is an edge to the entry, from
 * the file that defines it or from any barrel that passes it on, so importing
 * `createCharge` through `src/payments/index.ts` is importing it too.
 *
 * `default` is a module's default export; `*` is the whole module, imported as
 * a namespace (`import * as pay from './charge'`), which may use any name.
 */

const SYMBOL_RE = /^([^#\s]+)#([^#\s/]+)$/;

/** Whether `s` is a symbol entry (`src/a.ts#name`), not a path or a package. */
export function isSymbolEntry(s: string): boolean {
  return SYMBOL_RE.test(s) && !s.includes(':');
}

/** `src/a.ts#name` */
export function symbolEntry(file: string, name: string): string {
  return `${file}#${name}`;
}

/** The file and the name, or null. */
export function splitSymbol(s: string): { file: string; name: string } | null {
  if (!isSymbolEntry(s)) return null;
  const m = SYMBOL_RE.exec(s)!;
  return { file: m[1], name: m[2] };
}

/** Why a written symbol is not one, or null. */
export function symbolProblem(s: unknown): string | null {
  if (typeof s !== 'string' || !isSymbolEntry(s.trim())) return 'symbol must be a file and a name it exports, like src/payments/charge.ts#createCharge';
  const { file, name } = splitSymbol(s.trim())!;
  if (file.startsWith('/') || /^[a-zA-Z]:/.test(file) || file.includes('\\')) return 'symbol must name a file relative to the project';
  if (file.split('/').includes('..')) return 'symbol may not climb out of the project';
  if (name === '*') return 'symbol must name one export, not the whole module';
  return null;
}

/**
 * Whether an import of `entry` is an import of the rule's symbol: the same
 * file and name, or the whole module as a namespace, which may use it.
 */
export function symbolMatches(ruleSymbol: string, entry: string): boolean {
  const rule = splitSymbol(ruleSymbol);
  const got = splitSymbol(entry);
  if (!rule || !got || rule.file !== got.file) return false;
  return got.name === rule.name || got.name === '*';
}
