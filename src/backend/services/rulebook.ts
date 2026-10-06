/**
 * Phase 33 R1 — the rulebook: architecture rules as files (design §3.1).
 *
 * The owner, 2026-10-05: rules leave `config.json` and Settings. They live in
 * one YAML file per suite under `.codetrellis/rules/`, so a pull request
 * reviews them, CODEOWNERS can own a suite, and a comment can say why. The
 * database keeps no copy: reading is cheap, and cached by each file's size
 * and modification time.
 *
 *     # .codetrellis/rules/payments.yaml
 *     suite: payments
 *     because: Money moves through one place.
 *     rules:
 *       - id: web-not-payments-db
 *         from: web/
 *         mayNotImport: payments/db/
 *         because: web reads payments through the API
 *
 * Every read and write goes through the confined-file helper (Phase 19): the
 * rules folder is inside the project, and a link placed there is refused,
 * not followed. Writing a suite keeps the file's comments and order.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Document, parseDocument, type Node as YamlNode } from 'yaml';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { parseArchitectureRule } from './architecture-rule';
import { readTextWithin, resolveWithin, writeFileWithin } from './confined-fs';

/** The rules folder, relative to the project root. */
export const RULES_DIR = '.codetrellis/rules';
const SUITE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface Suite {
  /** The file's name without `.yaml`: `payments`. */
  name: string;
  /** Project-relative: `.codetrellis/rules/payments.yaml`. */
  file: string;
  /** Why the suite exists, in the team's words. */
  because: string;
  rules: ArchitectureRule[];
}

export interface Rulebook {
  suites: Suite[];
  /** Why a file or rule was not read, one sentence each, naming the file. */
  problems: string[];
}

/** Names in the rules folder that are not suites: the debt baseline (C3). */
const RESERVED = new Set(['baseline']);

export function isSuiteName(name: unknown): name is string {
  return typeof name === 'string' && SUITE_RE.test(name) && !RESERVED.has(name);
}

/** The suite file for a name, relative to the project. */
export const suiteFile = (name: string): string => `${RULES_DIR}/${name}.yaml`;

/**
 * Read one suite from its text. Pure. A rule that does not parse is left out
 * with why; the rest of the suite still counts.
 */
export function parseSuite(name: string, text: string): { suite: Suite | null; problems: string[] } {
  const file = suiteFile(name);
  const problems: string[] = [];
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    return { suite: null, problems: [`${file} is not valid YAML: ${doc.errors[0].message.split('\n')[0]}`] };
  }
  const data = doc.toJS() as unknown;
  if (data === null || data === undefined) return { suite: { name, file, because: '', rules: [] }, problems };
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { suite: null, problems: [`${file} must be a suite: a mapping with a list of rules`] };
  }
  const d = data as Record<string, unknown>;
  if (d.suite !== undefined && d.suite !== name) problems.push(`${file} says it is suite "${String(d.suite)}"; a suite is named by its file, so it is read as "${name}"`);
  if (d.rules !== undefined && !Array.isArray(d.rules)) {
    return { suite: null, problems: [...problems, `${file}: rules must be a list`] };
  }
  const rules: ArchitectureRule[] = [];
  const seen = new Set<string>();
  ((d.rules as unknown[] | undefined) ?? []).forEach((raw, i) => {
    const label = raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).id === 'string'
      ? `rule "${(raw as Record<string, unknown>).id as string}"` : `rule ${i + 1}`;
    const { rule, problems: why } = parseArchitectureRule(raw);
    if (!rule) { problems.push(`${file}, ${label}: ${why.join('; ')}`); return; }
    if (seen.has(rule.id)) { problems.push(`${file}, ${label}: the id is used twice in this suite; the first is kept`); return; }
    seen.add(rule.id);
    rules.push({ ...rule, suite: name });
  });
  return { suite: { name, file, because: typeof d.because === 'string' ? d.because.trim() : '', rules }, problems };
}

/** The suite files present, by name, oldest name first. Links and other files are not suites. */
function suiteNames(projectRoot: string): string[] {
  let dir: string;
  try {
    if (!fs.existsSync(path.join(projectRoot, RULES_DIR))) return [];
    dir = resolveWithin(projectRoot, RULES_DIR, 'rules folder');
  } catch {
    return []; // a rules folder that is a link out of the project is no rulebook
  }
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.yaml') && isSuiteName(e.name.slice(0, -'.yaml'.length)))
    .map((e) => e.name.slice(0, -'.yaml'.length))
    .sort();
}

const cache = new Map<string, { key: string; book: Rulebook }>();

/**
 * A rulebook from suite texts, by name: the folder's, or a commit's (R2).
 * Pure. An id two suites share is kept in the first, with why.
 */
