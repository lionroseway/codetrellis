/**
 * Whether a project-relative path is in a rule's pattern (Phase 32 A7.1),
 * for the window: the same answer `inPattern` in
 * `src/backend/services/architecture-rule.ts` gives, which a test holds
 * them to. A pattern ending in `/` is a folder and everything under it; one
 * with `*` is a glob (`*` within a folder name, `**` across folders);
 * anything else is that file, or that folder when the path continues.
 */
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
