/**
 * Phase 32 A7.1 — an architecture rule, read and checked (awareness spec M7).
 *
 * Pure: validating a rule from anyone's text, whether a path is in a pattern,
 * and which import edges cross which rules. Kept apart from the service so
 * the project config can parse rules without importing it back.
 */
import { RULE_STRENGTHS, type ArchitectureRule, type RuleBreach, type RuleStrength } from '../../shared/types/architecture-rules';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_BECAUSE = 200;

/** A project-relative pattern: no absolute path, no `..`, no backslashes. */
function patternProblem(name: string, v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return `${name} must be a folder or a pattern, like web/`;
  const p = v.trim();
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.includes('\\')) return `${name} must be relative to the project, like web/`;
  if (p.split('/').includes('..')) return `${name} may not climb out of the project`;
  return null;
}

/** Read a rule from anyone's text: the rule, or why not. */
export function parseArchitectureRule(raw: unknown): { rule: ArchitectureRule | null; problems: string[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) problems.push('id must be a short slug, like web-not-db');
  const fromProblem = patternProblem('from', r.from);
  if (fromProblem) problems.push(fromProblem);
  const toProblem = patternProblem('mayNotImport', r.mayNotImport);
  if (toProblem) problems.push(toProblem);
  const except = Array.isArray(r.except) ? r.except : r.except === undefined ? [] : null;
  if (except === null) problems.push('except must be a list of files or patterns');
  for (const e of except ?? []) {
    const p = patternProblem('except', e);
    if (p) { problems.push(p); break; }
  }
  if (r.because !== undefined && (typeof r.because !== 'string' || r.because.length > MAX_BECAUSE)) problems.push(`because must be words, at most ${MAX_BECAUSE} characters`);
  if (r.strength !== undefined && !RULE_STRENGTHS.includes(r.strength as RuleStrength)) problems.push('strength must be block, warn or guide');
  if (!fromProblem && !toProblem && normalise(r.from as string) === normalise(r.mayNotImport as string)) problems.push('from and mayNotImport must differ');
  if (problems.length > 0) return { rule: null, problems };
  return {
    rule: {
      id: r.id as string,
      from: normalise(r.from as string),
      mayNotImport: normalise(r.mayNotImport as string),
      except: (except as string[]).map(normalise),
      because: typeof r.because === 'string' ? r.because.trim() : '',
      since: typeof r.since === 'string' && !Number.isNaN(Date.parse(r.since)) ? r.since : new Date(0).toISOString(),
      by: typeof r.by === 'string' ? r.by : '',
      // Absent: written before strength existed, when every rule blocked (R4).
      strength: (r.strength as RuleStrength | undefined) ?? 'block',
    },
    problems: [],
  };
}

function normalise(p: string): string {
  return p.trim().replace(/^\.\//, '');
}

/**
 * Whether a project-relative path is in a pattern. A pattern ending in `/` is
 * a folder and everything under it; one with `*` is a glob (`*` within a
 * folder name, `**` across folders); anything else is that file, or that
 * folder when the path continues under it.
 */
export function inPattern(pattern: string, relPath: string): boolean {
  const p = relPath.replace(/^\.\//, '');
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.split('**').map((part) => part.split('*').map(escape).join('[^/]*')).join('.*') + '$');
    return re.test(p);
  }
  if (pattern.endsWith('/')) return p.startsWith(pattern);
  return p === pattern || p.startsWith(pattern + '/');
}

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Whether `from` importing `to` crosses this rule. A file already inside the forbidden set is not "from" outside it. */
export function breaks(rule: ArchitectureRule, from: string, to: string): boolean {
  if (!inPattern(rule.from, from) || inPattern(rule.mayNotImport, from)) return false;
  if (!inPattern(rule.mayNotImport, to)) return false;
  return !rule.except.some((e) => inPattern(e, to));
}

/** Which of these edges cross which of the project's rules. A `guide` rule checks nothing (R4). */
export function checkEdges(rules: ArchitectureRule[], edges: Array<{ from: string; to: string }>): RuleBreach[] {
  const out: RuleBreach[] = [];
  for (const rule of rules) {
    if (rule.strength === 'guide') continue;
    for (const e of edges) if (breaks(rule, e.from, e.to)) out.push({ rule: rule.id, from: e.from, to: e.to });
  }
  return out;
}

/** "web/ may not import db/ (except db/types.ts): web talks to db through the API" */
export function ruleWords(rule: ArchitectureRule): string {
  const except = rule.except.length > 0 ? ` (except ${rule.except.join(', ')})` : '';
  return `${rule.from} may not import ${rule.mayNotImport}${except}${rule.because ? `: ${rule.because}` : ''}`;
}

/** "web/reports.ts imports db/client.ts, which “web-not-db” forbids: web talks to db through the API" */
export function breachWords(rule: ArchitectureRule, b: { from: string; to: string }): string {
  return `${b.from} imports ${b.to}, which the rule “${rule.from} may not import ${rule.mayNotImport}” forbids${rule.because ? `: ${rule.because}` : ''}`;
}

