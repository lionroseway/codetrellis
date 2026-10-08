/**
 * Phase 32 A7.1 — architecture rules (awareness spec M7); Phase 33 R1 — kept
 * as files.
 *
 * A rule lives in a committed suite file, `.codetrellis/rules/<suite>.yaml`
 * (`rulebook.ts`), so every laptop, agent and pipeline reads the same one and
 * a pull request reviews a change to it. Phase 32 kept them in
 * `.codetrellis/config.json`; those still count until a person moves them
 * (`moveRulesFromConfig`), and a suite's rule wins over a config rule with
 * the same id. Setting one is the person's (the route checks); this module
 * validates, keeps and checks them. A breach is an import edge from the
 * resolver's graph, never a text match.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ArchitectureRule, RuleView } from '../../shared/types/architecture-rules';
import { getProjectConfig, updateProjectConfig } from './project-config-service';
import { checkEdges, grepReads, parseArchitectureRule, ruleWords, targetMatches } from './architecture-rule';
import { grepEntries } from '../../shared/lib/grep-entry';
import { readFileWithin, resolveWithin } from './confined-fs';
import { execFileSync } from 'node:child_process';
import { splitSymbol, symbolEntry } from '../../shared/lib/symbol-entry';
import { isSuiteName, readRulebook, suiteFile, writeSuite } from './rulebook';
import { getAllFileHashes, getCallEdges, getFileFacts, getPackageEdges } from './database';
import { exportedSymbols, importersOf } from './importers';

export { breachWords, breaks, checkEdges, grepReads, inPattern, parseArchitectureRule, ruleStatement, ruleWords } from './architecture-rule';

export class RuleError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** The suite new rules go into when none is named. */
export const DEFAULT_SUITE = 'architecture';
const CONFIG_WHERE = '.codetrellis/config.json';

/** Rules still in `.codetrellis/config.json`, where Phase 32 kept them. */
export function rulesInConfig(projectRoot: string): ArchitectureRule[] {
  // Read through the parser again: the config's cache holds a write as it
  // was given, so a rule written before R4 would have no strength here.
  return (getProjectConfig(projectRoot).rules ?? [])
    .map((r) => parseArchitectureRule(r).rule)
    .filter((r): r is ArchitectureRule => r !== null);
}

/** The suites' rules, then any from the config whose id no suite uses. Pure. */
export function combineRules(fromSuites: readonly ArchitectureRule[], fromConfig: readonly ArchitectureRule[]): ArchitectureRule[] {
  const ids = new Set(fromSuites.map((r) => r.id));
  return [...fromSuites, ...fromConfig.filter((r) => !ids.has(r.id))];
}

/** Every rule: the suites', then any still in the config whose id no suite uses. */
export function rulesOf(projectRoot: string): ArchitectureRule[] {
  return combineRules(readRulebook(projectRoot).suites.flatMap((s) => s.rules), rulesInConfig(projectRoot));
}

/** Why a suite file or rule was not read, for the window to say. */
export function rulebookProblems(projectRoot: string): string[] {
  return readRulebook(projectRoot).problems;
}

const whereOf = (rule: ArchitectureRule): string => (rule.suite ? suiteFile(rule.suite) : CONFIG_WHERE);

function suiteRules(projectRoot: string, suite: string): ArchitectureRule[] {
  return readRulebook(projectRoot).suites.find((s) => s.name === suite)?.rules ?? [];
}

/**
 * The rule a set would write, and the one it replaces, without writing
 * anything: what R3's preview compares. Throws `RuleError` as `setRule` would.
 */
export function proposedRule(projectRoot: string, raw: Record<string, unknown>, by: string, now = Date.now()): { rule: ArchitectureRule; existing: ArchitectureRule | null } {
  const existing = rulesOf(projectRoot).find((r) => r.id === raw.id) ?? null;
  const suite = raw.suite === undefined || raw.suite === '' ? existing?.suite ?? DEFAULT_SUITE : raw.suite;
  if (!isSuiteName(suite)) throw new RuleError('suite must be a short name, like payments');
  // A new rule starts at warn (R4): a blocking rule with false positives
  // costs more trust than it earns. A changed rule keeps its strength unless
  // this names one.
  const strength = raw.strength ?? existing?.strength ?? 'warn';
  const { rule: parsed, problems } = parseArchitectureRule({ ...raw, strength, since: existing?.since ?? new Date(now).toISOString(), by });
  if (!parsed) throw new RuleError(problems.join('; '));
  return { rule: { ...parsed, suite }, existing };
}

/** The rule with this id, or null. */
export function findRule(projectRoot: string, id: string): ArchitectureRule | null {
  return rulesOf(projectRoot).find((r) => r.id === id) ?? null;
}

function ruleOf(projectRoot: string, id: string): ArchitectureRule {
  const rule = rulesOf(projectRoot).find((r) => r.id === id);
  if (!rule) throw new RuleError(`No architecture rule "${id}" in this project`, 404);
  return rule;
}

