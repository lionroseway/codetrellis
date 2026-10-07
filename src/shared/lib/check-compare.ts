/**
 * Phase 33 G9 — two check runs compared: what is new in the later one, what
 * it fixed, and what stayed. A rule finding is the same finding when the
 * rule, the file and what it imports are; any other line (a breakpoint, a
 * test, a task) when its words are. Pure.
 */

export interface ComparedFinding { rule: string; path: string; imports: string; strength: string; failing: boolean; words: string; fix: string | null }
export interface ComparableRun { at: number; findings: ComparedFinding[]; says: string[] }

export interface RunComparison {
  added: ComparedFinding[];
  fixed: ComparedFinding[];
  unchanged: ComparedFinding[];
  /** Lines that are not a rule's finding, new and gone. */
  saysAdded: string[];
  saysGone: string[];
  /** "2 new · 1 fixed · 3 unchanged" */
  words: string;
}

const key = (f: ComparedFinding) => `${f.rule}\0${f.path}\0${f.imports}`;

/** The later run against the earlier, whichever order they are given in. */
export function compareRuns(a: ComparableRun, b: ComparableRun): RunComparison {
  const [before, after] = a.at <= b.at ? [a, b] : [b, a];
  const was = new Map(before.findings.map((f) => [key(f), f]));
  const now = new Map(after.findings.map((f) => [key(f), f]));
  const added = after.findings.filter((f) => !was.has(key(f)));
  const fixed = before.findings.filter((f) => !now.has(key(f)));
  const unchanged = after.findings.filter((f) => was.has(key(f)));
  // A rule's failing line is said in `says` too; the rest are compared by their words.
  const ruleLine = (s: string) => / now imports .*, which the rule “/.test(s);
  const saysBefore = new Set(before.says.filter((s) => !ruleLine(s)));
  const saysAfter = new Set(after.says.filter((s) => !ruleLine(s)));
  const saysAdded = [...saysAfter].filter((s) => !saysBefore.has(s));
  const saysGone = [...saysBefore].filter((s) => !saysAfter.has(s));
  const words = [`${added.length + saysAdded.length} new`, `${fixed.length + saysGone.length} fixed`, `${unchanged.length} unchanged`].join(' · ');
  return { added, fixed, unchanged, saysAdded, saysGone, words };
}
