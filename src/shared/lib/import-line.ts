/**
 * Where in a file it imports something (Phase 33 C2, shared since G10).
 *
 * A check-run finding says a file imports a target; it does not say on which
 * line, because the line moves with every edit and a run is kept for months.
 * SARIF, the terminal, the code gutter and the diff view find the line in the
 * text they are showing, with this one function, so they all mark the same
 * line. Pure: no file is read here.
 */

const PACKAGE = /^(npm|pypi|go|cargo|maven|nuget|gem|composer|swift):(.+)$/;
const CALL = /^(http|sql):(.+)$/;
const SYMBOL = /^([^#\s:]+)#([^#\s/]+)$/;
const IMPORTISH = /^\s*(import\b|from\b|export\b.*\bfrom\b|use\b|using\b|require\b|#include\b|package\b)|\brequire\s*\(|\bimport\s*\(/;

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** The line that imports `target` in `text`, 1-based; null when no import line names it. */
export function importLine(text: string, target: string): number | null {
  // A call (R7) is not an import: the line that names its host or path, or its table.
  const call = CALL.exec(target);
  if (call) return callLine(text, call[1], call[2]);
  // A folder rule (R8) is about the file as a whole: its first line.
  if (target.startsWith('folder:')) return text.length ? 1 : null;
  // A package (R5) is named as the code names it: `npm:stripe` is `stripe`, `go:github.com/x/y` is `y`.
  const pkg = PACKAGE.exec(target);
  // A symbol (R6) is named by its name, however it was reached: `a.ts#createCharge` is `createCharge`.
  const sym = SYMBOL.exec(target);
  const base = pkg
    ? (pkg[1] === 'go' ? basename(pkg[2]) : pkg[2])
    : sym
      ? (sym[2] === '*' || sym[2] === 'default' ? basename(sym[1]).replace(/\.[^.]+$/, '') : sym[2])
      : basename(target).replace(/\.[^.]+$/, '');
  if (!base) return null;
  const word = new RegExp(`(^|[^A-Za-z0-9_])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (IMPORTISH.test(lines[i]) && word.test(lines[i])) return i + 1;
  }
  return null;
}

/** The first line naming the call: an HTTP host (else the path's first named segment), or a SQL table after a keyword. */
function callLine(text: string, protocol: string, rest: string): number | null {
  const lines = text.split('\n');
  let test: (line: string) => boolean;
  if (protocol === 'sql') {
    const table = rest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(from|into|update|join|table)\\s+[\`"']?${table}\\b`, 'i');
    test = (l) => re.test(l);
  } else {
    const slash = rest.indexOf('/');
    const host = slash < 0 ? rest : rest.slice(0, slash);
    const word = host || rest.split('/').find((x) => x && !x.startsWith(':')) || '';
    if (!word) return null;
    test = (l) => l.toLowerCase().includes(word.toLowerCase());
  }
  for (let i = 0; i < lines.length; i++) if (test(lines[i])) return i + 1;
  return null;
}