/**
 * Set (or replace) a rule in a suite file, keeping when it was first set. The
 * suite is the one named, else the one already holding the rule, else
 * `architecture`. A rule moving suites leaves its old one; a rule still in
 * the config is taken out of it, since it now lives in a file.
 */
export function setRule(projectRoot: string, raw: Record<string, unknown>, by: string, now = Date.now()): ArchitectureRule {
  const { rule, existing } = proposedRule(projectRoot, raw, by, now);
  const suite = rule.suite!;
  writeSuite(projectRoot, suite, suiteRules(projectRoot, suite).filter((r) => r.id !== rule.id).concat(rule));
  if (existing?.suite && existing.suite !== suite) {
    writeSuite(projectRoot, existing.suite, suiteRules(projectRoot, existing.suite).filter((r) => r.id !== rule.id));
  }
  if (rulesInConfig(projectRoot).some((r) => r.id === rule.id)) {
    updateProjectConfig(projectRoot, { rules: rulesInConfig(projectRoot).filter((r) => r.id !== rule.id) });
  }
  return rule;
}

/** Stop a rule: out of its suite file, or out of the config if it is still there. */
export function removeRule(projectRoot: string, id: string): void {
  const rule = ruleOf(projectRoot, id);
  if (rule.suite) writeSuite(projectRoot, rule.suite, suiteRules(projectRoot, rule.suite).filter((r) => r.id !== id));
  if (rulesInConfig(projectRoot).some((r) => r.id === id)) {
    updateProjectConfig(projectRoot, { rules: rulesInConfig(projectRoot).filter((r) => r.id !== id) });
  }
}

/**
 * Move every rule still in `.codetrellis/config.json` into the `architecture`
 * suite file (Phase 33 R1). A person's confirmed act, never automatic: the
 * route checks. A rule whose id a suite already uses stays as the suite has
 * it. Returns the ids moved.
 */
export function moveRulesFromConfig(projectRoot: string): string[] {
  const inConfig = rulesInConfig(projectRoot);
  if (inConfig.length === 0) return [];
  const taken = new Set(readRulebook(projectRoot).suites.flatMap((s) => s.rules.map((r) => r.id)));
  const moving = inConfig.filter((r) => !taken.has(r.id)).map((r) => ({ ...r, suite: DEFAULT_SUITE }));
  if (moving.length) writeSuite(projectRoot, DEFAULT_SUITE, [...suiteRules(projectRoot, DEFAULT_SUITE), ...moving]);
  updateProjectConfig(projectRoot, { rules: [] });
  return moving.map((r) => r.id);
}

/**
 * The rules, each with the imports that break it now. `edges` is the
 * project's import graph, project-relative, or null when the graph loaded is
 * another project's (it is said, not guessed).
 */
export function rulesView(projectRoot: string, edges: Array<{ from: string; to: string }> | null): RuleView[] {
  return rulesOf(projectRoot).map((rule) => {
    // A guide is read, not checked (R4): it has no breaches to count.
    const breaches = edges && rule.strength !== 'guide' && rule.kind !== 'agent' ? checkEdges([rule], edges) : null;
    return {
      rule,
      where: whereOf(rule),
      words: ruleWords(rule),
      breaches,
      breachWords: rule.strength === 'guide'
        ? 'A guide: shown to agents whose work touches it, never checked'
        : rule.kind === 'agent'
        ? 'Judged by an agent review, against its words: no code checks it, and with no review it is a guide'
        : breaches === null
        ? 'Open this project to see what breaks it today'
        : breaches.length === 0 ? 'Nothing breaks this today' : `${breaches.length} ${breakers(rule, breaches.length)} this today`,
    };
  });
}

/** What breaks a rule, counted: imports, or for a grep rule (B2) lines, or files that lack its text. */
function breakers(rule: ArchitectureRule, n: number): string {
  const [one, many] = rule.kind === 'grep' ? (rule.must ? ['file breaks', 'files break'] : ['line breaks', 'lines break']) : ['import breaks', 'imports break'];
  return n === 1 ? one : many;
}

/**
 * The project's import graph, project-relative, when the graph loaded is
 * this project's; null otherwise. The backend holds one project's graph at a
 * time (the last scanned), so another project's rules cannot be checked
 * against it without saying so.
 */
export function edgesIfLoaded(
  projectRoot: string,
  loadedRoot: string | null,
  edges: () => Array<{ sourceRelative: string; targetRelative: string }>,
  packages: () => Array<{ sourceRelative: string; targetRelative: string }> = packageEdgesOfGraph,
  /** Rules beyond the project's own whose symbols to look up: a preview's, or the base's (R6). */
  alsoRules: readonly ArchitectureRule[] = [],
): Array<{ from: string; to: string }> | null {
  if (!loadedRoot) return null;
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  if (real(loadedRoot) !== real(projectRoot)) return null;
  // Files importing files, then files importing outside packages (R5), which
  // only package rules read, then the named exports symbol rules name (R6).
  const rules = [...rulesOf(projectRoot), ...alsoRules];
  return [...edges(), ...packages(), ...symbolEdgesOfGraph(projectRoot, rules), ...callEdgesOfGraph(rules), ...fileFactsOfGraph(rules), ...grepEdgesOfTree(projectRoot, rules)]
    .map((e) => ({ from: e.sourceRelative, to: e.targetRelative }));
}

