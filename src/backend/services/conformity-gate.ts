/**
 * Does a change conform to what the plan and the docs say? (Phase 32 D1.4)
 *
 * For a set of changed files, four things a job can gate on, each already a
 * pass or a fail elsewhere in CodeTrellis:
 *
 *  - a person's code breakpoint covers a changed file (they asked to be asked
 *    before it changes);
 *  - a changed file's tests fail, or are older than the code (B8.2);
 *  - a task marked done has a criterion whose check now fails (§8.1);
 *  - a system doc that references a changed file was verified before it
 *    changed, and has not been since;
 *  - a changed file adds an import across one of the team's architecture
 *    rules (A7.3); an import that was there before the change is the rule's
 *    to list, not the change's.
 *
 * Read only: nothing is recorded, no breakpoint is hit, no check run is
 * stored. CodeTrellis still runs no tests; it reads what was reported.
 */

import { execFileSync } from 'node:child_process';
import { codeCovers, listBreakpoints } from './breakpoint-service';
import { groundingOf } from './tests/grounding';
import { listPlans } from './plan-service';
import { listItemSummaries } from './plan-item-service';
import { listCriteria } from './criteria-service';
import { findDocsByReferencedFile, getSystemDoc } from './system-docs-service';

export interface HeldFile { path: string; breakpoint: string; note: string | null; by: string }
export interface TestTrouble { path: string; state: 'failing' | 'stale'; says: string }
export interface FailingCriterion { itemUid: string; task: string; criterion: string; findings: string[] }
export interface StaleDoc { uid: string; title: string; slug: string; verifiedAt: string; files: string[] }
export interface RuleImport {
  path: string; imports: string; rule: string; words: string; because: string;
  /** R4: a `block` breach fails the gate; a `warn` one is said and passes, unless strict. */
  strength: 'block' | 'warn';
}
export type { RuleChange } from './rule-changes';
import { changeWords, type RuleChange } from './rule-changes';

/** The imports these changed files add across the rules, or null when they could not be read (injected). */
export type RuleChecker = (files: readonly string[]) => RuleImport[] | null | Promise<RuleImport[] | null>;

export interface Conformity {
  ok: boolean;
  /** One line per finding, in the order a person would act on them. */
  says: string[];
  files: string[];
  breakpoints: HeldFile[];
  tests: TestTrouble[];
  criteria: FailingCriterion[];
  docs: StaleDoc[];
  rules: RuleImport[];
  /** False when the rules could not be checked: the project's imports are not loaded here. */
  rulesChecked: boolean;
  /**
   * What this change does to the rulebook against its base (Phase 33 R2):
   * loosening is a finding in `says`; tightening and rewording are `notes`.
   */
  rulebook: RuleChange[];
  /** Said, but not a reason to fail: a rule added or tightened, a reason reworded, a base not read. */
  notes: string[];
}

/** A criterion's check, as the criterion loop runs it (injected so tests need no files). */
export type CriterionChecker = (criterionUid: string) => Promise<{ ok: boolean; findings: Array<{ status: string; message: string }> }>;

const MAX_FILES = 500;

/** A changed path as git lists it: relative, forward slashes, no `./`. */
export function cleanChanged(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of paths) {
    const p = raw.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (!p || p.startsWith('/') || p.split('/').includes('..')) continue;
    out.add(p);
  }
  return [...out].slice(0, MAX_FILES);
}

