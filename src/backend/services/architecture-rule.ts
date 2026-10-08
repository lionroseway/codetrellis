/**
 * Phase 32 A7.1 — an architecture rule, read and checked (awareness spec M7).
 *
 * Pure: validating a rule from anyone's text, whether a path is in a pattern,
 * and which import edges cross which rules. Kept apart from the service so
 * the project config can parse rules without importing it back.
 */
import { RULE_ENGINES, RULE_STRENGTHS, type ArchitectureRule, type RuleBreach, type RuleEngine, type RuleStrength } from '../../shared/types/architecture-rules';
import { isPackageEntry, packageMatches, packageProblem } from '../../shared/lib/package-entry';
import { isSymbolEntry, splitSymbol, symbolMatches, symbolProblem } from '../../shared/lib/symbol-entry';
import { callMatches, callProblem, callWords, isCallEntry, normaliseCall } from '../../shared/lib/call-entry';
import { folderProblem, folderWords, isFileFact } from '../../shared/lib/folder-entry';
import { matcherOf, regexProblem, splitTarget, thresholdProblem, underPattern, wholly, type TargetMatch } from '../../shared/lib/matcher';
import { DEFAULT_THRESHOLD, comparedNames, fuzzyScore, scoreWords } from '../../shared/lib/fuzzy';
import { grepKey, grepPatternWords, grepWords, isGrepEntry, splitGrep } from '../../shared/lib/grep-entry';

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
  // B5: who judges it. An agent's rule is words; the others' engine follows from how they match.
  if (r.engine !== undefined && !RULE_ENGINES.includes(r.engine as RuleEngine)) return { rule: null, problems: ['engine must be deterministic, fuzzy or agent'] };
  if (r.engine === 'agent' || r.kind === 'agent') return parseAgentRule(r);
  const parsed = parseByKind(r);
  if (parsed.rule && r.engine !== undefined && ruleEngine(parsed.rule) !== r.engine) {
    return { rule: null, problems: [r.engine === 'fuzzy' ? 'engine fuzzy is a rule whose target says match: fuzzy' : `this rule's engine is ${ruleEngine(parsed.rule)}, not ${String(r.engine)}`] };
  }
  return parsed;
}

/** Who judges a rule (B5): an agent, code by likeness, or code. */
export function ruleEngine(rule: Pick<ArchitectureRule, 'kind' | 'match'>): RuleEngine {
  return rule.kind === 'agent' ? 'agent' : rule.match === 'fuzzy' ? 'fuzzy' : 'deterministic';
}

const MAX_WORDS = 1000;

/**
 * An agent rule (Phase 33 B5): `rule`, the words an agent review judges a
 * change by, and `in`, the files it is about. No code checks it. Sent to a
 * review in its bundle, a finding that cites it is held to the contract like
 * any (it quotes the diff; the rule is in scope); it blocks only at `block`.
 * With no review run, it is a guide: shown where it applies, checked nowhere.
 */
function parseAgentRule(r: Record<string, unknown>): { rule: ArchitectureRule | null; problems: string[] } {
  const problems: string[] = [];
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) problems.push('id must be a short slug, like money-through-ledger');
  if (r.kind !== undefined && r.kind !== 'agent') problems.push('an agent rule has no kind: it is its words');
  const words = r.rule ?? r.mayNotImport;
  if (typeof words !== 'string' || !words.trim()) problems.push('rule must be the words an agent judges by, like: Code that moves money records it through services/ledger.');
  else if (words.length > MAX_WORDS) problems.push(`rule is at most ${MAX_WORDS} characters`);
  const list = (v: unknown): string[] | null => (v === undefined ? [] : typeof v === 'string' ? [v] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : null);
  const within = list(r.in);
  if (within === null || within.length === 0) problems.push('in must list the files it is about, like src/');
  for (const w of within ?? []) {
    const p = patternProblem('in', w);
    if (p) { problems.push(p); break; }
  }
  const except = list(r.except);
  if (except === null) problems.push('except must be a list of files or patterns');
  for (const e of except ?? []) {
    const p = patternProblem('except', e);
    if (p) { problems.push(p); break; }
  }
  commonProblems(r, problems);
  if (problems.length > 0) return { rule: null, problems };
  return {
    rule: {
      id: r.id as string,
      kind: 'agent',
      from: '**',
      mayNotImport: (words as string).trim(),
      in: within!.map(normalise),
      except: except!.map(normalise),
      ...common(r),
    },
    problems: [],
  };
}

