/**
 * Whether a project-relative path is in a rule's pattern (Phase 32 A7.1),
 * for the window: the same answer `inPattern` in
 * `src/backend/services/architecture-rule.ts` gives, which a test holds
 * them to. A pattern ending in `/` is a folder and everything under it; one
 * with `*` is a glob (`*` within a folder name, `**` across folders);
 * anything else is that file, or that folder when the path continues.
 */
import { ecosystemOfPath, packageApplies } from './package-entry';
import { splitSymbol } from './symbol-entry';

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

export function inRulePattern(pattern: string, relPath: string): boolean {
  const p = relPath.replace(/^\.\//, '');
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.split('**').map((part) => part.split('*').map(escape).join('[^/]*')).join('.*') + '$');
    return re.test(p);
  }
  if (pattern.endsWith('/')) return p.startsWith(pattern);
  return p === pattern || p.startsWith(pattern + '/');
}

/** A rule as `ruleCovers` reads it: what it is about, not who set it. */
export interface CoveringRule {
  kind?: string;
  from: string;
  mayNotImport: string;
  only?: string[];
}

/**
 * Whether a rule is about a file (Phase 33 G8, shared since R9): the files it
 * judges and, for an imports rule, the files it guards; for a package rule,
 * the files under it that can import from its ecosystem, and the files that
 * may. The window's overlay, the inspector and the drift signal all ask this.
 */
export function ruleCovers(rule: CoveringRule, file: string): boolean {
  if (rule.kind === 'package') return (inRulePattern(rule.from, file) && packageApplies(rule.mayNotImport, file)) || (rule.only ?? []).some((o) => inRulePattern(o, file));
  // R8: a folder rule is about the files in its folder.
  if (rule.kind === 'folder') return inRulePattern(rule.from, file);
  if (rule.kind === 'calls') {
    // R7: the files under it that can make calls (code), and the files that may.
    return (rule.only ?? []).some((o) => inRulePattern(o, file)) || (inRulePattern(rule.from, file) && ecosystemOfPath(file) !== null);
  }
  if (rule.kind === 'symbol') {
    // R6: the file that defines it, the files that may, and the files under it in the same language.
    const sym = splitSymbol(rule.mayNotImport);
    if (!sym) return false;
    if (file === sym.file || (rule.only ?? []).some((o) => inRulePattern(o, file))) return true;
    const eco = ecosystemOfPath(file);
    return inRulePattern(rule.from, file) && eco !== null && eco === ecosystemOfPath(sym.file);
  }
  return inRulePattern(rule.from, file) || inRulePattern(rule.mayNotImport, file);
}