export function rulebookFrom(files: ReadonlyArray<{ name: string; text: string }>): Rulebook {
  const suites: Suite[] = [];
  const problems: string[] = [];
  const ids = new Map<string, string>(); // rule id → the suite that has it
  for (const { name, text } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const parsed = parseSuite(name, text);
    problems.push(...parsed.problems);
    if (!parsed.suite) continue;
    const kept = parsed.suite.rules.filter((r) => {
      const other = ids.get(r.id);
      if (other) { problems.push(`${suiteFile(name)}, rule "${r.id}": the id is already used in suite "${other}"; that one is kept`); return false; }
      ids.set(r.id, name);
      return true;
    });
    suites.push({ ...parsed.suite, rules: kept });
  }
  return { suites, problems };
}

/** Every suite in the project, read fresh when any file changed since the last read. */
export function readRulebook(projectRoot: string): Rulebook {
  const names = suiteNames(projectRoot);
  const stamps = names.map((n) => {
    try { const st = fs.statSync(path.join(projectRoot, suiteFile(n))); return `${n}:${st.size}:${st.mtimeMs}`; } catch { return `${n}:?`; }
  });
  const key = stamps.join('|');
  const hit = cache.get(projectRoot);
  if (hit && hit.key === key) return hit.book;

  const files: Array<{ name: string; text: string }> = [];
  const unread: string[] = [];
  for (const name of names) {
    try { files.push({ name, text: readTextWithin(projectRoot, suiteFile(name), 'rule suite') }); } catch (err) {
      unread.push(`${suiteFile(name)} could not be read: ${(err as Error).message}`);
    }
  }
  const read = rulebookFrom(files);
  const book = { suites: read.suites, problems: [...unread, ...read.problems] };
  cache.set(projectRoot, { key, book });
  return book;
}

/** A rule as it is written in a suite file: its own fields, nothing derived. */
function written(rule: ArchitectureRule): Record<string, unknown> {
  if (rule.kind === 'package') {
    // R5: written the way a person writes one (design §3.1).
    return {
      id: rule.id,
      kind: 'package',
      package: rule.mayNotImport,
      ...(rule.from !== '**' ? { from: rule.from } : {}),
      only: rule.only ?? [],
      strength: rule.strength,
      ...(rule.except.length ? { except: rule.except } : {}),
      ...(rule.because ? { because: rule.because } : {}),
      since: rule.since,
      ...(rule.by ? { by: rule.by } : {}),
    };
  }
  if (rule.kind === 'calls') {
    // R7: the same shape, naming the call.
    return {
      id: rule.id,
      kind: 'calls',
      calls: rule.mayNotImport,
      ...(rule.from !== '**' ? { from: rule.from } : {}),
      only: rule.only ?? [],
      strength: rule.strength,
      ...(rule.because ? { because: rule.because } : {}),
      since: rule.since,
      ...(rule.by ? { by: rule.by } : {}),
    };
  }
  if (rule.kind === 'symbol') {
    // R6: the same shape, naming the export.
    return {
      id: rule.id,
      kind: 'symbol',
      symbol: rule.mayNotImport,
      ...(rule.from !== '**' ? { from: rule.from } : {}),
      only: rule.only ?? [],
      strength: rule.strength,
      ...(rule.because ? { because: rule.because } : {}),
      since: rule.since,
      ...(rule.by ? { by: rule.by } : {}),
    };
  }
  return {
    id: rule.id,
    from: rule.from,
    mayNotImport: rule.mayNotImport,
    strength: rule.strength,
    ...(rule.except.length ? { except: rule.except } : {}),
    ...(rule.because ? { because: rule.because } : {}),
    since: rule.since,
    ...(rule.by ? { by: rule.by } : {}),
  };
}

/**
 * Write a suite's rules, keeping whatever else the file says (its comments,
 * its `because`, the order of its keys). The caller decided the change and
 * who made it; this only writes it, inside the project.
 */
export function writeSuite(projectRoot: string, name: string, rules: readonly ArchitectureRule[]): string {
  if (!isSuiteName(name)) throw new Error(`"${name}" is not a suite name: lowercase letters, digits and dashes, like payments`);
  const file = suiteFile(name);
  let doc: Document;
  let existing: string | null = null;
  try {
    if (fs.existsSync(path.join(projectRoot, file))) existing = readTextWithin(projectRoot, file, 'rule suite');
  } catch (err) {
    throw new Error(`${file} could not be read: ${(err as Error).message}`);
  }
  if (existing !== null && parseDocument(existing).errors.length === 0) {
    doc = parseDocument(existing);
  } else {
    doc = new Document({ suite: name, rules: [] });
    doc.commentBefore = ` Architecture rules, suite "${name}" (CodeTrellis, Phase 33 R1).\n A person changes these in the app; CI judges a pull request by the base branch's copy.`;
  }
  if (!doc.has('suite')) doc.set('suite', name);
  doc.set('rules', doc.createNode(rules.map(written)) as YamlNode);
  const target = writeFileWithin(projectRoot, file, doc.toString(), 'rule suite');
  cache.delete(projectRoot);
  return target;
}
