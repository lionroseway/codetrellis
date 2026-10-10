/**
 * Phase 33 B3 — fuzzy matching: how alike two names are, from 0 to 1.
 *
 * Both names are normalised first: split at a change of case and at `-`,
 * `_`, `.`, `/`, `:`, `@` and spaces, lowercased, and joined by one space,
 * so `reactDom`, `react-dom` and `react_dom` are the same name. Then the
 * score is one less the edit distance over the longer name's length, where
 * an edit is a letter added, dropped, changed, or two side by side swapped
 * (optimal string alignment). One swap in `requests` is 1 - 1/8 = 0.875.
 *
 * Pure and deterministic: the same two names always score the same, with no
 * model and no network. A rule matches a name at or above its `threshold`
 * (0.85 unless it says), and never the name it names: fuzzy means "like it,
 * and not it", which is what a look-alike is.
 */

export const DEFAULT_THRESHOLD = 0.85;
const MAX_NAME = 200;

/** A name as fuzzy matching reads it: `getUserID` is `get user id`, `react-dom` is `react dom`. */
export function normaliseName(s: string): string {
  return s.slice(0, MAX_NAME)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[-_./:@\s]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Edits from one to the other: add, drop, change, or swap two side by side. */
function distance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/** How alike two names are, 0 to 1, after normalising both. */
export function similarity(a: string, b: string): number {
  const x = normaliseName(a);
  const y = normaliseName(b);
  const longer = Math.max(x.length, y.length);
  return longer === 0 ? 1 : 1 - distance(x, y) / longer;
}

/** A score as it is said: two places, `0.88`. */
export const scoreWords = (n: number): string => n.toFixed(2);

/**
 * The part of a rule's target and of an entry that are compared, by kind: a
 * package's name in the same ecosystem, an export's name, a call's host (or
 * its host and path, when the target names a path). Null when the two cannot
 * be alike at all (another ecosystem, another protocol).
 */
export function comparedNames(kind: string | undefined, target: string, entry: string): [string, string] | null {
  const colon = (s: string) => s.indexOf(':');
  if (kind === 'package' || kind === 'calls') {
    const [tk, tr] = [target.slice(0, colon(target)), target.slice(colon(target) + 1)];
    const [ek, er] = [entry.slice(0, colon(entry)), entry.slice(colon(entry) + 1)];
    if (colon(target) < 0 || colon(entry) < 0 || tk !== ek) return null;
    // A call target with no path is about a host: compare the entry's host alone.
    if (kind === 'calls' && tk === 'http' && !tr.includes('/')) return [tr, er.split('/')[0]];
    return [tr, er];
  }
  if (kind === 'symbol') {
    const tn = target.slice(target.lastIndexOf('#') + 1);
    const en = entry.slice(entry.lastIndexOf('#') + 1);
    if (!entry.includes('#') || en === '*') return null;
    return [tn, en];
  }
  return [target, entry];
}

/** How alike an entry is to a rule's target, by kind; 0 when they cannot be alike. */
export function fuzzyScore(kind: string | undefined, target: string, entry: string): number {
  const pair = comparedNames(kind, target, entry);
  return pair ? similarity(pair[0], pair[1]) : 0;
}

/** Each word of a line, for a fuzzy grep rule: names, not parts of them. */
export const wordsOf = (line: string): string[] => line.match(/[A-Za-z_$][\w$]*/g) ?? [];