/** Files that differ between a commit and the working tree (committed or not). */
function changedSince(root: string, commit: string): Set<string> | null {
  try {
    const out = execFileSync('git', ['-C', root, 'diff', '--name-only', commit, '--'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    return null; // the stamp is not in this clone (a shallow checkout): say nothing rather than guess
  }
}

export async function checkChanges(
  root: string,
  changed: readonly string[],
  checkCriterion: CriterionChecker,
  checkRules?: RuleChecker,
  rulebook: readonly RuleChange[] = [],
  notes: readonly string[] = [],
  /** `--strict`: a rule at warn fails the gate like one at block (R4). */
  strict = false,
  /** C1: a check of part of the rulebook judges only those rules; breakpoints, tests, tasks and docs are not its question. */
  scoped = false,
): Promise<Conformity> {
  const files = cleanChanged(changed);
  const says: string[] = [];
  const said = [...notes];

  // The rulebook first (R2): a change that loosens a rule is the first thing a reviewer must see.
  // R3: a loosening a person approved, signed, is said and does not fail.
  for (const c of rulebook) (c.effect === 'loosens' && !c.approval?.ok ? says : said).push(changeWords(c));

  const breakpoints: HeldFile[] = [];
  const code = scoped ? [] : listBreakpoints().filter((b) => b.kind === 'code' && b.projectRoot === root);
  for (const f of files) {
    for (const b of code) {
      if (!codeCovers(b.target, f)) continue;
      breakpoints.push({ path: f, breakpoint: b.id, note: b.note, by: b.createdBy });
      says.push(`■ ${f}: ${b.createdBy} set a breakpoint on ${b.target === f ? 'it' : b.target}${b.note ? ` (“${b.note}”)` : ''}; ask them before changing it`);
    }
  }

  // The team's architecture rules (A7.3): one line per import, with the rule's reason.
  const found = files.length && checkRules ? await checkRules(files) : [];
  const rules = found ?? [];
  for (const r of rules) {
    const line = `${r.path} now imports ${r.imports}, which the rule “${r.words}” forbids${r.because ? `: ${r.because}` : ''}`;
    if (r.strength === 'block' || strict) says.push(`✗ ${line}`);
    else said.push(`⚠ ${line} (the rule warns; it does not fail the check)`);
  }

  const tests: TestTrouble[] = [];
  for (const f of scoped ? [] : files) {
    let g;
    try { g = groundingOf(root, f); } catch { continue; } // deleted, or not a file
    if (g.state === 'failing' || g.state === 'stale') {
      tests.push({ path: f, state: g.state, says: g.words });
      says.push(`${f}: ${g.words}`);
    }
  }

  const criteria: FailingCriterion[] = [];
  for (const plan of scoped ? [] : listPlans(root)) {
    if (plan.status === 'archived') continue;
    for (const item of listItemSummaries(plan.uid)) {
      if (item.status !== 'done') continue;
      for (const c of listCriteria(item.uid)) {
        const r = await checkCriterion(c.uid).catch(() => null);
        if (!r || r.ok) continue;
        const findings = r.findings.filter((x) => x.status === 'fail').map((x) => x.message);
        criteria.push({ itemUid: item.uid, task: item.title, criterion: c.text, findings });
        says.push(`✗ "${item.title}" is marked done, but its criterion "${c.text}" fails${findings.length ? `: ${findings.join('; ')}` : ''}`);
      }
    }
  }

  const docs: StaleDoc[] = [];
  const seen = new Map<string, StaleDoc>();
  const diffs = new Map<string, Set<string> | null>();
  for (const f of scoped ? [] : files) {
    for (const ref of findDocsByReferencedFile(root, f)) {
      const doc = getSystemDoc(ref.uid);
      if (!doc?.capturedAgainstCommit || !(doc.references.files ?? []).some((x) => x.replace(/^\.\/+/, '') === f)) continue;
      const stamp = doc.capturedAgainstCommit;
      if (!diffs.has(stamp)) diffs.set(stamp, changedSince(root, stamp));
      if (!diffs.get(stamp)?.has(f)) continue;
      const at = seen.get(doc.uid);
      if (at) { at.files.push(f); continue; }
      const entry: StaleDoc = { uid: doc.uid, title: doc.title, slug: doc.slug, verifiedAt: stamp.slice(0, 7), files: [f] };
      seen.set(doc.uid, entry);
      docs.push(entry);
    }
  }
  for (const d of docs) says.push(`⚠ The system doc "${d.title}" describes ${d.files.join(', ')}, which changed after it was verified at ${d.verifiedAt}`);

  return { ok: says.length === 0, says, files, breakpoints, tests, criteria, docs, rules, rulesChecked: found !== null, rulebook: [...rulebook], notes: said };
}
