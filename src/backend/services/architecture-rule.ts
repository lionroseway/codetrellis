/**
 * Phase 32 A7.1 — an architecture rule, read and checked (awareness spec M7).
 *
 * Pure: validating a rule from anyone's text, whether a path is in a pattern,
 * and which import edges cross which rules. Kept apart from the service so
 * the project config can parse rules without importing it back.
 */
import { RULE_STRENGTHS, type ArchitectureRule, type RuleBreach, type RuleStrength } from '../../shared/types/architecture-rules';
import { isPackageEntry, packageMatches, packageProblem } from '../../shared/lib/package-entry';
import { isSymbolEntry, splitSymbol, symbolMatches, symbolProblem } from '../../shared/lib/symbol-entry';
import { callMatches, callProblem, callWords, isCallEntry, normaliseCall } from '../../shared/lib/call-entry';

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
  if (r.kind === 'package') return parsePackageRule(r);
  if (r.kind === 'symbol') return parseSymbolRule(r);
  if (r.kind === 'calls') return parseCallRule(r);
  const problems: string[] = [];
  if (r.kind !== undefined && r.kind !== 'imports') problems.push('kind must be imports, package, symbol or calls');
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
  commonProblems(r, problems);
  if (!fromProblem && !toProblem && normalise(r.from as string) === normalise(r.mayNotImport as string)) problems.push('from and mayNotImport must differ');
  if (problems.length > 0) return { rule: null, problems };
  return {
    rule: {
      id: r.id as string,
      from: normalise(r.from as string),
      mayNotImport: normalise(r.mayNotImport as string),
      except: (except as string[]).map(normalise),
      ...common(r),
    },
    problems: [],
  };
}

/**
 * A package rule (Phase 33 R5): `package` is the outside package, `only` the
 * files that alone may import it, `from` where the rule applies (everywhere
 * when not said), `except` the parts of the package anyone may import.
 */
function parsePackageRule(r: Record<string, unknown>): { rule: ArchitectureRule | null; problems: string[] } {
  const problems: string[] = [];
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) problems.push('id must be a short slug, like stripe-via-wrapper');
  const pkg = r.package ?? r.mayNotImport;
  const pkgProblem = packageProblem(pkg);
  if (pkgProblem) problems.push(pkgProblem);
  const fromProblem = r.from === undefined ? null : patternProblem('from', r.from);
  if (fromProblem) problems.push(fromProblem);
  const only = Array.isArray(r.only) ? r.only : r.only === undefined ? [] : null;
  if (only === null || only.length === 0) problems.push('only must list the files that may import it, like src/payments/index.ts');
  for (const o of only ?? []) {
    const p = patternProblem('only', o);
    if (p) { problems.push(p); break; }
  }
  const except = Array.isArray(r.except) ? r.except : r.except === undefined ? [] : null;
  if (except === null) problems.push('except must be a list of packages, like npm:stripe/types');
  for (const e of except ?? []) {
    const p = packageProblem(e);
    if (p) { problems.push(`except: ${p}`); break; }
  }
  commonProblems(r, problems);
  if (problems.length > 0) return { rule: null, problems };
  return {
    rule: {
      id: r.id as string,
      kind: 'package',
      from: r.from === undefined ? '**' : normalise(r.from as string),
      mayNotImport: (pkg as string).trim(),
      only: (only as string[]).map(normalise),
      except: (except as string[]).map((e) => e.trim()),
      ...common(r),
    },
    problems: [],
  };
}

/**
 * A symbol rule (Phase 33 R6): `symbol` is a file and a name it exports,
 * `only` the files that alone may import it, `from` where the rule applies
 * (everywhere when not said). Importing it through a barrel is importing it.
 */
function parseSymbolRule(r: Record<string, unknown>): { rule: ArchitectureRule | null; problems: string[] } {
  const problems: string[] = [];
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) problems.push('id must be a short slug, like charges-via-payments');
  const sym = r.symbol ?? r.mayNotImport;
  const symProblem = symbolProblem(sym);
  if (symProblem) problems.push(symProblem);
  const fromProblem = r.from === undefined ? null : patternProblem('from', r.from);
  if (fromProblem) problems.push(fromProblem);
  const only = Array.isArray(r.only) ? r.only : r.only === undefined ? [] : null;
  if (only === null || only.length === 0) problems.push('only must list the files that may import it, like src/payments/');
  for (const o of only ?? []) {
    const p = patternProblem('only', o);
    if (p) { problems.push(p); break; }
  }
  if (r.except !== undefined && !(Array.isArray(r.except) && r.except.length === 0)) problems.push('a symbol rule has no except: name the files that may in only');
  commonProblems(r, problems);
  if (problems.length > 0) return { rule: null, problems };
  return {
    rule: {
      id: r.id as string,
      kind: 'symbol',
      from: r.from === undefined ? '**' : normalise(r.from as string),
      mayNotImport: normalise(sym as string),
      only: (only as string[]).map(normalise),
      except: [],
      ...common(r),
    },
    problems: [],
  };
}

/**
 * A call rule (Phase 33 R7): `calls` is an HTTP host or path, or a SQL table;
 * `only` the files that alone may make that call; `from` where the rule
 * applies (everywhere when not said).
 */