function parseByKind(r: Record<string, unknown>): { rule: ArchitectureRule | null; problems: string[] } {
  if (r.kind === 'package') return parsePackageRule(r);
  if (r.kind === 'symbol') return parseSymbolRule(r);
  if (r.kind === 'calls') return parseCallRule(r);
  if (r.kind === 'folder') return parseFolderRule(r);
  if (r.kind === 'grep') return parseGrepRule(r);
  const problems: string[] = [];
  if (r.kind !== undefined && r.kind !== 'imports') problems.push('kind must be imports, package, symbol, calls, folder or grep (or engine: agent)');
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
  const { value: pkg, match: m, threshold: t } = splitTarget(r.package ?? r.mayNotImport);
  const match = targetProblem(problems, pkg, m ?? r.match, packageProblem, /^[a-z]+:/, 'package', 'npm:@aws-sdk/*');
  const threshold = thresholdOf(problems, match, t ?? r.threshold);
  const fromProblem = r.from === undefined ? null : patternProblem('from', r.from);
  if (fromProblem) problems.push(fromProblem);
  const only = Array.isArray(r.only) ? r.only : r.only === undefined ? [] : null;
  if (only === null || (only.length === 0 && match !== 'fuzzy')) problems.push('only must list the files that may import it, like src/payments/index.ts');
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
      ...(match ? { match } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
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
  const { value: sym, match: m, threshold: t } = splitTarget(r.symbol ?? r.mayNotImport);
  const match = targetProblem(problems, sym, m ?? r.match, symbolProblem, /#/, 'symbol', 'src/db.ts#raw*');
  const threshold = thresholdOf(problems, match, t ?? r.threshold);
  // A glob is still a file and a name, relative and inside the project.
  if (match === 'glob') { const p = symbolProblem((sym as string).replace(/\*/g, 'x')); if (p) problems.push(p); }
  const fromProblem = r.from === undefined ? null : patternProblem('from', r.from);
  if (fromProblem) problems.push(fromProblem);
  const only = Array.isArray(r.only) ? r.only : r.only === undefined ? [] : null;
  if (only === null || (only.length === 0 && match !== 'fuzzy')) problems.push('only must list the files that may import it, like src/payments/');
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
      ...(match ? { match } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
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
  const { value: target, match: m, threshold: t } = splitTarget(r.calls ?? r.mayNotImport);
  const match = targetProblem(problems, target, m ?? r.match, callProblem, /^[a-z][a-z0-9-]*:/, 'calls', 'http:*.stripe.com');
  const threshold = thresholdOf(problems, match, t ?? r.threshold);
  const fromProblem = r.from === undefined ? null : patternProblem('from', r.from);
  if (fromProblem) problems.push(fromProblem);
  const only = Array.isArray(r.only) ? r.only : r.only === undefined ? [] : null;
  if (only === null || (only.length === 0 && match !== 'fuzzy')) problems.push('only must list the files that may make the call, like src/payments/');
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
      mayNotImport: match && match !== 'fuzzy' ? (target as string).trim() : normaliseCall(target as string),
      ...(match ? { match } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
      only: (only as string[]).map(normalise),
      except: [],
      ...common(r),
    },
    problems: [],
  };
}

const MAX_GUIDE = 1000;

/**
 * A folder rule (Phase 33 R8): `folder` and what its files are: named to
 * `files` (a pattern or a list), of `kinds` (extensions), and `exports: one`.
 * `guide` is the judgement half, in prose, never checked; at `guide` strength
 * it may stand alone (C6: what agent reviews keep finding, graduated).
 */
function parseFolderRule(r: Record<string, unknown>): { rule: ArchitectureRule | null; problems: string[] } {
  const problems: string[] = [];
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) problems.push('id must be a short slug, like services-are-services');
  const folder = r.folder ?? r.from;
  const folderProblemWords = patternProblem('folder', folder);
  if (folderProblemWords) problems.push(folderProblemWords);
  const list = (v: unknown): string[] | null => (v === undefined ? [] : typeof v === 'string' ? [v] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : null);
  const files = list(r.files);
  if (files === null || files.some((f) => !f.trim() || f.includes('/'))) problems.push('files must be name patterns, like *-service.ts');
  const kinds = list(r.kinds);
  if (kinds === null || kinds.some((k) => !/^[a-z0-9]+$/i.test(k.replace(/^\./, '')))) problems.push('kinds must be file extensions, like ts');
  if (r.exports !== undefined && r.exports !== 'one') problems.push('exports may only be one');
  // C6: a guide alone is a rule too, at guide strength: the judgement half, shown where it applies and never checked.
  const guideOnly = r.strength === 'guide' && typeof r.guide === 'string' && r.guide.trim() !== '';
  if (!problems.length && !guideOnly && (files ?? []).length === 0 && (kinds ?? []).length === 0 && r.exports === undefined) problems.push('a folder rule says what its files are: files, kinds or exports (or, at guide strength, only a guide)');
  if (r.guide !== undefined && (typeof r.guide !== 'string' || r.guide.length > MAX_GUIDE)) problems.push(`guide must be words, at most ${MAX_GUIDE} characters`);
  commonProblems(r, problems);
  if (problems.length > 0) return { rule: null, problems };
  return {
    rule: {
      id: r.id as string,
      kind: 'folder',
      from: normalise(folder as string),
      mayNotImport: '',
      ...(files!.length ? { files: files!.map((f) => f.trim()) } : {}),
      ...(kinds!.length ? { kinds: kinds!.map((k) => k.replace(/^\./, '').toLowerCase()) } : {}),
      ...(r.exports === 'one' ? { exports: 'one' as const } : {}),
      ...(typeof r.guide === 'string' && r.guide.trim() ? { guide: r.guide.trim() } : {}),
      except: [],
      ...common(r),
    },
    problems: [],
  };
}

const MAX_GREP = 200;

/**
 * A grep rule (Phase 33 B2): the files `in` (a pattern or a list) less
 * `except`, and `mustNot` the text no line of theirs may hold, or `must` the
 * text one line of each must. The text is literal, or `{ match: glob | regex,
 * value }` (or `match:` beside it); a `*` in literal text is a `*`, since code
 * is full of them. `ignoreCase: true` reads it in any case.
 */
function parseGrepRule(r: Record<string, unknown>): { rule: ArchitectureRule | null; problems: string[] } {
  const problems: string[] = [];
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) problems.push('id must be a short slug, like no-console-in-backend');
  const list = (v: unknown): string[] | null => (v === undefined ? [] : typeof v === 'string' ? [v] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : null);
  const within = list(r.in);
  if (within === null || within.length === 0) problems.push('in must list the files it reads, like src/backend/');
  for (const w of within ?? []) {
    const p = patternProblem('in', w);
    if (p) { problems.push(p); break; }
  }
  const except = list(r.except);
  if (except === null) problems.push('except must be a list of files or patterns');
  for (const e of except ?? []) {
    const p = patternProblem('except', e);
    if (p) { problems.push(p); break; }
  }
  const must = r.must !== undefined;
  if (must === (r.mustNot !== undefined)) problems.push('a grep rule says mustNot (text no line may hold) or must (text one line must), not both');
  const { value, match: m, threshold: t } = splitTarget(must ? r.must : r.mustNot);
  const written = m ?? r.match;
  const match: TargetMatch | null = written === undefined || written === null || written === 'exact' ? null : written === 'glob' || written === 'regex' || written === 'fuzzy' ? written : null;
  if (written !== undefined && written !== null && written !== 'exact' && match === null) problems.push('match must be exact, glob, regex or fuzzy');
  // B3: a word like the text. A file can only be required to hold the text itself.
  if (match === 'fuzzy' && must) problems.push('a must rule needs its text, not one like it: fuzzy is for mustNot');
  if (match === 'fuzzy' && typeof value === 'string' && !/^[A-Za-z_$][\w$]*$/.test(value.trim())) problems.push('a fuzzy grep rule looks for a word like one name, like requireAuth');
  const threshold = thresholdOf(problems, match, t ?? r.threshold);
  if (typeof value !== 'string' || value.trim() === '') problems.push(`${must ? 'must' : 'mustNot'} must be the text to look for, like console.log(`);
  else if (value.length > MAX_GREP) problems.push(`the text is at most ${MAX_GREP} characters`);
  else if (match === 'regex') { const p = regexProblem(value.trim()); if (p) problems.push(p); }
  if (r.ignoreCase !== undefined && typeof r.ignoreCase !== 'boolean') problems.push('ignoreCase is true or false');
  if (r.only !== undefined) problems.push('a grep rule has no only: say in which files it reads');
  commonProblems(r, problems);
  if (problems.length > 0) return { rule: null, problems };
  return {
    rule: {
      id: r.id as string,
      kind: 'grep',
      from: '**',
      mayNotImport: (value as string).trim(),
      ...(match ? { match } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
      in: within!.map(normalise),
      ...(must ? { must: true } : {}),
      ...(r.ignoreCase === true ? { ignoreCase: true } : {}),
      except: except!.map(normalise),
      ...common(r),
    },
    problems: [],
  };
}

/** Whether a grep rule reads this file: in one of its `in`, and in none of its `except`. */
export function grepReads(rule: Pick<ArchitectureRule, 'in' | 'except'>, relPath: string): boolean {
  return (rule.in ?? []).some((p) => inPattern(p, relPath)) && !rule.except.some((e) => inPattern(e, relPath));
}

/**
 * A package, symbol or call target, exact or by a matcher (B1): the matcher
 * it is written with, after adding to `problems` what is wrong with it. An
 * exact target is held to its kind's own shape; a glob or a regex to the
 * prefix the kind's entries start with, and a regex to what cannot run away.
 */
function targetProblem(problems: string[], value: unknown, match: unknown, exact: (v: unknown) => string | null, prefix: RegExp, name: string, example: string): TargetMatch | null {
  if (typeof value !== 'string' || !value.trim()) { problems.push(exact(value) ?? `${name} must be written`); return null; }
  const kind = matcherOf(match, value.trim());
  if (kind === 'bad') { problems.push('match must be exact, glob, regex or fuzzy'); return null; }
  if (kind === null) { const p = exact(value); if (p) problems.push(p); return null; }
  // B3: a look-alike is of a real name, written exactly.
  if (kind === 'fuzzy') { const p = exact(value); if (p) { problems.push(p); return null; } return kind; }
  if (!prefix.test(value.trim())) { problems.push(`a ${kind} ${name} starts the way its entries do, like ${example}`); return null; }
  const p = kind === 'regex' ? regexProblem(value.trim()) : value.length > 200 ? 'a glob is at most 200 characters' : null;
  if (p) { problems.push(p); return null; }
  return kind;
}

/** A fuzzy target's threshold (B3): what it says, else 0.85; none for any other matcher. */
function thresholdOf(problems: string[], match: TargetMatch | null, t: unknown): number | undefined {
  if (match !== 'fuzzy') {
    if (t !== undefined) problems.push('threshold is only for match: fuzzy');
    return undefined;
  }
  if (t === undefined) return DEFAULT_THRESHOLD;
  const p = thresholdProblem(t);
  if (p) problems.push(p);
  return p ? undefined : t as number;
}

/**
 * What to do about a look-alike (B3), with how alike it is: “npm:reqeusts is
 * 0.88 like npm:requests: did you mean it?”. Null when the rule is not fuzzy.
 */
export function lookAlikeFix(rule: ArchitectureRule, entry: string): string | null {
  const score = lookAlike(rule, entry);
  if (score === null) return null;
  // A package or a call is said whole (npm:reqeusts); an export by its name.
  const [want, got] = rule.kind === 'symbol' ? comparedNames(rule.kind, rule.mayNotImport, entry)! : [rule.mayNotImport, entry];
  return `${got} is ${scoreWords(score)} like ${want}: did you mean it?`;
}

/** Whether the exact target names this entry, as the rule would without a matcher. */
function exactly(kind: ArchitectureRule['kind'], target: string, entry: string): boolean {
  if (kind === 'package') return packageMatches(target, entry);
  if (kind === 'symbol') return symbolMatches(target, entry);
  if (kind === 'calls') return callMatches(target, entry);
  return target === entry;
}

/**
 * How alike an entry is to a fuzzy rule's target (B3), or null when the rule
 * is not fuzzy, the entry is the target itself, or the two cannot be alike.
 */
export function lookAlike(rule: Pick<ArchitectureRule, 'kind' | 'mayNotImport' | 'match' | 'threshold'>, entry: string): number | null {
  if (rule.match !== 'fuzzy' || exactly(rule.kind, rule.mayNotImport, entry) || !comparedNames(rule.kind, rule.mayNotImport, entry)) return null;
  const score = fuzzyScore(rule.kind, rule.mayNotImport, entry);
  return score >= (rule.threshold ?? DEFAULT_THRESHOLD) ? score : null;
}

/** Whether a rule's package, symbol or call target is this entry: exactly, or by its matcher (B1, B3). */
export function targetMatches(rule: Pick<ArchitectureRule, 'kind' | 'mayNotImport' | 'match' | 'threshold'>, entry: string): boolean {
  if (rule.match === 'fuzzy') return lookAlike(rule, entry) !== null;
  const m = rule.match;
  if (rule.kind === 'package') return m ? underPattern(m, rule.mayNotImport, entry) : packageMatches(rule.mayNotImport, entry);
  if (rule.kind === 'symbol') {
    if (!m) return symbolMatches(rule.mayNotImport, entry);
    const got = splitSymbol(entry);
    if (!got) return false;
    // A namespace import takes the whole module: it matches when the file does.
    if (got.name === '*') {
      const at = rule.mayNotImport.lastIndexOf('#');
      return at > 0 && wholly(m, rule.mayNotImport.slice(0, at), got.file);
    }
    return wholly(m, rule.mayNotImport, entry);
  }
  if (rule.kind === 'calls') {
    if (!m) return callMatches(rule.mayNotImport, entry);
    if (m === 'regex') return wholly('regex', rule.mayNotImport, entry);
    // A glob keeps a call rule's shape: a host, then a path everything under which it covers.
    const [rk, rr] = [rule.mayNotImport.slice(0, rule.mayNotImport.indexOf(':')), rule.mayNotImport.slice(rule.mayNotImport.indexOf(':') + 1)];
    const [ek, er] = [entry.slice(0, entry.indexOf(':')), entry.slice(entry.indexOf(':') + 1)];
    if (rk !== ek) return false;
    if (rk === 'sql') return wholly('glob', rr.toLowerCase(), er.toLowerCase());
    // B4: a team's own kind is one name, which the glob covers whole: queue:orders.*.
    if (rk !== 'http') return wholly('glob', rr, er);
    const split = (x: string) => { const i = x.indexOf('/'); return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i)]; };
    const [rh, rp] = split(rr);
    const [eh, ep] = split(er);
    if (rh !== '' && !wholly('glob', rh.toLowerCase(), eh.toLowerCase())) return false;
    return rp === '' || underPattern('glob', rp, ep);
  }
  return false;
}

