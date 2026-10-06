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
const SYMBOL = /^([^#\s:]+)#([^#\s/]+)$/;
const IMPORTISH = /^\s*(import\b|from\b|export\b.*\bfrom\b|use\b|using\b|require\b|#include\b|package\b)|\brequire\s*\(|\bimport\s*\(/;

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** The line that imports `target` in `text`, 1-based; null when no import line names it. */
export function importLine(text: string, target: string): number | null {
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