function parseCallRule(r: Record<string, unknown>): { rule: ArchitectureRule | null; problems: string[] } {
  const problems: string[] = [];
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) problems.push('id must be a short slug, like stripe-api-via-payments');
  const target = r.calls ?? r.mayNotImport;
  const targetProblem = callProblem(target);
  if (targetProblem) problems.push(targetProblem);
  const fromProblem = r.from === undefined ? null : patternProblem('from', r.from);
  if (fromProblem) problems.push(fromProblem);
  const only = Array.isArray(r.only) ? r.only : r.only === undefined ? [] : null;
  if (only === null || only.length === 0) problems.push('only must list the files that may make the call, like src/payments/');
  for (const o of only ?? []) {
    const p = patternProblem('only', o);
    if (p) { problems.push(p); break; }
  }
  if (r.except !== undefined && !(Array.isArray(r.except) && r.except.length === 0)) problems.push('a call rule has no except: name the files that may in only');
  commonProblems(r, problems);
  if (problems.length > 0) return { rule: null, problems };
  return {
    rule: {
      id: r.id as string,
      kind: 'calls',
      from: r.from === undefined ? '**' : normalise(r.from as string),
      mayNotImport: normaliseCall(target as string),
      only: (only as string[]).map(normalise),
      except: [],
      ...common(r),
    },
    problems: [],
  };
}

function commonProblems(r: Record<string, unknown>, problems: string[]): void {
  if (r.because !== undefined && (typeof r.because !== 'string' || r.because.length > MAX_BECAUSE)) problems.push(`because must be words, at most ${MAX_BECAUSE} characters`);
  if (r.strength !== undefined && !RULE_STRENGTHS.includes(r.strength as RuleStrength)) problems.push('strength must be block, warn or guide');
}

function common(r: Record<string, unknown>): Pick<ArchitectureRule, 'because' | 'since' | 'by' | 'strength'> {
  return {
    because: typeof r.because === 'string' ? r.because.trim() : '',
    since: typeof r.since === 'string' && !Number.isNaN(Date.parse(r.since)) ? r.since : new Date(0).toISOString(),
    by: typeof r.by === 'string' ? r.by : '',
    // Absent: written before strength existed, when every rule blocked (R4).
    strength: (r.strength as RuleStrength | undefined) ?? 'block',
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
  if (rule.kind === 'package') {
    // R5: `to` is a package entry; only the rule's own files may import it.
    if (!isPackageEntry(to) || !packageMatches(rule.mayNotImport, to)) return false;
    if (!inPattern(rule.from, from) || (rule.only ?? []).some((o) => inPattern(o, from))) return false;
    return !rule.except.some((e) => packageMatches(e, to));
  }
  if (rule.kind === 'symbol') {
    // R6: `to` is a symbol entry; only the rule's own files, and the file that
    // defines it, may import it.
    if (!isSymbolEntry(to) || !symbolMatches(rule.mayNotImport, to)) return false;
    if (from === splitSymbol(rule.mayNotImport)!.file) return false;
    return inPattern(rule.from, from) && !(rule.only ?? []).some((o) => inPattern(o, from));
  }
  if (rule.kind === 'calls') {
    // R7: `to` is a call the code makes; only the rule's own files may make it.
    if (!isCallEntry(to) || !callMatches(rule.mayNotImport, to)) return false;
    return inPattern(rule.from, from) && !(rule.only ?? []).some((o) => inPattern(o, from));
  }
  // An outside package, a named export or a call is no file in a folder.
  if (isPackageEntry(to) || isSymbolEntry(to) || isCallEntry(to)) return false;
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

/**
 * What the rule says, in one clause, the same everywhere a rule is named:
 * "web/ may not import db/ (except db/types.ts)", or for a package rule
 * "only src/payments/index.ts may import npm:stripe" ("in src/, only …"
 * when it applies to a folder).
 */
export function ruleStatement(rule: Pick<ArchitectureRule, 'kind' | 'from' | 'mayNotImport' | 'except' | 'only'>): string {
  const except = rule.except.length > 0 ? ` (except ${rule.except.join(', ')})` : '';
  if (rule.kind === 'package') {
    const where = rule.from && rule.from !== '**' ? `in ${rule.from}, ` : '';
    return `${where}only ${(rule.only ?? []).join(', ')} may import ${rule.mayNotImport}${except}`;
  }
  if (rule.kind === 'calls') {
    const where = rule.from && rule.from !== '**' ? `in ${rule.from}, ` : '';
    return `${where}only ${(rule.only ?? []).join(', ')} may ${rule.mayNotImport.startsWith('sql:') ? 'use' : 'call'} ${callWords(rule.mayNotImport)}`;
  }
  if (rule.kind === 'symbol') {
    const where = rule.from && rule.from !== '**' ? `in ${rule.from}, ` : '';
    const sym = splitSymbol(rule.mayNotImport);
    return `${where}only ${(rule.only ?? []).join(', ')} may import ${sym ? `${sym.name} from ${sym.file}` : rule.mayNotImport}`;
  }
  return `${rule.from} may not import ${rule.mayNotImport}${except}`;
}

/** "web/ may not import db/ (except db/types.ts): web talks to db through the API" */
export function ruleWords(rule: ArchitectureRule): string {
  return `${ruleStatement(rule)}${rule.because ? `: ${rule.because}` : ''}`;
}

/** "web/reports.ts imports db/client.ts, which “web-not-db” forbids: web talks to db through the API" */
export function breachWords(rule: ArchitectureRule, b: { from: string; to: string }): string {
  return `${b.from} imports ${b.to}, which the rule “${ruleStatement({ ...rule, except: [] })}” forbids${rule.because ? `: ${rule.because}` : ''}`;
}