function commonProblems(r: Record<string, unknown>, problems: string[]): void {
  if (r.because !== undefined && (typeof r.because !== 'string' || r.because.length > MAX_BECAUSE)) problems.push(`because must be words, at most ${MAX_BECAUSE} characters`);
  if (r.strength !== undefined && !RULE_STRENGTHS.includes(r.strength as RuleStrength)) problems.push('strength must be block, warn or guide');
  if (r.tags !== undefined && tagsOf(r.tags) === null) problems.push(`tags are short slugs, like pci, at most ${MAX_TAGS}`);
}

const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_TAGS = 10;
/** A rule's tags, sorted and once each; null when they are not a list of short slugs. */
export function tagsOf(v: unknown): string[] | null {
  const xs = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(xs) || xs.length > MAX_TAGS || !xs.every((x) => typeof x === 'string' && TAG_RE.test(x.trim()))) return null;
  return [...new Set(xs.map((x: string) => x.trim()))].sort();
}

function common(r: Record<string, unknown>): Pick<ArchitectureRule, 'because' | 'since' | 'by' | 'strength' | 'tags'> {
  const tags = r.tags === undefined ? null : tagsOf(r.tags);
  return {
    ...(tags?.length ? { tags } : {}),
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
  // B5: an agent rule is judged by a review, never by an edge.
  if (rule.kind === 'agent') return false;
  if (rule.kind === 'grep') {
    // B2: `to` is a line the file holds, or a pattern it never does, keyed by the rule's terms.
    return splitGrep(to)?.key === grepKey(rule) && grepReads(rule, from);
  }
  if (rule.kind === 'package') {
    // R5: `to` is a package entry; only the rule's own files may import it.
    if (!isPackageEntry(to) || !targetMatches(rule, to)) return false;
    if (!inPattern(rule.from, from) || (rule.only ?? []).some((o) => inPattern(o, from))) return false;
    return !rule.except.some((e) => packageMatches(e, to));
  }
  if (rule.kind === 'symbol') {
    // R6: `to` is a symbol entry; only the rule's own files, and the file that
    // defines it, may import it.
    if (!isSymbolEntry(to) || !targetMatches(rule, to)) return false;
    if (from === splitSymbol(to)!.file) return false;
    return inPattern(rule.from, from) && !(rule.only ?? []).some((o) => inPattern(o, from));
  }
  if (rule.kind === 'folder') {
    // R8: `to` is a file's own fact; the rule judges the files in its folder.
    return isFileFact(to) && inPattern(rule.from, from) && folderProblem(rule, to) !== null;
  }
  if (rule.kind === 'calls') {
    // R7: `to` is a call the code makes; only the rule's own files may make it.
    if (!isCallEntry(to) || !targetMatches(rule, to)) return false;
    return inPattern(rule.from, from) && !(rule.only ?? []).some((o) => inPattern(o, from));
  }
  // An outside package, a named export, a call or a file's fact is no file in a folder.
  if (isPackageEntry(to) || isSymbolEntry(to) || isCallEntry(to) || isFileFact(to) || isGrepEntry(to)) return false;
  if (!inPattern(rule.from, from) || inPattern(rule.mayNotImport, from)) return false;
  if (!inPattern(rule.mayNotImport, to)) return false;
  return !rule.except.some((e) => inPattern(e, to));
}

/** Which of these edges cross which of the project's rules. A `guide` rule checks nothing (R4). */
export function checkEdges(rules: ArchitectureRule[], edges: Array<{ from: string; to: string }>): RuleBreach[] {
  const out: RuleBreach[] = [];
  for (const rule of rules) {
    if (rule.strength === 'guide') continue;
    for (const e of edges) {
      if (!breaks(rule, e.from, e.to)) continue;
      // R8: a folder rule's breach says what is wrong with the file.
      out.push({ rule: rule.id, from: e.from, to: rule.kind === 'folder' ? `folder:${folderProblem(rule, e.to)}` : e.to });
    }
  }
  return out;
}

/**
 * What the rule says, in one clause, the same everywhere a rule is named:
 * "web/ may not import db/ (except db/types.ts)", or for a package rule
 * "only src/payments/index.ts may import npm:stripe" ("in src/, only …"
 * when it applies to a folder).
 */
export function ruleStatement(rule: Pick<ArchitectureRule, 'kind' | 'from' | 'mayNotImport' | 'except' | 'only'> & Partial<Pick<ArchitectureRule, 'files' | 'kinds' | 'exports' | 'match' | 'in' | 'must' | 'ignoreCase' | 'threshold'>>): string {
  const except = rule.except.length > 0 ? ` (except ${rule.except.join(', ')})` : '';
  // B5: an agent rule is its words, about its files.
  if (rule.kind === 'agent') return `in ${(rule.in ?? []).join(', ')}${except}: ${rule.mayNotImport}`;
  if (rule.kind === 'grep') {
    // B2: "no file in src/backend/ may contain “console.log(”", "every file in src/routes/*.ts must contain “requireAuth”".
    const files = `${(rule.in ?? []).join(', ')}${except}`;
    return rule.must ? `every file in ${files} must contain ${grepPatternWords(rule)}` : `no file in ${files} may contain ${grepPatternWords(rule)}`;
  }
  // B3: a look-alike, and who alone may use one (nothing, when only is empty).
  if (rule.match === 'fuzzy' && (rule.kind === 'package' || rule.kind === 'calls' || rule.kind === 'symbol')) {
    const where = rule.from && rule.from !== '**' ? `in ${rule.from}, ` : '';
    const who = (rule.only ?? []).length ? `only ${(rule.only ?? []).join(', ')} may` : 'nothing may';
    const sym = rule.kind === 'symbol' ? splitSymbol(rule.mayNotImport) : null;
    const what = rule.kind === 'calls'
      ? `${rule.mayNotImport.startsWith('sql:') ? 'use a table' : 'make a call'} like ${callWords(rule.mayNotImport)}`
      : `import a look-alike of ${sym ? `${sym.name} from ${sym.file}` : rule.mayNotImport}`;
    return `${where}${who} ${what} (${scoreWords(rule.threshold ?? DEFAULT_THRESHOLD)} or closer)${except}`;
  }
  // B1: a regex target is said as one; a glob reads as it is written.
  if (rule.match === 'regex' && (rule.kind === 'package' || rule.kind === 'calls' || rule.kind === 'symbol')) {
    const where = rule.from && rule.from !== '**' ? `in ${rule.from}, ` : '';
    const verb = rule.kind === 'calls' ? 'make a call' : 'import anything';
    return `${where}only ${(rule.only ?? []).join(', ')} may ${verb} matching /${rule.mayNotImport}/${except}`;
  }
  if (rule.kind === 'package') {
    const where = rule.from && rule.from !== '**' ? `in ${rule.from}, ` : '';
    return `${where}only ${(rule.only ?? []).join(', ')} may import ${rule.mayNotImport}${except}`;
  }
  if (rule.kind === 'folder') return folderWords(rule.from, rule);
  if (rule.kind === 'calls') {
    const where = rule.from && rule.from !== '**' ? `in ${rule.from}, ` : '';
    return `${where}only ${(rule.only ?? []).join(', ')} may ${callVerb(rule.mayNotImport)} ${callWords(rule.mayNotImport)}`;
  }
  if (rule.kind === 'symbol') {
    const where = rule.from && rule.from !== '**' ? `in ${rule.from}, ` : '';
    const sym = splitSymbol(rule.mayNotImport);
    return `${where}only ${(rule.only ?? []).join(', ')} may import ${sym ? `${sym.name} from ${sym.file}` : rule.mayNotImport}`;
  }
  return `${rule.from} may not import ${rule.mayNotImport}${except}`;
}

/** What a call rule's files may do to its target: call a host, use a table, run a command, read a variable, or reach a team's own kind (B4). */
function callVerb(target: string): string {
  if (target.startsWith('exec:')) return 'run';
  if (target.startsWith('env:')) return 'read';
  return target.startsWith('sql:') ? 'use' : target.startsWith('http:') ? 'call' : 'reach';
}

/** "web/ may not import db/ (except db/types.ts): web talks to db through the API" */
export function ruleWords(rule: ArchitectureRule): string {
  return `${ruleStatement(rule)}${rule.because ? `: ${rule.because}` : ''}`;
}

/** "web/reports.ts imports db/client.ts, which “web-not-db” forbids: web talks to db through the API" */
export function breachWords(rule: ArchitectureRule, b: { from: string; to: string }): string {
  return `${b.from} ${isGrepEntry(b.to) ? grepWords(b.to) : `imports ${b.to}`}, which the rule “${ruleStatement({ ...rule, except: [] })}” forbids${rule.because ? `: ${rule.because}` : ''}`;
}
