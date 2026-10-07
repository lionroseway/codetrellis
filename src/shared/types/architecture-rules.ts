/**
 * Phase 32 A7 — architecture rules (awareness spec M7).
 *
 * A rule is a path boundary the team writes down once, kept in the committed
 * `.codetrellis/config.json`: "files under `web/` may not import from `db/`".
 * Patterns are project-relative folder prefixes (`web/`) or globs
 * (`src/**\/ui/**`); `except` names the doors through the wall.
 */

/**
 * How hard a rule holds (Phase 33 R4). `block` fails CI (exit 3) and raises a
 * high signal; `warn` is reported and CI passes (`--strict` makes it block);
 * `guide` is shown to agents whose work touches it, and nothing is checked.
 */
export type RuleStrength = 'block' | 'warn' | 'guide';

export const RULE_STRENGTHS: readonly RuleStrength[] = ['block', 'warn', 'guide'];

export type RuleKind = 'imports' | 'package';

export interface ArchitectureRule {
  /** A slug, unique in the project: `web-not-db`. */
  id: string;
  /**
   * What it checks (Phase 33 R5). `imports`, the default: files in `from`
   * may not import files in `mayNotImport`. `package`: only the files in
   * `only` may import the outside package named in `mayNotImport`
   * (`npm:stripe`); `from` is where the rule applies, everywhere (`**`) when
   * not said.
   */
  kind?: RuleKind;
  /** The files the rule is about: `web/`. */
  from: string;
  /** What they may not import: `db/`, or for a package rule the package, `npm:stripe`. */
  mayNotImport: string;
  /** A package rule's files that alone may import it: `src/payments/index.ts`. */
  only?: string[];
  /** Files they may import all the same: `db/types.ts`; for a package rule, parts of it they may (`npm:stripe/types`). */
  except: string[];
  /** Why, in the team's words: "web talks to db through the API". */
  because: string;
  /** When it was set (ISO). */
  since: string;
  /** Who set it, from the transport. */
  by: string;
  /**
   * How hard it holds. A rule written before Phase 33 R4 has none and read as
   * `block`, which is what it did then; a new rule starts at `warn`.
   */
  strength: RuleStrength;
  /**
   * The suite it is kept in: `.codetrellis/rules/<suite>.yaml` (Phase 33 R1).
   * Absent for a rule still in `.codetrellis/config.json`, where Phase 32 kept
   * them, until a person moves it.
   */
  suite?: string;
}

/** One import that crosses a rule: `from` imports `to`, both project-relative. */
export interface RuleBreach {
  rule: string;
  from: string;
  to: string;
}

/** A rule as the window, an agent and the phone read it. */
export interface RuleView {
  /** Where it is kept: the suite file, or `.codetrellis/config.json` until it is moved. */
  where: string;
  rule: ArchitectureRule;
  /** "web/ may not import db/ (except db/types.ts): web talks to db through the API" */
  words: string;
  /** The imports that break it now, or null when the project's graph is not the one loaded. */
  breaches: RuleBreach[] | null;
  /** "1 import breaks this today", "Nothing breaks this today", or why it cannot be said. */
  breachWords: string;
}