const MAX_GREP_FILES = 20_000;
const MAX_GREP_BYTES = 1024 * 1024;

/**
 * What grep rules (B2) read in the tree: every file git knows (tracked, and
 * untracked but not ignored), else every scanned file, that a grep rule's
 * `in` covers, read through the confined-file helper, up to 1 MB each.
 */
function grepEdgesOfTree(projectRoot: string, rules: readonly ArchitectureRule[]): Array<{ sourceRelative: string; targetRelative: string }> {
  const grep = rules.filter((r) => r.kind === 'grep' && r.strength !== 'guide');
  if (grep.length === 0) return [];
  let files: string[];
  try {
    files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean);
  } catch {
    files = [...getAllFileHashes().keys()].map((abs) => path.relative(projectRoot, abs).split(path.sep).join('/')).filter((rel) => !rel.startsWith('..'));
  }
  const out: Array<{ sourceRelative: string; targetRelative: string }> = [];
  for (const rel of [...new Set(files)].slice(0, MAX_GREP_FILES)) {
    const reading = grep.filter((r) => grepReads(r, rel));
    if (reading.length === 0) continue;
    let text: string;
    try {
      if (fs.statSync(resolveWithin(projectRoot, rel)).size > MAX_GREP_BYTES) continue;
      text = readFileWithin(projectRoot, rel).toString('utf-8');
    } catch { continue; }
    for (const rule of reading) for (const e of grepEntries(rule, text)) out.push({ sourceRelative: rel, targetRelative: e });
  }
  return out;
}

/** Each scanned file's own fact (R8), when a folder rule would read them. */
function fileFactsOfGraph(rules: readonly ArchitectureRule[]): Array<{ sourceRelative: string; targetRelative: string }> {
  if (!rules.some((r) => r.kind === 'folder')) return [];
  try {
    return getFileFacts();
  } catch {
    return [];
  }
}

/** The calls the scanned code makes (R7), when a call rule would read them. */
function callEdgesOfGraph(rules: readonly ArchitectureRule[]): Array<{ sourceRelative: string; targetRelative: string }> {
  if (!rules.some((r) => r.kind === 'calls')) return [];
  try {
    return getCallEdges();
  } catch {
    return [];
  }
}

/**
 * The files that import each symbol a symbol rule names (R6), directly, as a
 * namespace, or through barrels, from the scanned graph. Only the symbols
 * rules name are looked up.
 */
function symbolEdgesOfGraph(projectRoot: string, rules: readonly ArchitectureRule[]): Array<{ sourceRelative: string; targetRelative: string }> {
  const out: Array<{ sourceRelative: string; targetRelative: string }> = [];
  const done = new Set<string>();
  for (const rule of rules) {
    if (rule.kind !== 'symbol' || done.has(`${rule.match ?? ''}:${rule.mayNotImport}`)) continue;
    done.add(`${rule.match ?? ''}:${rule.mayNotImport}`);
    if (rule.match) { out.push(...matchedSymbolEdges(rule)); continue; }
    const sym = splitSymbol(rule.mayNotImport);
    if (!sym) continue;
    try {
      for (const i of importersOf(path.join(projectRoot, sym.file), [sym.name])) out.push({ sourceRelative: i.relativePath, targetRelative: rule.mayNotImport });
    } catch { /* no scan yet, or no database */ }
  }
  return out;
}

/**
 * A glob or regex symbol rule's importers (B1): the exported names it covers,
 * found among every file's exports, and who imports each, as an exact rule's
 * are found.
 */
function matchedSymbolEdges(rule: ArchitectureRule): Array<{ sourceRelative: string; targetRelative: string }> {
  const out: Array<{ sourceRelative: string; targetRelative: string }> = [];
  try {
    const byFile = new Map<string, { rel: string; names: string[] }>();
    for (const s of exportedSymbols()) {
      if (!targetMatches(rule, symbolEntry(s.rel, s.name))) continue;
      const f = byFile.get(s.path) ?? { rel: s.rel, names: [] };
      f.names.push(s.name);
      byFile.set(s.path, f);
    }
    for (const [abs, f] of byFile) {
      for (const i of importersOf(abs, f.names)) {
        for (const name of i.names.filter((n) => f.names.includes(n))) out.push({ sourceRelative: i.relativePath, targetRelative: symbolEntry(f.rel, name) });
      }
    }
  } catch { /* no scan yet, or no database */ }
  return out;
}

function packageEdgesOfGraph(): Array<{ sourceRelative: string; targetRelative: string }> {
  try {
    return getPackageEdges();
  } catch {
    return [];
  }
}
